#!/usr/bin/env node
/**
 * One-time beta user migration to canonical Park ID UUID visit records.
 *
 * Dry run all users:
 *   node scripts/migrateBetaUsers.js
 *
 * Commit all resolvable users, backing up each changed document first:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/migrateBetaUsers.js --commit
 *
 * If dry run reports unresolved legacy visits, either fix the sheet/data and rerun,
 * or intentionally drop those old non-canonical records:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/migrateBetaUsers.js --commit --drop-unresolved
 */

const admin = require('firebase-admin');
const { google } = require('googleapis');

const DEFAULT_PROJECT_ID = 'barkrangermap-auth';
const SPREADSHEET_ID = '1fnlZfRbfQIy-o2Df6FgEdTMw9OWTR3-JX011s-7oWlE';
const SHEET_NAME = 'National B.A.R.K Ranger';
const CANONICAL_PARK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const args = new Set(process.argv.slice(2));
const SHOULD_COMMIT = args.has('--commit');
const DROP_UNRESOLVED = args.has('--drop-unresolved');
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='));
const UID_ARG = process.argv.find(arg => arg.startsWith('--uid='));
const PROJECT_ARG = process.argv.find(arg => arg.startsWith('--project='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : null;
const ONLY_UID = UID_ARG ? UID_ARG.split('=').slice(1).join('=').trim() : '';
const PROJECT_ID = PROJECT_ARG
    ? PROJECT_ARG.split('=').slice(1).join('=').trim()
    : (process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || DEFAULT_PROJECT_ID);
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');

function printUsage() {
    console.log(`
Usage:
  node scripts/migrateBetaUsers.js [options]

Options:
  --commit             Write migrated canonical visitedPlaces to Firestore.
  --drop-unresolved    During commit, delete old legacy visits that cannot map to a current Park ID.
  --limit=N            Scan only the first N users.
  --uid=UID            Scan only one user document.
  --project=PROJECT    Firebase project id. Defaults to ${DEFAULT_PROJECT_ID}.

Default mode is dry-run. Commit mode writes a backup to:
  _migrationBackups/visit-id-migration-<run-id>/users/{uid}
`);
}

if (args.has('--help') || args.has('-h')) {
    printUsage();
    process.exit(0);
}

function cleanValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function normalizeKey(value) {
    return cleanValue(value).toLowerCase();
}

function normalizeName(value) {
    return cleanValue(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function isCanonicalParkId(value) {
    return CANONICAL_PARK_ID_PATTERN.test(cleanValue(value));
}

function isLegacyParkId(value) {
    return /^-?\d+\.\d{2}_-?\d+\.\d{2}$/.test(cleanValue(value));
}

function generateLegacyPinId(lat, lng) {
    const parsedLat = parseFiniteNumber(lat);
    const parsedLng = parseFiniteNumber(lng);
    if (parsedLat === null || parsedLng === null) return '';
    return `${parsedLat.toFixed(2)}_${parsedLng.toFixed(2)}`;
}

function exactCoordKey(lat, lng) {
    const parsedLat = parseFiniteNumber(lat);
    const parsedLng = parseFiniteNumber(lng);
    if (parsedLat === null || parsedLng === null) return '';
    return `${parsedLat.toFixed(6)}_${parsedLng.toFixed(6)}`;
}

function getHeaderMap(headers) {
    return new Map((headers || []).map((header, index) => [normalizeKey(header), index]));
}

function getRowValue(row, headerMap, headerNames) {
    const names = Array.isArray(headerNames) ? headerNames : [headerNames];
    for (const headerName of names) {
        const index = headerMap.get(normalizeKey(headerName));
        if (index !== undefined) return cleanValue(row[index]);
    }
    return '';
}

function addBucket(map, key, value) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    const bucket = map.get(key);
    if (!bucket.some(item => item.parkId === value.parkId)) bucket.push(value);
}

function pickCandidate(visit, candidates) {
    if (!candidates || candidates.length === 0) return { candidate: null, ambiguous: false };
    if (candidates.length === 1) return { candidate: candidates[0], ambiguous: false };

    const visitName = normalizeName(visit && visit.name);
    if (visitName) {
        const exact = candidates.find(candidate => normalizeName(candidate.name) === visitName);
        if (exact) return { candidate: exact, ambiguous: false };

        const contains = candidates.find(candidate => {
            const candidateName = normalizeName(candidate.name);
            return candidateName.includes(visitName) || visitName.includes(candidateName);
        });
        if (contains) return { candidate: contains, ambiguous: false };
    }

    return { candidate: null, ambiguous: true };
}

async function loadCanonicalParkIndex() {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A:Z`
    });

    const values = response.data.values || [];
    const headers = values[0] || [];
    const headerMap = getHeaderMap(headers);
    const rows = values.slice(1);
    const byParkId = new Map();
    const byLegacyId = new Map();
    const byExactCoords = new Map();
    const byName = new Map();
    const collisions = [];
    let skipped = 0;

    rows.forEach((row, index) => {
        const parkId = getRowValue(row, headerMap, ['Park ID', 'Park id', 'parkId']);
        const name = getRowValue(row, headerMap, ['Location', 'name']);
        const state = getRowValue(row, headerMap, ['State']);
        const category = getRowValue(row, headerMap, ['Type', 'Category']);
        let lat = getRowValue(row, headerMap, ['lat', 'Latitude']);
        let lng = getRowValue(row, headerMap, ['lng', 'Longitude']);

        if (name.includes('War in the Pacific')) {
            lat = '13.402746';
            lng = '144.6632005';
        }

        if (!isCanonicalParkId(parkId) || !name || !lat || !lng) {
            skipped++;
            return;
        }

        const canonicalPark = {
            parkId,
            name,
            state,
            category,
            lat: parseFiniteNumber(lat),
            lng: parseFiniteNumber(lng)
        };

        byParkId.set(parkId, canonicalPark);

        const legacyId = generateLegacyPinId(lat, lng);
        const existingLegacyBucket = byLegacyId.get(legacyId);
        if (existingLegacyBucket && existingLegacyBucket.length > 0) {
            collisions.push({ rowNumber: index + 2, legacyId, parkId });
        }
        addBucket(byLegacyId, legacyId, canonicalPark);
        addBucket(byExactCoords, exactCoordKey(lat, lng), canonicalPark);
        addBucket(byName, normalizeName(name), canonicalPark);
    });

    if (collisions.length) {
        console.warn(`Found ${collisions.length} rounded coordinate collision(s); names will be used to disambiguate.`);
    }
    console.log(`Loaded ${byParkId.size} canonical Park ID row(s). Skipped ${skipped} incomplete/non-canonical row(s).`);

    return { byParkId, byLegacyId, byExactCoords, byName };
}

function resolveCanonicalPark(visit, index) {
    if (!visit || !visit.id) return { candidate: null, ambiguous: false, reason: 'missing-id' };

    const visitId = cleanValue(visit.id);
    if (isCanonicalParkId(visitId) && index.byParkId.has(visitId)) {
        return { candidate: index.byParkId.get(visitId), ambiguous: false, reason: 'canonical' };
    }

    const legacyPick = pickCandidate(visit, index.byLegacyId.get(visitId));
    if (legacyPick.candidate || legacyPick.ambiguous) {
        return { ...legacyPick, reason: 'legacy-id' };
    }

    const exactPick = pickCandidate(visit, index.byExactCoords.get(exactCoordKey(visit.lat, visit.lng)));
    if (exactPick.candidate || exactPick.ambiguous) {
        return { ...exactPick, reason: 'exact-coords' };
    }

    const namePick = pickCandidate(visit, index.byName.get(normalizeName(visit.name)));
    if (namePick.candidate || namePick.ambiguous) {
        return { ...namePick, reason: 'name' };
    }

    return { candidate: null, ambiguous: false, reason: 'unresolved' };
}

function isLegacyVisit(visit, index) {
    const visitId = cleanValue(visit && visit.id);
    return !isCanonicalParkId(visitId) || !index.byParkId.has(visitId);
}

function selectVisitTimestamp(left, right) {
    const leftTs = Number(left && left.ts);
    const rightTs = Number(right && right.ts);
    if (Number.isFinite(leftTs) && Number.isFinite(rightTs)) return Math.min(leftTs, rightTs);
    if (Number.isFinite(leftTs)) return leftTs;
    if (Number.isFinite(rightTs)) return rightTs;
    return (left && left.ts) || (right && right.ts) || Date.now();
}

function canonicalVisitRecord(visit, canonicalPark) {
    return {
        id: canonicalPark.parkId,
        name: canonicalPark.name,
        lat: canonicalPark.lat,
        lng: canonicalPark.lng,
        state: canonicalPark.state || visit.state || '',
        verified: Boolean(visit.verified),
        ts: Number.isFinite(Number(visit.ts)) ? Number(visit.ts) : Date.now()
    };
}

function mergeCanonicalVisits(existing, incoming) {
    if (!existing) return incoming;
    return {
        ...existing,
        ...incoming,
        verified: Boolean(existing.verified || incoming.verified),
        ts: selectVisitTimestamp(existing, incoming)
    };
}

function getVisitEntries(rawVisitedPlaces) {
    if (Array.isArray(rawVisitedPlaces)) {
        return rawVisitedPlaces
            .filter(visit => visit && visit.id)
            .map(visit => ({ sourceId: cleanValue(visit.id), visit: { ...visit, id: cleanValue(visit.id) } }));
    }

    if (rawVisitedPlaces && typeof rawVisitedPlaces === 'object') {
        return Object.entries(rawVisitedPlaces)
            .filter(([sourceId]) => sourceId)
            .map(([sourceId, visit]) => ({
                sourceId: cleanValue(sourceId),
                visit: { ...(visit || {}), id: cleanValue((visit && visit.id) || sourceId) }
            }));
    }

    return [];
}

function migrateUserVisits(rawVisitedPlaces, index) {
    const byCanonicalId = new Map();
    const migratedLegacyIds = [];
    const droppedLegacyIds = [];
    const unresolvedLegacyIds = [];
    const alreadyCanonicalIds = [];
    let normalizedCanonicalRecords = 0;
    const entries = getVisitEntries(rawVisitedPlaces);

    entries.forEach(({ sourceId, visit }) => {
        const resolution = resolveCanonicalPark(visit, index);
        const legacy = isLegacyVisit(visit, index) || sourceId !== visit.id || isLegacyParkId(sourceId);

        if (!resolution.candidate) {
            if (legacy) {
                unresolvedLegacyIds.push({ id: sourceId, name: visit.name || '', reason: resolution.reason, ambiguous: resolution.ambiguous });
                if (DROP_UNRESOLVED) {
                    droppedLegacyIds.push(sourceId);
                    return;
                }
            }
            return;
        }

        const nextVisit = canonicalVisitRecord(visit, resolution.candidate);
        byCanonicalId.set(nextVisit.id, mergeCanonicalVisits(byCanonicalId.get(nextVisit.id), nextVisit));

        if (legacy || sourceId !== nextVisit.id || visit.id !== nextVisit.id) {
            migratedLegacyIds.push(sourceId);
        } else if (
            visit.name !== nextVisit.name ||
            Number(visit.lat) !== Number(nextVisit.lat) ||
            Number(visit.lng) !== Number(nextVisit.lng) ||
            (visit.state || '') !== (nextVisit.state || '')
        ) {
            normalizedCanonicalRecords++;
        } else {
            alreadyCanonicalIds.push(nextVisit.id);
        }
    });

    const nextVisitedPlaces = Array.from(byCanonicalId.values())
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    const originalCanonicalIds = new Set(entries
        .filter(({ visit }) => isCanonicalParkId(visit.id) && index.byParkId.has(visit.id))
        .map(({ visit }) => visit.id));
    const nextCanonicalIds = new Set(nextVisitedPlaces.map(visit => visit.id));
    const changed = migratedLegacyIds.length > 0 ||
        droppedLegacyIds.length > 0 ||
        normalizedCanonicalRecords > 0 ||
        (!Array.isArray(rawVisitedPlaces) && entries.length > 0) ||
        originalCanonicalIds.size !== nextCanonicalIds.size ||
        Array.from(originalCanonicalIds).some(id => !nextCanonicalIds.has(id));

    return {
        changed,
        nextVisitedPlaces,
        migratedLegacyIds: Array.from(new Set(migratedLegacyIds)),
        droppedLegacyIds: Array.from(new Set(droppedLegacyIds)),
        unresolvedLegacyIds,
        alreadyCanonicalCount: alreadyCanonicalIds.length
    };
}

async function getUserSnapshots(db) {
    if (ONLY_UID) {
        const doc = await db.collection('users').doc(ONLY_UID).get();
        return doc.exists ? [doc] : [];
    }

    let query = db.collection('users');
    if (Number.isFinite(LIMIT) && LIMIT > 0) query = query.limit(LIMIT);
    const snapshot = await query.get();
    return snapshot.docs;
}

function summarizePlan(plan) {
    return {
        usersScanned: plan.usersScanned,
        usersChanged: plan.updates.length,
        visitsMigrated: plan.updates.reduce((sum, update) => sum + update.result.migratedLegacyIds.length, 0),
        visitsDropped: plan.updates.reduce((sum, update) => sum + update.result.droppedLegacyIds.length, 0),
        unresolvedLegacyVisits: plan.unresolved.length
    };
}

async function buildMigrationPlan(db, index) {
    const docs = await getUserSnapshots(db);
    const plan = {
        usersScanned: 0,
        updates: [],
        unresolved: []
    };

    docs.forEach(doc => {
        plan.usersScanned++;
        const data = doc.data() || {};
        const result = migrateUserVisits(data.visitedPlaces, index);

        if (result.unresolvedLegacyIds.length) {
            result.unresolvedLegacyIds.forEach(item => {
                plan.unresolved.push({ uid: doc.id, ...item });
            });
        }

        if (!result.changed) return;
        plan.updates.push({
            uid: doc.id,
            ref: doc.ref,
            previousVisitedPlaces: data.visitedPlaces || null,
            result
        });
    });

    return plan;
}

async function commitMigrationPlan(db, plan) {
    let batch = db.batch();
    let batchOps = 0;
    const commits = [];

    function maybeCommitBatch() {
        if (batchOps < 400) return;
        commits.push(batch.commit());
        batch = db.batch();
        batchOps = 0;
    }

    plan.updates.forEach(update => {
        const backupRef = db.collection('_migrationBackups')
            .doc(`visit-id-migration-${RUN_ID}`)
            .collection('users')
            .doc(update.uid);

        batch.set(backupRef, {
            uid: update.uid,
            previousVisitedPlaces: update.previousVisitedPlaces,
            nextVisitedPlaces: update.result.nextVisitedPlaces,
            migratedLegacyIds: update.result.migratedLegacyIds,
            droppedLegacyIds: update.result.droppedLegacyIds,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        batch.update(update.ref, {
            visitedPlaces: update.result.nextVisitedPlaces,
            visitIdMigration: {
                version: 2,
                runId: RUN_ID,
                migratedAt: admin.firestore.FieldValue.serverTimestamp(),
                migratedLegacyIds: update.result.migratedLegacyIds,
                droppedLegacyIds: update.result.droppedLegacyIds,
                canonicalVisitCount: update.result.nextVisitedPlaces.length
            }
        });
        batchOps += 2;
        maybeCommitBatch();
    });

    if (batchOps > 0) commits.push(batch.commit());
    await Promise.all(commits);
}

async function main() {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: PROJECT_ID
    });

    const db = admin.firestore();
    const index = await loadCanonicalParkIndex();
    const plan = await buildMigrationPlan(db, index);

    plan.unresolved.slice(0, 50).forEach(item => {
        console.warn(`UNRESOLVED ${item.uid}: ${item.id} "${item.name}" (${item.reason}${item.ambiguous ? ', ambiguous' : ''})`);
    });
    if (plan.unresolved.length > 50) {
        console.warn(`...and ${plan.unresolved.length - 50} more unresolved legacy visit(s).`);
    }

    plan.updates.forEach(update => {
        console.log(`${SHOULD_COMMIT ? 'MIGRATE' : 'DRY RUN'} ${update.uid}: ` +
            `${update.result.migratedLegacyIds.length} migrated, ` +
            `${update.result.droppedLegacyIds.length} dropped, ` +
            `${update.result.nextVisitedPlaces.length} canonical visit(s)`);
    });

    const summary = summarizePlan(plan);
    console.log(JSON.stringify({
        mode: SHOULD_COMMIT ? 'commit' : 'dry-run',
        projectId: PROJECT_ID,
        runId: RUN_ID,
        dropUnresolved: DROP_UNRESOLVED,
        ...summary
    }, null, 2));

    if (!SHOULD_COMMIT) return;

    if (plan.unresolved.length > 0 && !DROP_UNRESOLVED) {
        throw new Error(
            `Commit blocked: ${plan.unresolved.length} unresolved legacy visit(s). ` +
            `Fix mappings and rerun, or use --drop-unresolved to remove unmapped old records.`
        );
    }

    await commitMigrationPlan(db, plan);
    console.log(`Committed ${plan.updates.length} user migration(s). Backup path: _migrationBackups/visit-id-migration-${RUN_ID}/users/{uid}`);
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
