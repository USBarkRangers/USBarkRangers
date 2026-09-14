'use strict';

// Match iOS NativeSyncPolicy: 40 days of offline editing plus five days to retry.
// These are acceptance rules, never permission to delete local unsynced work.
// Receipt replay runs before age/access checks; renewal never resets operation age.
const DAY_MS = 86_400_000;
const ACCEPTANCE_WINDOW_MS = 45 * DAY_MS;
const PREMIUM_UPLOAD_GRACE_MS = 45 * DAY_MS;
const RECEIPT_RETENTION_MS = 60 * DAY_MS;
module.exports = { ACCEPTANCE_WINDOW_MS, PREMIUM_UPLOAD_GRACE_MS, RECEIPT_RETENTION_MS };
