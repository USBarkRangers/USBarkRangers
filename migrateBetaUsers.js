#!/usr/bin/env node
/**
 * One-time beta migration from legacy lat_lng visit IDs to canonical Park ID UUIDs.
 *
 * Dry run:
 *   node scripts/migrateBetaUsers.js
 *
 * Commit:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node scripts/migrateBetaUsers.js --commit
 */

const admin = require('firebase-admin');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1fnlZfRbfQIy-o2Df6FgEdTMw9OWTR3-JX011s-7oWlE';
const SHEET_NAME = 'National B.A.R.K Ranger';
const args = new Set(process.argv.slice(2));
const SHOULD_COMMIT = args.has('--commit');
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? Number(LIMIT_ARG.split('=')[1]) : null;

function cleanCSVValue(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function getRowValue(row, headerMap, headerName) {
    const index = headerMap.get(headerName.toLowerCase());
    return index === undefined ? '' : cleanCSVValue(row[index]);
}

function generateLegacyPinId(lat, lng) {
    return `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;
}

function normalizeName(value) {
    return cleanCSVValue(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function loadLegacyIdMap() {
    const auth = new google.auth.GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${SHEET_NAME}'!A:P`
    });

    const values = response.data.values || [];
    const headers = values[0] || [];
    const headerMap = new Map(headers.map((header, index) => [cleanCSVValue(header).toLowerCase(), index]));
    const rows = values.slice(1);
    const legacyCandidates = new Map();
    const collisions = [];
    let skipped = 0;

    rows.forEach((row, index) => {
        const parkId = getRowValue(row, headerMap, 'Park id') || getRowValue(row, headerMap, 'Park ID');
        let lat = getRowValue(row, headerMap, 'lat');
        let lng = getRowValue(row, headerMap, 'lng');
        const name = getRowValue(row, headerMap, 'Location');

        if (name.includes('War in the Pacific')) {
            lat = '13.402746';
            lng = '144.6632005';
        }

        if (!parkId || !lat || !lng) {
            skipped++;
            return;
        }

        const legacyId = generateLegacyPinId(lat, lng);
        if (!legacyCandidates.has(legacyId)) legacyCandidates.set(legacyId, []);
        const candidates = legacyCandidates.get(legacyId);
        if (candidates.some(candidate => candidate.parkId === parkId)) return;
        if (candidates.length > 0) collisions.push({ rowNumber: index + 2, legacyId });
        candidates.push({ parkId, name });
    });

    if (collisions.length) {
        console.warn(`Found ${collisions.length} rounded lat_lng collision(s); visit names will be used to disambiguate.`);
    }

    console.log(`Loaded ${legacyCandidates.size} legacy→Park ID mapping bucket(s) from Google Sheet. Skipped ${skipped} incomplete rows.`);
    return legacyCandidates;
}

function resolveTargetParkId(visit, legacyCandidates) {
    const candidates = legacyCandidates.get(visit.id);
    if (!candidates || candidates.length === 0) return { targetId: null, ambiguous: false };
    if (candidates.length === 1) return { targetId: candidates[0].parkId, ambiguous: false };

    const visitName = normalizeName(visit.name);
    const exact = candidates.find(candidate => normalizeName(candidate.name) === visitName);
    if (exact) return { targetId: exact.parkId, ambiguous: false };

    const contains = candidates.find(candidate => {
        const candidateName = normalizeName(candidate.name);
        return visitName && (candidateName.includes(visitName) || visitName.includes(candidateName));
    });
    if (contains) return { targetId: contains.parkId, ambiguous: false };

    return { targetId: null, ambiguous: true };
}

function migrateVisitArray(visitedPlaces, legacyCandidates) {
    const byId = new Map();
    const migratedLegacyIds = [];
    const unresolvedLegacyIds = [];
    let changed = false;

    visitedPlaces.forEach(visit => {
        if (!visit || !visit.id) return;

        const { targetId, ambiguous } = resolveTargetParkId(visit, legacyCandidates);
        if (ambiguous) unresolvedLegacyIds.push(visit.id);
        if (!targetId) {
            byId.set(visit.id, visit);
            return;
        }

        changed = true;
        migratedLegacyIds.push(visit.id);
        if (!byId.has(targetId)) {
            byId.set(targetId, {
                ...visit,
                id: targetId,
                migratedFromLegacyId: visit.migratedFromLegacyId || visit.id,
                migratedAt: visit.migratedAt || Date.now()
            });
        }
    });

    return {
        changed,
        migratedLegacyIds,
        unresolvedLegacyIds,
        visitedPlaces: Array.from(byId.values())
    };
}

