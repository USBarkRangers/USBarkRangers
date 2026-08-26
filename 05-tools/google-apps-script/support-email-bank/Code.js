"use strict";

// Mirrors support-email notifications into Discord without changing the
// Cloudflare forwarding rule or the Gmail mailbox. Gmail remains the durable
// source of truth; this script is only a low-cost notification bridge.

const SUPPORT_EMAIL_BANK = Object.freeze({
  address: "support@usbarkrangersmap.com",
  webhookProperty: "DISCORD_EMAIL_BANK_WEBHOOK",
  checkpointProperty: "SUPPORT_EMAIL_BANK_CHECKPOINT",
  pollMinutes: 5,
  searchPageSize: 100,
  maxSearchPages: 5,
  maxMessagesPerRun: 100,
  overlapSeconds: 120,
  excerptLength: 900,
});

function setupSupportEmailBank() {
  const properties = PropertiesService.getScriptProperties();
  requireDiscordWebhook_(properties.getProperty(SUPPORT_EMAIL_BANK.webhookProperty));

  // Start at setup time so connecting the bridge never floods Discord with old
  // support threads. The overlap and message ids prevent boundary duplicates.
  properties.setProperty(
    SUPPORT_EMAIL_BANK.checkpointProperty,
    JSON.stringify({ millis: Date.now(), ids: [] })
  );

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "postSupportEmailBank")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("postSupportEmailBank")
    .timeBased()
    .everyMinutes(SUPPORT_EMAIL_BANK.pollMinutes)
    .create();

  postDiscordEmail_(
    properties.getProperty(SUPPORT_EMAIL_BANK.webhookProperty),
    {
      title: "Support email bank connected",
      description: `New mail delivered to ${SUPPORT_EMAIL_BANK.address} will appear here within about ${SUPPORT_EMAIL_BANK.pollMinutes} minutes. Gmail remains the source of truth and the place to reply.`,
      color: 0x2ecc71,
      fields: [],
    }
  );
}

function postSupportEmailBank() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;

  try {
    const properties = PropertiesService.getScriptProperties();
    const webhook = requireDiscordWebhook_(
      properties.getProperty(SUPPORT_EMAIL_BANK.webhookProperty)
    );
    const checkpoint = readCheckpoint_(
      properties.getProperty(SUPPORT_EMAIL_BANK.checkpointProperty)
    );
    const messages = findSupportMessages_(checkpoint);

    for (const message of messages.slice(0, SUPPORT_EMAIL_BANK.maxMessagesPerRun)) {
      postDiscordEmail_(webhook, buildDiscordEmail_(message));
      advanceCheckpoint_(checkpoint, message);
      properties.setProperty(
        SUPPORT_EMAIL_BANK.checkpointProperty,
        JSON.stringify(checkpoint)
      );
    }
  } finally {
    lock.releaseLock();
  }
}

function testSupportEmailBank() {
  const webhook = requireDiscordWebhook_(
    PropertiesService.getScriptProperties().getProperty(
      SUPPORT_EMAIL_BANK.webhookProperty
    )
  );
  postDiscordEmail_(webhook, {
    title: "Support email bank test",
    description: "The Gmail-to-Discord bridge is connected. This test did not send or modify an email.",
    color: 0x2ecc71,
    fields: [],
  });
}

function findSupportMessages_(checkpoint) {
  const afterSeconds = Math.max(
    0,
    Math.floor(checkpoint.millis / 1000) - SUPPORT_EMAIL_BANK.overlapSeconds
  );
  const query = [
    `(to:${SUPPORT_EMAIL_BANK.address} OR cc:${SUPPORT_EMAIL_BANK.address})`,
    `after:${afterSeconds}`,
    "-in:spam",
    "-in:trash",
  ].join(" ");

  const found = [];
  for (let page = 0; page < SUPPORT_EMAIL_BANK.maxSearchPages; page += 1) {
    const threads = GmailApp.search(
      query,
      page * SUPPORT_EMAIL_BANK.searchPageSize,
      SUPPORT_EMAIL_BANK.searchPageSize
    );
    if (!threads.length) break;
    threads.forEach((thread) => thread.getMessages().forEach((message) => {
      const millis = message.getDate().getTime();
      const id = message.getId();
      if (isAddressedToSupport_(message) &&
          (millis > checkpoint.millis ||
          (millis === checkpoint.millis && !checkpoint.ids.includes(id)))) {
        found.push(message);
      }
    }));
    if (threads.length < SUPPORT_EMAIL_BANK.searchPageSize) break;
  }

  return found.sort((left, right) => {
    const dateDiff = left.getDate().getTime() - right.getDate().getTime();
    return dateDiff || left.getId().localeCompare(right.getId());
  });
}

