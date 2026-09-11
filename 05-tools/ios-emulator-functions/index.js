"use strict";
// This entry point cannot initialize against production or contact an external provider.
const project = process.env.GCLOUD_PROJECT;
if (project !== "demo-barkranger-ios" || process.env.FUNCTIONS_EMULATOR !== "true"
    || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8088"
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9098") {
    throw new Error("Native test functions require the dedicated local emulators.");
}
// Reuse the backend dependency graph so Firestore sentinels and callable errors have one SDK identity.
const backendRequire = require("node:module").createRequire(require("node:path").resolve(__dirname, "../../01-code/functions/package.json"));
const functions = backendRequire("firebase-functions/v1");
const admin = backendRequire("firebase-admin");
const { FieldValue } = backendRequire("firebase-admin/firestore");
admin.initializeApp({ projectId: project });
const db = admin.firestore();
const { createUserMutations } = require("../../01-code/functions/user/userMutations");
const { requireRecentAuth } = require("../../01-code/functions/user/accountActions");
exports.applyUserMutation = functions.https.onCall(createUserMutations({ db }));

async function account(data, context, deleting = false) {
    const uid = context.auth?.uid;
    if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in.");
    if (uid !== data?.uid) throw new functions.https.HttpsError("permission-denied", "Account changed.");
    if (!deleting && (await db.doc(`_deletedUsers/${uid}`).get()).exists) {
        throw new functions.https.HttpsError("permission-denied", "Deleted account.");
    }
    return uid;
}
exports.restoreNativeAccess = functions.https.onCall(async (data, context) => {
    const uid = await account(data, context);
    if (!context.auth.token.email_verified) throw new functions.https.HttpsError("failed-precondition", "Verify email first.");
    return { restored: true, entitlement: (await db.doc(`users/${uid}`).get()).data()?.entitlement, testProvider: true };
});
exports.getNativeBillingURL = functions.https.onCall(async (data, context) => {
    await account(data, context);
    // No fake portal URL; the native test adapter reports this as a simulated provider action.
    return { testProvider: true };
});
exports.cancelNativeSubscription = functions.https.onCall(async (data, context) => {
    const uid = await account(data, context);
    await db.doc(`users/${uid}`).set({ entitlement: { premium: true, status: "cancelled_active",
        currentPeriodEnd: Date.now() + 86400_000, source: "lemon_squeezy" } }, { merge: true });
    return { canceled: true, testProvider: true };
});
exports.deleteNativeAccount = functions.https.onCall(async (data, context) => {
    const uid = await account(data, context, true);
    requireRecentAuth(context);
    if (data.confirmation !== "DELETE") throw new functions.https.HttpsError("failed-precondition", "Type DELETE.");
    await db.doc(`_deletedUsers/${uid}`).set({ deletedAt: FieldValue.serverTimestamp(), testProvider: true });
    await db.recursiveDelete(db.doc(`users/${uid}`));
    await db.doc(`leaderboard/${uid}`).delete();
    await db.recursiveDelete(db.doc(`_nativeMutationReceipts/${uid}`));
    try { await admin.auth().deleteUser(uid); } catch (error) { if (error.code !== "auth/user-not-found") throw error; }
    return { deleted: true, subscriptionCanceled: true, testProvider: true };
});
