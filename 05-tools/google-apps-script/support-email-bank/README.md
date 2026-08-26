# Support email bank

This standalone Google Apps Script mirrors new messages delivered to
`support@usbarkrangersmap.com` into the private Discord `#email-bank` channel.

- Cloudflare's existing forwarding rule is unchanged.
- Gmail is the durable mailbox and the only place to reply.
- Discord receives sender, subject, a short plain-text preview, receipt time,
  attachment count, and a Gmail link. Attachments are not copied.
- The five-minute trigger uses Gmail and Apps Script quotas only. It performs no
  Firebase reads/writes and invokes no Cloud Function.
- A script lock and per-message checkpoint prevent overlapping runs and duplicate
  notifications. The checkpoint advances only after Discord accepts a post.

The webhook is stored only in the Apps Script project property named
`DISCORD_EMAIL_BANK_WEBHOOK`. Run `setupSupportEmailBank` once to set a fresh
checkpoint, replace any old trigger, create the five-minute trigger, and post a
connection confirmation.

The checked-in `.clasp.json` points at the mailbox-owned project. Authenticate clasp
as `cswarm34@gmail.com` before pushing; a trigger created by another Google account
would read the wrong mailbox.