function isAddressedToSupport_(message) {
  const recipients = `${message.getTo() || ""},${message.getCc() || ""}`.toLowerCase();
  return recipients.includes(SUPPORT_EMAIL_BANK.address);
}

function buildDiscordEmail_(message) {
  const id = message.getId();
  const subject = cleanDiscordText_(message.getSubject() || "(no subject)", 256);
  const from = cleanDiscordText_(message.getFrom() || "Unknown sender", 1024);
  const excerpt = cleanDiscordText_(message.getPlainBody() || "(no text body)", SUPPORT_EMAIL_BANK.excerptLength);
  const attachments = message.getAttachments({
    includeInlineImages: false,
    includeAttachments: true,
  });

  return {
    title: subject,
    description: excerpt,
    color: 0x3498db,
    url: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`,
    fields: [
      { name: "From", value: from, inline: false },
      { name: "Received", value: Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), "MMM d, yyyy h:mm a z"), inline: true },
      { name: "Attachments", value: String(attachments.length), inline: true },
      { name: "Reply", value: "Open the message in Gmail; Discord is notification-only.", inline: false },
    ],
  };
}

function postDiscordEmail_(webhook, embed) {
  const response = UrlFetchApp.fetch(webhook, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      username: "BARK Support Email Bank",
      allowed_mentions: { parse: [] },
      embeds: [{
        title: cleanDiscordText_(embed.title, 256),
        description: cleanDiscordText_(embed.description, 4096),
        color: embed.color || 0x3498db,
        url: embed.url || undefined,
        timestamp: new Date().toISOString(),
        fields: (embed.fields || []).slice(0, 25).map((field) => ({
          name: cleanDiscordText_(field.name, 256),
          value: cleanDiscordText_(field.value, 1024),
          inline: field.inline !== false,
        })),
        footer: { text: `Delivered to ${SUPPORT_EMAIL_BANK.address}` },
      }],
    }),
  });

  const status = response.getResponseCode();
  if (status < 200 || status >= 300) {
    throw new Error(`Discord returned HTTP ${status}`);
  }
}

function readCheckpoint_(raw) {
  if (!raw) return { millis: Date.now(), ids: [] };
  try {
    const parsed = JSON.parse(raw);
    const millis = Number(parsed.millis);
    return {
      millis: Number.isFinite(millis) && millis > 0 ? millis : Date.now(),
      ids: Array.isArray(parsed.ids) ? parsed.ids.filter(Boolean).slice(-100) : [],
    };
  } catch (error) {
    return { millis: Date.now(), ids: [] };
  }
}

function advanceCheckpoint_(checkpoint, message) {
  const millis = message.getDate().getTime();
  const id = message.getId();
  if (millis > checkpoint.millis) {
    checkpoint.millis = millis;
    checkpoint.ids = [id];
  } else if (millis === checkpoint.millis && !checkpoint.ids.includes(id)) {
    checkpoint.ids.push(id);
    checkpoint.ids = checkpoint.ids.slice(-100);
  }
}

function requireDiscordWebhook_(value) {
  const webhook = String(value || "").trim();
  if (!/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/api\/webhooks\//i.test(webhook)) {
    throw new Error(`Set the ${SUPPORT_EMAIL_BANK.webhookProperty} script property to the private #email-bank webhook URL.`);
  }
  return webhook;
}

function cleanDiscordText_(value, limit) {
  const normalized = String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!normalized) return "(empty)";
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}
