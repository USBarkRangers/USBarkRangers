#!/usr/bin/env bash
# Uploads the Discord webhook map to Firebase as the DISCORD_WEBHOOKS_JSON secret.
#
# The webhook URLs are bearer credentials: anyone holding one can post to that
# channel. They live only in discord-webhooks.local.json (gitignored) and in
# Firebase Secret Manager, never in the repo.
#
#   1. cp 05-tools/scripts/discord-webhooks.example.json discord-webhooks.local.json
#   2. In Discord: Server Settings -> Integrations -> Webhooks -> Copy Webhook URL
#      for each one, and paste it next to the matching key.
#   3. ./05-tools/scripts/set-discord-secret.sh
#
# Channels you leave blank are simply skipped at runtime, so it is fine to start
# with a few and add the rest later by re-running this script.

set -euo pipefail

FILE="${1:-discord-webhooks.local.json}"

if [ ! -f "$FILE" ]; then
    echo "error: $FILE not found."
    echo "  cp 05-tools/scripts/discord-webhooks.example.json $FILE"
    exit 1
fi

# Fail before touching Firebase if the JSON is malformed, and strip both the
# _readme key and any keys still left blank so the stored secret is clean.
CLEANED="$(node -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
let parsed;
try { parsed = JSON.parse(raw); }
catch (err) { console.error("error: " + process.argv[1] + " is not valid JSON: " + err.message); process.exit(1); }

const out = {};
const bad = [];
for (const [key, value] of Object.entries(parsed)) {
    if (key === "_readme") continue;
    if (typeof value !== "string" || !value.trim()) continue;
    if (key === "adminRoleId") {
        if (!/^\d+$/.test(value.trim())) { bad.push("adminRoleId must be numeric (got \"" + value + "\")"); continue; }
        out.adminRoleId = value.trim();
        continue;
    }
    if (!value.startsWith("https://discord.com/api/webhooks/")) {
        bad.push(key + " is not a Discord webhook URL");
        continue;
    }
    out[key] = value.trim();
}

if (bad.length) { console.error("error:\n  " + bad.join("\n  ")); process.exit(1); }

const channels = Object.keys(out).filter((k) => k !== "adminRoleId");
if (!channels.length) { console.error("error: no webhook URLs filled in yet."); process.exit(1); }
console.error("Uploading " + channels.length + " channel webhook(s): " + channels.join(", "));
console.error(out.adminRoleId ? "Admin role id set (critical alerts will ping)." : "No adminRoleId: critical alerts will post without a ping.");
process.stdout.write(JSON.stringify(out));
' "$FILE")"

printf '%s' "$CLEANED" | npx firebase functions:secrets:set DISCORD_WEBHOOKS_JSON --data-file -

echo
echo "Done. Deploy for it to take effect:"
echo "  npx firebase deploy --only functions"
