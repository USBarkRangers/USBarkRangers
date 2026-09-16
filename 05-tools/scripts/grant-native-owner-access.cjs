'use strict';

// Administrator-only, explicit owner authorization required. No app/callable grant path.
// Install a build supporting source "owner" before committing this access record.
const { assertNativeProject } = require('./check-native-firebase-project.cjs');
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');

async function main() {
    const [project, email, mode = '--dry-run'] = process.argv.slice(2);
    assertNativeProject(project);
    if (!email?.includes('@') || !['--dry-run', '--commit'].includes(mode)
        || process.argv.length > 5 || process.env.FIRESTORE_EMULATOR_HOST
        || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FUNCTIONS_EMULATOR) {
        throw new Error('Supply bark-ranger-ios, the authorized owner email, and --dry-run or --commit.');
    }
    const owner = auth.getProjectDefaultAccount(process.cwd());
    if (!owner?.tokens.refresh_token) throw new Error('Administrator login required.');
    auth.setRefreshToken(owner.tokens.refresh_token);
    const identity = new Client({ urlPrefix: 'https://identitytoolkit.googleapis.com', auth: true });
    const users = (await identity.post('/v1/projects/bark-ranger-ios/accounts:lookup', { email: [email] })).body.users ?? [];
    if (users.length !== 1 || users[0].email?.toLowerCase() !== email.toLowerCase()
        || users[0].disabled || !users[0].providerUserInfo?.some(p => p.providerId === 'apple.com')) {
        throw new Error('The exact enabled owner account must already have Apple sign-in linked.');
    }
    const uid = users[0].localId;
    if (!uid || uid.includes('/')) throw new Error('Invalid resolved account identity.');
    const db = new Client({ urlPrefix: 'https://firestore.googleapis.com', auth: true });
    const root = 'projects/bark-ranger-ios/databases/(default)/documents';
    const profile = (await db.get(`/v1/${root}/users/${uid}`)).body;
    if (profile.fields?.status?.stringValue !== 'active') throw new Error('The native account must be active.');
    const name = `${root}/users/${uid}/state/entitlement`;
    const current = (await db.get('/v1/' + name)).body;
    const fields = current.fields ?? {};
    const alreadyGranted = fields.source?.stringValue === 'owner' && fields.premium?.booleanValue === true
        && fields.ownerUID?.stringValue === uid && Object.hasOwn(fields.validUntil ?? {}, 'nullValue');
    if (alreadyGranted) {
        console.log(JSON.stringify({ project, email, status: 'already-granted', source: 'owner', expiresAt: null }));
        return;
    }
    if (!['none', 'development'].includes(fields.source?.stringValue)) {
        throw new Error('Refusing to overwrite purchase-derived or unrecognized access.');
    }
    const revision = Number(fields.revision?.integerValue) + 1;
    if (fields.schemaVersion?.integerValue !== '1' || !Number.isSafeInteger(revision) || revision < 2) {
        throw new Error('Invalid access contract.');
    }
    if (mode === '--commit') {
        const now = new Date().toISOString();
        await db.post(`/v1/${root}:commit`, { writes: [
            { verify: profile.name, currentDocument: { updateTime: profile.updateTime } },
            { update: { name, fields: {
                schemaVersion: { integerValue: '1' }, revision: { integerValue: String(revision) },
                premium: { booleanValue: true }, source: { stringValue: 'owner' },
                ownerUID: { stringValue: uid }, validUntil: { nullValue: null },
                ownerGrantedAt: { timestampValue: now }, updatedAt: { timestampValue: now },
            } }, currentDocument: { updateTime: current.updateTime } },
        ] });
        const saved = (await db.get('/v1/' + name)).body.fields;
        if (saved.source?.stringValue !== 'owner' || saved.premium?.booleanValue !== true
            || saved.ownerUID?.stringValue !== uid || !Object.hasOwn(saved.validUntil ?? {}, 'nullValue')
            || saved.revision?.integerValue !== String(revision)) {
            throw new Error('Owner access read-back did not match; inspect before retrying.');
        }
    }
    console.log(JSON.stringify({ project, email, status: mode === '--commit' ? 'granted-and-verified' : 'dry-run',
        previousSource: fields.source.stringValue, source: 'owner', expiresAt: null }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
