const assert = require("node:assert/strict");
const { after, before, beforeEach, describe, it } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const admin = require("firebase-admin");
const { initializeApp, deleteApp } = require("firebase/app");
const {
    connectAuthEmulator,
    createUserWithEmailAndPassword,
    getAuth,
    signInWithEmailAndPassword,
    signOut
} = require("firebase/auth");
const {
    connectFunctionsEmulator,
    getFunctions,
    httpsCallable
} = require("firebase/functions");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "demo-bark-ranger-callable-test";
const REGION = "us-central1";
const AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const FUNCTIONS_EMULATOR_HOST = "127.0.0.1";
const FUNCTIONS_EMULATOR_PORT = 5001;
const ORS_LOG_PATH = process.env.BARK_ORS_EMULATOR_STUB_LOG ||
    path.join(os.tmpdir(), "bark-ranger-ors-emulator-stub.jsonl");
const ORS_MARKER_PATH = process.env.BARK_ORS_EMULATOR_STUB_MARKER ||
    path.join(os.tmpdir(), "bark-ranger-ors-emulator-stub-active.json");
const PASSWORD = "Callable-emulator-test-12345";
const CALLABLE_TIMEOUT_MS = 15000;

let clientApp;
let auth;
let functionsClient;
let adminApp;
let db;
let createdUids = [];

function authEmulatorUrl() {
    return AUTH_EMULATOR_HOST.startsWith("http")
        ? AUTH_EMULATOR_HOST
        : `http://${AUTH_EMULATOR_HOST}`;
}

function resetOrsStubFiles() {
    fs.rmSync(ORS_LOG_PATH, { force: true });
}

function resetOrsMarker() {
    fs.rmSync(ORS_MARKER_PATH, { force: true });
}

