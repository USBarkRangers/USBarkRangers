"use strict";
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

function requireLocal() {
    if (process.env.GCLOUD_PROJECT !== "demo-barkranger-ios"
        || process.env.FIRESTORE_EMULATOR_HOST !== "127.0.0.1:8088"
        || process.env.FIREBASE_AUTH_EMULATOR_HOST !== "127.0.0.1:9098") {
        throw new Error("Set GCLOUD_PROJECT=demo-barkranger-ios and the dedicated localhost emulator hosts. Seeding production is forbidden.");
    }
}
async function seed() {
    requireLocal();
    const app = admin.initializeApp({ projectId: "demo-barkranger-ios" }, `seed-${Date.now()}`);
    try {
        const db = app.firestore(); const auth = app.auth(); const now = Date.now();
        const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../../03-tests/fixtures/ios/current-account.json"), "utf8"));
        const cases = [
            ["a", "active", "lemon_squeezy", true, now + 10 * 86400_000],
            ["b", "free", "none", false, null],
            ["expired", "expired", "lemon_squeezy", false, now - 86400_000],
            ["manual", "manual_active", "admin", true, null],
            ["code", "access_code_active", "access_code", true, now + 86400_000]
        ];
        for (const [name, status, source, premium, expiresAt] of cases) {
            const uid = `native-test-${name}`; const email = `ranger-${name}@example.test`;
            try { await auth.getUser(uid); }
            catch (error) { if (error.code !== "auth/user-not-found") throw error; await auth.createUser({ uid, email, password: "BarkTest123!", emailVerified: true }); }
            await auth.updateUser(uid, { email, password: "BarkTest123!", emailVerified: true, disabled: false });
            // Reset only the fixed synthetic fixtures. Never enumerate or delete arbitrary users.
            await db.recursiveDelete(db.doc(`users/${uid}`));
            await db.recursiveDelete(db.doc(`_nativeMutationReceipts/${uid}`));
            await db.doc(`_deletedUsers/${uid}`).delete();
            await db.doc(`users/${uid}`).set({ ...fixture.user, email, displayName: `Ranger ${name.toUpperCase()}`,
                username: `Ranger ${name.toUpperCase()}`, entitlement: { premium, status, source, expiresAt: expiresAt && source == "access_code" ? new Date(expiresAt) : expiresAt } });
            for (const trip of fixture.trips) await db.doc(`users/${uid}/savedRoutes/${trip.id}`).set(trip.fields);
            for (const badge of fixture.achievements) await db.doc(`users/${uid}/achievements/${badge.id}`).set(badge.fields);
            console.log(`Ready: ${email} (${status})`);
        }
        console.log("Synthetic password: BarkTest123! — local emulators only.");
    } finally { await app.delete(); }
}
if (require.main === module) seed().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { requireLocal, seed };
