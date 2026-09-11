"use strict";
const { HttpsError } = require("firebase-functions/v1/https");

function requireRecentAuth(context, now = Date.now()) {
    const seconds = context?.auth?.token?.auth_time;
    if (!context?.auth?.uid) throw new HttpsError("unauthenticated", "Sign in again.");
    if (!Number.isFinite(seconds) || seconds * 1000 > now + 60_000 || now - seconds * 1000 > 5 * 60_000) {
        throw new HttpsError("failed-precondition", "Sign in again before deleting your account.");
    }
}
// Validate the intended UID before the existing handler can contact a provider using SDK-supplied auth.
function forAccount(handler, { recentAuth = false } = {}) {
    return async (data, context) => {
        if (!context?.auth?.uid) throw new HttpsError("unauthenticated", "Sign in again.");
        if (data?.uid !== context.auth.uid) throw new HttpsError("permission-denied", "Account changed.");
        if (recentAuth) requireRecentAuth(context);
        return handler(data, context);
    };
}
module.exports = { forAccount, requireRecentAuth };