function migrateVisitMap(visitedPlaces, legacyCandidates) {
    const next = { ...visitedPlaces };
    const migratedLegacyIds = [];
    const unresolvedLegacyIds = [];
    let changed = false;

    Object.entries(visitedPlaces).forEach(([legacyId, visit]) => {
        const { targetId, ambiguous } = resolveTargetParkId({ ...(visit || {}), id: legacyId }, legacyCandidates);
        if (ambiguous) unresolvedLegacyIds.push(legacyId);
        if (!targetId) return;

        changed = true;
        migratedLegacyIds.push(legacyId);
        if (!next[targetId]) {
            next[targetId] = {
                ...(visit || {}),
                id: targetId,
                migratedFromLegacyId: (visit && visit.migratedFromLegacyId) || legacyId,
                migratedAt: (visit && visit.migratedAt) || Date.now()
            };
        }
        delete next[legacyId];
    });

    return {
        changed,
        migratedLegacyIds,
        unresolvedLegacyIds,
        visitedPlaces: next
    };
}

function migrateUserData(data, legacyCandidates) {
    const visitedPlaces = data.visitedPlaces;
    if (Array.isArray(visitedPlaces)) return migrateVisitArray(visitedPlaces, legacyCandidates);
    if (visitedPlaces && typeof visitedPlaces === 'object') return migrateVisitMap(visitedPlaces, legacyCandidates);
    return { changed: false, migratedLegacyIds: [], unresolvedLegacyIds: [], visitedPlaces };
}

async function main() {
    admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'barkrangermap-auth'
    });

    const db = admin.firestore();
    const legacyCandidates = await loadLegacyIdMap();
    let query = db.collection('users');
    if (Number.isFinite(LIMIT) && LIMIT > 0) query = query.limit(LIMIT);

    const snapshot = await query.get();
    let batch = db.batch();
    let batchOps = 0;
    let usersScanned = 0;
    let usersChanged = 0;
    let visitsMigrated = 0;
    let unresolvedVisits = 0;
    const pendingCommits = [];

    snapshot.forEach(doc => {
        usersScanned++;
        const data = doc.data() || {};
        const result = migrateUserData(data, legacyCandidates);
        if (result.unresolvedLegacyIds.length) {
            unresolvedVisits += result.unresolvedLegacyIds.length;
            console.warn(`UNRESOLVED ${doc.id}: ${result.unresolvedLegacyIds.join(', ')}`);
        }
        if (!result.changed) return;

        usersChanged++;
        visitsMigrated += result.migratedLegacyIds.length;
        console.log(`${SHOULD_COMMIT ? 'MIGRATE' : 'DRY RUN'} ${doc.id}: ${result.migratedLegacyIds.join(', ')}`);

        if (SHOULD_COMMIT) {
            if (batchOps >= 450) {
                pendingCommits.push(batch.commit());
                batch = db.batch();
                batchOps = 0;
            }
            batch.update(doc.ref, {
                visitedPlaces: result.visitedPlaces,
                betaVisitMigration: {
                    migratedAt: admin.firestore.FieldValue.serverTimestamp(),
                    migratedLegacyIds: result.migratedLegacyIds,
                    previousVisitedPlaces: data.visitedPlaces || null
                }
            });
            batchOps++;
        }
    });

    if (SHOULD_COMMIT && batchOps > 0) pendingCommits.push(batch.commit());
    if (pendingCommits.length) await Promise.all(pendingCommits);

    console.log(JSON.stringify({
        mode: SHOULD_COMMIT ? 'commit' : 'dry-run',
        usersScanned,
        usersChanged,
        visitsMigrated,
        unresolvedVisits
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