function readOrsCalls() {
    if (!fs.existsSync(ORS_LOG_PATH)) return [];

    return fs.readFileSync(ORS_LOG_PATH, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

function getHttpsErrorCode(error) {
    return String(error && error.code ? error.code : "").replace(/^functions\//, "");
}

async function assertRejectsCode(promise, code) {
    await assert.rejects(
        withTimeout(promise, `Expected callable rejection ${code}`),
        (error) => getHttpsErrorCode(error) === code
    );
}

function withTimeout(promise, label) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${CALLABLE_TIMEOUT_MS}ms`));
        }, CALLABLE_TIMEOUT_MS);
    });

    return Promise.race([promise, timeout]).finally(() => {
        clearTimeout(timeoutId);
    });
}

function callable(name) {
    return httpsCallable(functionsClient, name);
}

async function callGeocode(data) {
    return callable("getPremiumGeocode")(data);
}

async function callRoute(data) {
    return callable("getPremiumRoute")(data);
}

async function createSignedInUser(label, options = {}) {
    const emailVerified = options.emailVerified !== false;
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `${label}-${suffix}@example.test`;
    const credential = await createUserWithEmailAndPassword(auth, email, PASSWORD);
    createdUids.push(credential.user.uid);
    if (!emailVerified) return credential.user;

    await admin.auth(adminApp).updateUser(credential.user.uid, { emailVerified: true });
    await signOut(auth);
    const verifiedCredential = await signInWithEmailAndPassword(auth, email, PASSWORD);
    await verifiedCredential.user.getIdToken(true);
    return verifiedCredential.user;
}

async function seedEntitlement(uid, entitlement) {
    await db.collection("users").doc(uid).set({ entitlement }, { merge: true });
}

async function clearUserDocs() {
    const refs = await db.collection("users").listDocuments();
    await Promise.all(refs.map((ref) => ref.delete()));
}

async function deleteCreatedAuthUsers() {
    const uids = createdUids;
    createdUids = [];
    await Promise.all(uids.map(async (uid) => {
        try {
            await admin.auth(adminApp).deleteUser(uid);
        } catch (error) {
            if (!error || error.code !== "auth/user-not-found") {
                throw error;
            }
        }
    }));
}

async function resetClientAuth() {
    try {
        await signOut(auth);
    } catch (error) {
        if (!/no current user/i.test(String(error && error.message ? error.message : error))) {
            throw error;
        }
    }
}

async function warmFunctionsWorkerAndVerifyStub() {
    resetOrsMarker();
    resetOrsStubFiles();
    await resetClientAuth();

    await assertRejectsCode(
        callGeocode({ text: "Seattle" }),
        "unauthenticated"
    );

    assert.equal(
        fs.existsSync(ORS_MARKER_PATH),
        true,
        "ORS nock preload did not activate in the Functions emulator worker; stopping before any premium ORS path can run."
    );
    assert.deepEqual(readOrsCalls(), []);
}

const premiumEntitlement = {
    premium: true,
    status: "manual_active",
    source: "admin_override",
    manualOverride: true,
    currentPeriodEnd: null
};

const routePayload = {
    coordinates: [[-122.4, 37.8], [-122.5, 37.9]],
    radiuses: [350, 350]
};

describe("ORS callable emulator entitlement enforcement", { concurrency: false }, () => {
    before(async () => {
        assert.equal(process.env.BARK_ORS_EMULATOR_STUB, "1");
        assert.equal(process.env.ORS_API_KEY, "emulator-test-key");
        assert.ok(
            PROJECT_ID.startsWith("demo-"),
            `Callable emulator tests must use a demo project, got ${PROJECT_ID}.`
        );
        assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "FIRESTORE_EMULATOR_HOST is required.");
        assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST, "FIREBASE_AUTH_EMULATOR_HOST is required.");

        adminApp = admin.initializeApp({ projectId: PROJECT_ID }, `ors-callable-test-${Date.now()}`);
        db = admin.firestore(adminApp);

        clientApp = initializeApp({
            apiKey: "demo-api-key",
            appId: "demo-app-id",
            projectId: PROJECT_ID
        }, `ors-callable-client-${Date.now()}`);
        auth = getAuth(clientApp);
        connectAuthEmulator(auth, authEmulatorUrl(), { disableWarnings: true });
        functionsClient = getFunctions(clientApp, REGION);
        connectFunctionsEmulator(functionsClient, FUNCTIONS_EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);

        await warmFunctionsWorkerAndVerifyStub();
    });

    beforeEach(async () => {
        resetOrsStubFiles();
        await resetClientAuth();
        await clearUserDocs();
        await deleteCreatedAuthUsers();
    });

    after(async () => {
        resetOrsStubFiles();
        resetOrsMarker();
        if (auth) await resetClientAuth();
        if (db) await clearUserDocs();
        await deleteCreatedAuthUsers();
        if (adminApp) await adminApp.delete();
        if (clientApp) await deleteApp(clientApp);
    });

    it("rejects unauthenticated geocode requests", async () => {
        await assertRejectsCode(
            callGeocode({ text: "Seattle" }),
            "unauthenticated"
        );

        assert.deepEqual(readOrsCalls(), []);
    });

    it("rejects unverified email/password users before entitlement or ORS work", async () => {
        const user = await createSignedInUser("unverified-geocode", { emailVerified: false });
        await seedEntitlement(user.uid, premiumEntitlement);

        await assertRejectsCode(
            callGeocode({ text: "Seattle" }),
            "failed-precondition"
        );

        assert.deepEqual(readOrsCalls(), []);
    });

    it("rejects signed-in free geocode requests before ORS", async () => {
        const user = await createSignedInUser("free-geocode");
        await seedEntitlement(user.uid, { premium: false, status: "free", source: "none" });

        await assertRejectsCode(
            callGeocode({ text: "Seattle", isPremium: true }),
            "permission-denied"
        );

        assert.deepEqual(readOrsCalls(), []);
    });

    it("allows premium manual geocode requests to reach the stubbed ORS path", async () => {
        const user = await createSignedInUser("premium-geocode");
        await seedEntitlement(user.uid, premiumEntitlement);

        const result = await withTimeout(
            callGeocode({ text: "Seattle", size: 3, country: "US" }),
            "Premium geocode callable"
        );
        const calls = readOrsCalls();

        assert.equal(result.data.features[0].properties.label, "Stubbed Seattle");
        assert.equal(calls.length, 1);
        assert.equal(calls[0].service, "geocode");
        assert.match(calls[0].uri, /text=Seattle/);
    });

    it("rejects signed-in free route requests before ORS", async () => {
        const user = await createSignedInUser("free-route");
        await seedEntitlement(user.uid, { premium: false, status: "free", source: "none" });

        await assertRejectsCode(
            callRoute({ ...routePayload, isPremium: true }),
            "permission-denied"
        );

        assert.deepEqual(readOrsCalls(), []);
    });

    it("allows premium manual route requests to reach the stubbed ORS path", async () => {
        const user = await createSignedInUser("premium-route");
        await seedEntitlement(user.uid, premiumEntitlement);

        const result = await withTimeout(
            callRoute(routePayload),
            "Premium route callable"
        );
        const calls = readOrsCalls();

        assert.equal(result.data.type, "FeatureCollection");
        assert.equal(result.data.features[0].properties.stubbed, true);
        assert.equal(calls.length, 2);
        assert.equal(calls[0].service, "snap");
        assert.equal(calls[1].service, "route");
        assert.deepEqual(calls[1].body.coordinates, routePayload.coordinates);
    });

    it("ignores client-provided premium, entitlement, status, and uid claims", async () => {
        const user = await createSignedInUser("client-claims");
        await seedEntitlement(user.uid, { premium: false, status: "free", source: "none" });

        await assertRejectsCode(
            callGeocode({
                text: "Seattle",
                isPremium: true,
                entitlement: premiumEntitlement,
                status: "manual_active",
                uid: "premium-user"
            }),
            "permission-denied"
        );

        assert.deepEqual(readOrsCalls(), []);
    });

    it("rejects users with missing entitlement", async () => {
        await createSignedInUser("missing-entitlement");

        await assertRejectsCode(
            callGeocode({ text: "Seattle" }),
            "permission-denied"
        );

        assert.deepEqual(readOrsCalls(), []);
    });

    it("rejects malformed entitlements", async () => {
        const user = await createSignedInUser("malformed");

        for (const entitlement of ["premium", { premium: true }]) {
            resetOrsStubFiles();
            await seedEntitlement(user.uid, entitlement);

            await assertRejectsCode(
                callGeocode({ text: "Seattle" }),
                "permission-denied"
            );

            assert.deepEqual(readOrsCalls(), []);
        }
    });

    it("rejects ended premium statuses", async () => {
        const user = await createSignedInUser("inactive");

        for (const status of ["canceled", "expired", "refunded"]) {
            resetOrsStubFiles();
            await seedEntitlement(user.uid, {
                premium: true,
                status,
                source: "provider"
            });

            await assertRejectsCode(
                callGeocode({ text: "Seattle" }),
                "permission-denied"
            );

            assert.deepEqual(readOrsCalls(), [], status);
        }
    });
});
