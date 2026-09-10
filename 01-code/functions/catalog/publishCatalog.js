"use strict";
const { randomUUID } = require("node:crypto");
const { normalizePark, validateCatalog, encodeSnapshot, sha256, MAX_BYTES } = require("./catalogSchema");

// I/O is injected so tests exercise real ordering/preconditions without cloud writes.
function createPublisher({ objects, lease, readRows, now = Date.now }) {
    let pending;
    async function publishCandidate() {
        const owner = randomUUID();
        if (!(await lease.acquire(owner, now()))) return { status: "busy" };
        try {
            const pointer = await objects.read("manifest.json");
            let previous = null, manifest = null;
            if (pointer) {
                manifest = JSON.parse(pointer.bytes);
                if (!/^revisions\/\d+-[a-f0-9]{64}\.json$/.test(manifest.path)) throw new Error("catalog_previous_path");
                const payload = await objects.read(manifest.path);
                if (!payload || payload.bytes.length !== manifest.bytes || sha256(payload.bytes) !== manifest.sha256) throw new Error("catalog_previous_integrity");
                previous = JSON.parse(payload.bytes);
                validateCatalog(previous);
                if (previous.revision !== manifest.revision || previous.sourceRevision !== manifest.sourceRevision) throw new Error("catalog_previous_revision");
            }
            // A single authenticated source read happens after the lease and baseline capture.
            const rows = await readRows();
            const revision = Math.max(now(), (previous?.revision || 0) + 1);
            const candidate = encodeSnapshot(rows.map(normalizePark), {
                revision, publishedAt: new Date(now()).toISOString(), previous,
                retiredParkIDs: previous?.retiredParkIDs || []
            });
            if (candidate.snapshot.sourceRevision === previous?.sourceRevision) return { status: "unchanged", manifest };
            await objects.create(candidate.manifest.path, candidate.bytes, "public,max-age=31536000,immutable");
            // A lost/expired lease may leave an orphan payload. It can never promote an obsolete pointer.
            if (!(await lease.isOwner(owner, now()))) return { status: "superseded" };
            try {
                await objects.replace("manifest.json", Buffer.from(JSON.stringify(candidate.manifest)), pointer?.generation || "0", "public,max-age=0,must-revalidate");
            } catch (error) {
                if (Number(error.code) === 412) return { status: "superseded" };
                throw error;
            }
            return { status: "published", manifest: candidate.manifest };
        } finally { await lease.release(owner); }
    }
    return {
        publishCatalog() {
            if (!pending) pending = publishCandidate().finally(() => { pending = null; });
            return pending;
        }
    };
}

// Generation-specific reads prevent metadata/body races. Object write preconditions are enforced by GCS.
function cloudObjects(bucket) {
    const name = relative => `native-catalog/v1/${relative}`;
    return {
        async read(relative) {
            let metadata;
            try { [metadata] = await bucket.file(name(relative)).getMetadata(); }
            catch (error) { if (Number(error.code) === 404) return null; throw error; }
            if (Number(metadata.size) > MAX_BYTES) throw new Error("catalog_stored_size");
            const [bytes] = await bucket.file(name(relative), { generation: metadata.generation }).download({ validation: "crc32c" });
            return { bytes, generation: metadata.generation };
        },
        async create(relative, bytes, cacheControl) {
            await bucket.file(name(relative)).save(bytes, { resumable: false, validation: "crc32c",
                preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: "application/json", cacheControl } });
        },
        async replace(relative, bytes, generation, cacheControl) {
            await bucket.file(name(relative)).save(bytes, { resumable: false, validation: "crc32c",
                preconditionOpts: { ifGenerationMatch: generation }, metadata: { contentType: "application/json", cacheControl } });
        }
    };
}
function firestoreLease(db) {
    const ref = db.doc("_nativeCatalog/publicationLease");
    return {
        acquire: (owner, now) => db.runTransaction(async tx => {
            const record = (await tx.get(ref)).data();
            if (record?.expiresAt > now) return false;
            tx.set(ref, { owner, expiresAt: now + 120000 }); return true;
        }),
        isOwner: async (owner, now) => { const record = (await ref.get()).data(); return record?.owner === owner && record.expiresAt > now; },
        release: owner => db.runTransaction(async tx => {
            if ((await tx.get(ref)).data()?.owner === owner) tx.delete(ref);
        })
    };
}
module.exports = { createPublisher, cloudObjects, firestoreLease };
