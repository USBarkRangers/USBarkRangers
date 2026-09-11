"use strict";

// Only touched fields are projected/patched; unrelated current-format user data stays in Firestore.
function content(user, kind) {
    return kind === "profile"
        ? { displayName: user.displayName ?? null, username: user.username ?? null }
        : user.settings?.mapStyle ?? null;
}
function patch(operation, now) {
    return operation.kind === "profile"
        ? { displayName: operation.value, username: operation.value, profileUpdatedAt: now }
        : { settings: { mapStyle: operation.value, settingsUpdatedAt: now } };
}
function premium(user, now) {
    const entitlement = user.entitlement || {};
    const date = value => typeof value?.toMillis === "function" ? value.toMillis()
        : typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
    const active = ["active", "manual_active", "past_due", "paused", "cancelled_active"].includes(entitlement.status);
    const code = entitlement.source === "access_code" && entitlement.status === "access_code_active"
        && date(entitlement.expiresAt) > now;
    return entitlement.premium === true && (active || code);
}
module.exports = { content, patch, premium };
