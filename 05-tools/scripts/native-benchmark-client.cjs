'use strict';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const nativeRequire = createRequire(resolve(__dirname, '../../01-code/functions-native/package.json'));
const { Firestore } = nativeRequire('@google-cloud/firestore');
const { assertNativeProject } = require('./check-native-firebase-project.cjs');

async function benchmarkClient(arguments_) {
    assert.equal(process.cwd(), resolve(__dirname, '../..'));
    const cloud = arguments_[0] === '--cloud';
    let project, credentials;
    if (cloud) {
        assert.equal(arguments_.length, 2);
        assertNativeProject(arguments_[1]); project = arguments_[1];
        assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
        const auth = require('firebase-tools/lib/auth'), api = require('firebase-tools/lib/api');
        const { GoogleAuth } = require('google-auth-library');
        const owner = auth.getProjectDefaultAccount(process.cwd());
        assert(owner?.tokens.refresh_token, 'Owner login is needed for native-only impersonation.');
        // Same native-scoped identity as deployment; no owner fallback or key file.
        const principal = 'native-ios-deployer@bark-ranger-ios.iam.gserviceaccount.com';
        credentials = {
            type: 'impersonated_service_account',
            service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${principal}:generateAccessToken`,
            source_credentials: { type: 'authorized_user', client_id: api.clientId(),
                client_secret: api.clientSecret(), refresh_token: owner.tokens.refresh_token },
        };
        const provider = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'], credentials });
        assert(await provider.getAccessToken());
    } else {
        assert.deepEqual(arguments_, ['--emulator']);
        assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
        assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
        project = 'demo-bark-native';
    }
    // Let Firestore construct its compatible auth client from the keyless input.
    // Do not inject the CLI's different GoogleAuth major into its gRPC transport.
    const db = new Firestore({ projectId: project, ...(credentials ? { credentials } : {}) });
    return { db, cloud, project, async close() { await db.terminate(); } };
}
module.exports = { benchmarkClient, nativeRequire };
