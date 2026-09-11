"use strict";
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const admin = require("firebase-admin");
const { requireLocal } = require("../05-tools/scripts/seed-ios-emulators.cjs");
const { forAccount, requireRecentAuth } = require("../01-code/functions/user/accountActions");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");
requireLocal();
const app = admin.initializeApp({ projectId: "demo-barkranger-ios" }, "native-contract-tests");
const db = app.firestore(); let rules;
const created = [];
before(async () => { rules = await initializeTestEnvironment({ projectId: "demo-barkranger-ios", firestore: { host: "127.0.0.1", port: 8088 } }); });
after(async () => { await rules?.cleanup(); for (const uid of created) {
    await db.recursiveDelete(db.doc(`users/${uid}`)); await db.recursiveDelete(db.doc(`_nativeMutationReceipts/${uid}`));
    await db.doc(`_deletedUsers/${uid}`).delete(); await app.auth().deleteUser(uid).catch(() => {});
} await app.delete(); });
async function account(premium = true) {
    const uid = `contract-${randomUUID()}`; const email = `${uid}@example.test`; created.push(uid);
    await app.auth().createUser({ uid, email, password: "BarkTest123!", emailVerified: true });
    await db.doc(`users/${uid}`).set({ displayName: "Before", username: "Before", visitedPlaces: [{ id: "retired", score: 9 }],
        settings: { mapStyle: "default", unknown: 17 }, entitlement: { premium, status: premium ? "active" : "free", source: "manual" } });
    const response = await fetch("http://127.0.0.1:9098/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "BarkTest123!", returnSecureToken: true })
    });
    const auth = await response.json(); assert.ok(auth.idToken);
    return { uid, token: auth.idToken };
}
async function call(user, name, data) {
    const response = await fetch(`http://127.0.0.1:5008/demo-barkranger-ios/us-central1/${name}`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${user.token}` }, body: JSON.stringify({ data })
    });
    const body = await response.json();
    if (body.error) { const error = new Error(body.error.message); error.code = body.error.status; throw error; }
    return body.result;
}
const operation = (uid, value = "After") => ({ uid, id: randomUUID(), kind: "profile", createdAt: Date.now(),
    expected: { displayName: "Before", username: "Before" }, value });

test("real transaction survives lost response and retries exact receipts without replaying writes", async () => {
    const user = await account(); const op = operation(user.uid);
    const first = await call(user, "applyUserMutation", op); assert.equal(first.outcome, "accepted");
    await db.doc(`users/${user.uid}`).set({ displayName: "Later web edit", username: "Later web edit" }, { merge: true });
    const retry = await call(user, "applyUserMutation", op); assert.deepEqual(retry, first);
    const saved = (await db.doc(`users/${user.uid}`).get()).data();
    assert.equal(saved.displayName, "Later web edit"); assert.deepEqual(saved.visitedPlaces, [{ id: "retired", score: 9 }]);
    await assert.rejects(call(user, "applyUserMutation", { ...op, value: "Different" }), { code: "ALREADY_EXISTS" });
});
test("concurrent intents compare actual web content, one wins and the other conflicts", async () => {
    const user = await account();
    const results = await Promise.all([call(user, "applyUserMutation", operation(user.uid, "First")), call(user, "applyUserMutation", operation(user.uid, "Second"))]);
    assert.deepEqual(results.map(x => x.outcome).sort(), ["accepted", "conflict"]);
    assert.equal((await db.collection(`_nativeMutationReceipts/${user.uid}/operations`).get()).size, 2);
});
test("map changes preserve unrelated settings and free access is a durable rejection", async () => {
    const user = await account(); const op = { ...operation(user.uid), kind: "mapStyle", expected: "default", value: "satellite" };
    assert.equal((await call(user, "applyUserMutation", op)).outcome, "accepted");
    assert.deepEqual((await db.doc(`users/${user.uid}`).get()).data().settings.unknown, 17);
    const free = await account(false);
    assert.equal((await call(free, "applyUserMutation", { ...op, id: randomUUID(), uid: free.uid })).reason, "premium-required");
});
test("UID mismatch, protected payloads, future/expired operations and deletion tombstones fail closed", async () => {
    const a = await account(); const b = await account(); const op = operation(a.uid);
    await assert.rejects(call(b, "applyUserMutation", op), { code: "PERMISSION_DENIED" });
    await assert.rejects(call(a, "applyUserMutation", { ...op, entitlement: { premium: true } }), { code: "INVALID_ARGUMENT" });
    await assert.rejects(call(a, "applyUserMutation", { ...op, kind: "visit" }), { code: "INVALID_ARGUMENT" });
    for (const age of [-31 * 86400_000, 6 * 60_000]) {
        assert.equal((await call(a, "applyUserMutation", { ...op, id: randomUUID(), createdAt: Date.now() + age })).reason, "expired-operation");
    }
    await db.doc(`_deletedUsers/${a.uid}`).set({ deletedAt: new Date() });
    await assert.rejects(call(a, "applyUserMutation", op), { code: "PERMISSION_DENIED" });
});
test("rules protect receipt grants, membership, admin and scores and isolate accounts", async () => {
    const a = await account(false); const b = await account(); const client = rules.authenticatedContext(a.uid).firestore();
    await assertSucceeds(getDoc(doc(client, `users/${a.uid}`)));
    await assertFails(getDoc(doc(client, `users/${b.uid}`)));
    for (const fields of [{ entitlement: { premium: true } }, { isAdmin: true }]) {
        await assertFails(setDoc(doc(client, `users/${a.uid}`), fields, { merge: true }));
    }
    await assertFails(setDoc(doc(client, `leaderboard/${a.uid}`), { score: 9999 }));
    await assertFails(setDoc(doc(client, `_nativeMutationReceipts/${a.uid}/operations/fake`), { outcome: "accepted" }));
});
test("native provider wrappers bind intended UID and require recent authentication for deletion", async () => {
    let calls = 0; const handler = forAccount(async () => { calls++; }, { recentAuth: true });
    await assert.rejects(handler({ uid: "a" }, { auth: { uid: "b", token: { auth_time: Date.now() / 1000 } } }));
    await assert.rejects(handler({ uid: "a" }, { auth: { uid: "a", token: { auth_time: 1 } } }));
    assert.equal(calls, 0);
    assert.throws(() => requireRecentAuth({ auth: { uid: "a", token: {} } }));
    await handler({ uid: "a" }, { auth: { uid: "a", token: { auth_time: Date.now() / 1000 } } }); assert.equal(calls, 1);
});
test("emulator deletion is retryable and never contacts external subscription providers", async () => {
    const user = await account();
    const op = operation(user.uid); await call(user, "applyUserMutation", op);
    assert.equal((await call(user, "getNativeBillingURL", { uid: user.uid })).testProvider, true);
    const result = await call(user, "deleteNativeAccount", { uid: user.uid, confirmation: "DELETE" });
    assert.equal(result.deleted, true); assert.equal(result.testProvider, true);
    assert.equal((await db.doc(`users/${user.uid}`).get()).exists, false);
    assert.equal((await db.doc(`_deletedUsers/${user.uid}`).get()).exists, true);
    // The still-valid signed token can safely retry after a dropped response.
    assert.equal((await call(user, "deleteNativeAccount", { uid: user.uid, confirmation: "DELETE" })).deleted, true);
    assert.equal((await db.doc(`_nativeMutationReceipts/${user.uid}/operations/${op.id}`).get()).exists, false);
});
