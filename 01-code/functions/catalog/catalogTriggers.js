"use strict";
const { createHmac, timingSafeEqual } = require("node:crypto");
const { createPublisher, cloudObjects, firestoreLease } = require("./publishCatalog");
const { readSourceRows } = require("./sourceSheet");

function verifySignal(body, signature, secret, now) {
    if (!secret || typeof body?.timestamp !== "number" || !Number.isSafeInteger(body.timestamp) ||
        Math.abs(now - body.timestamp) > 120000 || !/^[a-f0-9-]{36}$/.test(body.nonce || "") ||
        !/^[a-f0-9]{64}$/.test(signature || "")) return false;
    const expected = createHmac("sha256", secret).update(`${body.timestamp}.${body.nonce}`).digest();
    return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

// A single high-water mark prevents replay without an ever-growing nonce collection.
async function claimEditSignal(db, body) {
    const ref = db.doc("_nativeCatalog/editSignal");
    return db.runTransaction(async tx => {
        const previous = (await tx.get(ref)).data();
        if (previous?.timestamp >= body.timestamp) return false;
        tx.set(ref, { timestamp: body.timestamp, nonce: body.nonce }); return true;
    });
}

function createCatalogTriggers({ admin, google, requireAdmin, env = process.env, now = Date.now }) {
    let publisher;
    const enabled = () => env.BARK_NATIVE_CATALOG_ENABLED === "true";
    function getPublisher() {
        if (!enabled()) throw new Error("native_catalog_not_configured");
        const project = env.GCLOUD_PROJECT || admin.app().options.projectId;
        if (project !== "barkrangermap-auth") throw new Error("native_catalog_wrong_project");
        if (!env.BARK_NATIVE_CATALOG_BUCKET || !env.BARK_CATALOG_SHEET_ID || !env.BARK_CATALOG_SHEET_RANGE) throw new Error("native_catalog_missing_configuration");
        if (!publisher) {
            const auth = new google.auth.GoogleAuth({ scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
            const sheets = google.sheets({ version: "v4", auth });
            publisher = createPublisher({ objects: cloudObjects(admin.storage().bucket(env.BARK_NATIVE_CATALOG_BUCKET)),
                lease: firestoreLease(admin.firestore()), readRows: () => readSourceRows({ sheets,
                    spreadsheetId: env.BARK_CATALOG_SHEET_ID, range: env.BARK_CATALOG_SHEET_RANGE }), now });
        }
        return publisher;
    }
    async function publishNow(data, context) {
        await requireAdmin(context, "publishNativeCatalog");
        return getPublisher().publishCatalog();
    }
    async function reconcileCatalog() {
        if (!enabled()) return { status: "disabled" };
        return getPublisher().publishCatalog();
    }
    async function handleEditSignal(req, res) {
        res.set("Cache-Control", "no-store");
        if (req.method !== "POST") return res.status(405).send("method_not_allowed");
        if (!enabled()) return res.status(503).send("not_configured");
        if (!verifySignal(req.body, req.get("X-Bark-Catalog-Signature"), env.BARK_CATALOG_EDIT_SECRET, now())) return res.status(401).send("invalid_signal");
        try {
            const service = getPublisher();
            const accepted = await claimEditSignal(admin.firestore(), req.body);
            if (!accepted) return res.status(409).send("replayed_signal");
            const result = await service.publishCatalog();
            return res.status(result.status === "busy" ? 202 : 200).json(result);
        } catch (_) { return res.status(503).send("publication_unavailable"); }
    }
    async function afterAcceptedSheetWrite() {
        if (!enabled()) return { status: "disabled" };
        // The sheet write is already accepted. A publication failure must not invite duplicate appends.
        try { return await getPublisher().publishCatalog(); }
        catch (_) { console.warn("[native-catalog] Accepted sheet edit awaits reconciliation."); return { status: "pending" }; }
    }
    return { publishNow, reconcileCatalog, handleEditSignal, afterAcceptedSheetWrite };
}
module.exports = { verifySignal, claimEditSignal, createCatalogTriggers };
