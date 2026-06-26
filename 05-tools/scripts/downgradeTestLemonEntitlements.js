#!/usr/bin/env node
/**
 * One-time Lemon Squeezy test-mode entitlement downgrade.
 *
 * Dry run:
 *   node 05-tools/scripts/downgradeTestLemonEntitlements.js
 *
 * Commit:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *     node 05-tools/scripts/downgradeTestLemonEntitlements.js --commit
 *
 * This intentionally preserves all user data and only resets old non-live
 * Lemon Squeezy entitlement maps to Free. A backup of every changed user doc is
 * written before the entitlement reset.
 */

const admin = require("firebase-admin");

const DEFAULT_PROJECT_ID = "barkrangermap-auth";
const args = new Set(process.argv.slice(2));
const SHOULD_COMMIT = args.has("--commit");
const LIMIT_ARG = process.argv.find(arg => arg.startsWith("--limit="));
const UID_ARG = process.argv.find(arg => arg.startsWith("--uid="));
const PROJECT_ARG = process.argv.find(arg => arg.startsWith("--project="));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split("=").slice(1).join("=")) : null;
const ONLY_UID = UID_ARG ? UID_ARG.split("=").slice(1).join("=").trim() : "";
const PROJECT_ID = PROJECT_ARG
    ? PROJECT_ARG.split("=").slice(1).join("=").trim()
    : (process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_PROJECT_ID);
const RUN_ID = `lemon-test-entitlement-downgrade-${new Date().toISOString().replace(/[:.]/g, "-")}`;

function printUsage() {
    console.log(`
Usage:
  node 05-tools/scripts/downgradeTestLemonEntitlements.js [options]

Options:
  --commit           Write entitlement resets to Firestore. Default is dry-run.
  --limit=N          Scan only the first N matched user documents.
  --uid=UID          Scan only one user document.
  --project=PROJECT  Firebase project id. Defaults to ${DEFAULT_PROJECT_ID}.

Commit mode writes backups to:
  _migrationBackups/${RUN_ID}/users/{uid}
`);
}

if (args.has("--help") || args.has("-h")) {
    printUsage();
    process.exit(0);
}

function cleanString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isOldTestLemonEntitlement(entitlement) {
    if (!entitlement || typeof entitlement !== "object" || Array.isArray(entitlement)) return false;
    if (entitlement.source !== "lemon_squeezy") return false;
    return cleanString(entitlement.providerMode).toLowerCase() !== "live";
}

function summarizeEntitlement(entitlement) {
    return {
        premium: entitlement && entitlement.premium === true,
        status: entitlement && entitlement.status ? entitlement.status : null,
        source: entitlement && entitlement.source ? entitlement.source : null,
        providerMode: entitlement && entitlement.providerMode ? entitlement.providerMode : null,
        providerSubscriptionId: entitlement && entitlement.providerSubscriptionId ? entitlement.providerSubscriptionId : null,
        providerCustomerId: entitlement && entitlement.providerCustomerId ? entitlement.providerCustomerId : null
    };
}

function buildFreeEntitlement() {
    return {
        premium: false,
        status: "free",
        source: "none",
        providerMode: null,
        currentPeriodEnd: null,
        providerCustomerId: null,
        providerSubscriptionId: null,
        providerOrderId: null,
        lemonSqueezySubscriptionId: null,
        providerStatus: null,
        downgradedFromTestLemon: true,
        downgradedReason: "lemon_test_mode_retired_live_rc",
        downgradedAt: admin.firestore.FieldValue.serverTimestamp()
    };
}

async function getCandidateSnapshots(db) {
    if (ONLY_UID) {
        const snapshot = await db.collection("users").doc(ONLY_UID).get();
        return snapshot.exists ? [snapshot] : [];
    }

    let query = db.collection("users").where("entitlement.source", "==", "lemon_squeezy");
    if (Number.isFinite(LIMIT) && LIMIT > 0) query = query.limit(Math.floor(LIMIT));
    const snapshot = await query.get();
    return snapshot.docs;
}

async function commitDowngrades(db, candidates) {
    const timestamp = admin.firestore.FieldValue.serverTimestamp();
    let batch = db.batch();
    let pendingWrites = 0;
    let committedWrites = 0;

    async function flush() {
        if (pendingWrites === 0) return;
        await batch.commit();
        committedWrites += pendingWrites;
        batch = db.batch();
        pendingWrites = 0;
    }

    for (const candidate of candidates) {
        const uid = candidate.id;
        const userData = candidate.data() || {};
        const backupRef = db
            .collection("_migrationBackups")
            .doc(RUN_ID)
            .collection("users")
            .doc(uid);
        const userRef = db.collection("users").doc(uid);

        batch.set(backupRef, {
            uid,
            projectId: PROJECT_ID,
            runId: RUN_ID,
            migration: "lemon_test_entitlement_downgrade",
            backedUpAt: timestamp,
            userData
        }, { merge: false });

        batch.set(userRef, {
            entitlement: buildFreeEntitlement(),
            billingMigration: {
                lemonTestEntitlementDowngradedAt: timestamp,
                lemonTestEntitlementDowngradeRunId: RUN_ID
            }
        }, { merge: true });

        pendingWrites += 2;
        if (pendingWrites >= 400) await flush();
    }

    await flush();
    return committedWrites;
}

async function main() {
    admin.initializeApp({ projectId: PROJECT_ID });
    const db = admin.firestore();
    const snapshots = await getCandidateSnapshots(db);
    const candidates = snapshots
        .map(snapshot => ({ snapshot, data: snapshot.data() || {} }))
        .filter(({ data }) => isOldTestLemonEntitlement(data.entitlement));

    console.log(`Project: ${PROJECT_ID}`);
    console.log(`Mode: ${SHOULD_COMMIT ? "COMMIT" : "DRY RUN"}`);
    console.log(`Run id: ${RUN_ID}`);
    console.log(`Matched Lemon user docs: ${snapshots.length}`);
    console.log(`Old test/non-live Lemon entitlements to downgrade: ${candidates.length}`);

    candidates.forEach(({ snapshot, data }) => {
        console.log(JSON.stringify({
            uid: snapshot.id,
            before: summarizeEntitlement(data.entitlement),
            after: {
                premium: false,
                status: "free",
                source: "none",
                providerMode: null
            }
        }));
    });

    if (!SHOULD_COMMIT) {
        console.log("Dry run only. Re-run with --commit to write backups and downgrade entitlements.");
        return;
    }

    const committedWrites = await commitDowngrades(db, candidates.map(({ snapshot }) => snapshot));
    console.log(`Committed ${committedWrites} write(s) for ${candidates.length} user(s).`);
    console.log(`Backups written under _migrationBackups/${RUN_ID}/users/{uid}.`);
}

main().catch(error => {
    console.error("Downgrade failed:", error);
    process.exitCode = 1;
});
