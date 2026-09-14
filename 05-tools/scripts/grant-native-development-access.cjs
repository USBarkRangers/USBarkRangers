'use strict';

// Operator-only tool: never deployed or callable from the app. The owner supplies
// the exact verified email; the server grant is UID-bound and expires within 14 days.
const { randomUUID } = require('node:crypto');
const { assertNativeProject } = require('./check-native-firebase-project.cjs');
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');

async function main() {
    const [project, email, daysText = '14'] = process.argv.slice(2);
    assertNativeProject(project);
    const days = Number(daysText);
    if (!email?.includes('@') || !Number.isInteger(days) || days < 1 || days > 14
        || process.argv.length > 5 || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) {
        throw new Error('Supply bark-ranger-ios, the explicitly authorized verified email, and 1–14 days.');
    }
    const owner = auth.getProjectDefaultAccount(process.cwd());
    if (!owner?.tokens.refresh_token) throw new Error('Owner administrator login required.');
    auth.setRefreshToken(owner.tokens.refresh_token);
    const identity = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', auth: true });
    const users = (await identity.post('/v1/projects/bark-ranger-ios/accounts:lookup', { email: [email] })).body.users ?? [];
    if (users.length !== 1 || users[0].email?.toLowerCase() !== email.toLowerCase()
        || !users[0].emailVerified || users[0].disabled) {
        throw new Error('The exact new account must exist, be enabled, and verify its email before receiving access.');
    }
    const uid = users[0].localId;
    if (!uid || uid.includes('/')) throw new Error('Invalid resolved account identity.');
    const db = new Client({ urlPrefix: 'https://firestore.googleapis.com', auth: true });
    const root = 'projects/bark-ranger-ios/databases/(default)/documents';
    const profile = (await db.get(`/v1/${root}/users/${uid}`)).body;
    if (profile.fields?.status?.stringValue !== 'active') throw new Error('Open the native account successfully first.');
    const name = `${root}/users/${uid}/state/entitlement`;
    const current = (await db.get('/v1/' + name)).body;
    if (!['none', 'development'].includes(current.fields?.source?.stringValue)) {
        throw new Error('Refusing to overwrite purchase-derived access.');
    }
    const revision = Number(current.fields.revision.integerValue) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('Invalid access revision.');
    const now = new Date(), until = new Date(now.getTime() + days * 86400_000), grantID = randomUUID();
    await db.post(`/v1/${root}:commit`, { writes: [{ update: { name, fields: {
        schemaVersion: { integerValue: '1' }, revision: { integerValue: String(revision) },
        premium: { booleanValue: true }, source: { stringValue: 'development' },
        developmentUID: { stringValue: uid }, developmentGrantID: { stringValue: grantID },
        developmentGrantedAt: { timestampValue: now.toISOString() }, updatedAt: { timestampValue: now.toISOString() },
        validUntil: { timestampValue: until.toISOString() },
    } }, currentDocument: { updateTime: current.updateTime } }] });
    console.log(JSON.stringify({ project, uid, source: 'development', grantID, expiresAt: until.toISOString() }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
