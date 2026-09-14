'use strict';

// Keyless, project-scoped deployment. The owner login may impersonate only this
// separately provisioned deployment identity; the CLI runs with no saved user login.
const { mkdtempSync, writeFileSync, unlinkSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { assertNativeProject } = require('./check-native-firebase-project.cjs');
const auth = require('firebase-tools/lib/auth');
const api = require('firebase-tools/lib/api');
const { GoogleAuth } = require('google-auth-library');

async function main() {
    const project = process.argv[2];
    assertNativeProject(project);
    const root = resolve(__dirname, '../..');
    if (process.cwd() !== root || process.argv.length !== 3) throw new Error('Run from the repository root with exactly bark-ranger-ios.');
    for (const key of ['FIREBASE_TOKEN', 'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FUNCTIONS_EMULATOR']) {
        if (process.env[key]) throw new Error(`Remove ${key} before native deployment.`);
    }
    const owner = auth.getProjectDefaultAccount(root);
    if (!owner?.tokens.refresh_token) throw new Error('A signed-in owner is required for keyless impersonation.');
    const principal = 'native-ios-deployer@bark-ranger-ios.iam.gserviceaccount.com';
    const credentials = {
        type: 'impersonated_service_account',
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${principal}:generateAccessToken`,
        source_credentials: { type: 'authorized_user', client_id: api.clientId(),
            client_secret: api.clientSecret(), refresh_token: owner.tokens.refresh_token },
    };
    // Check impersonation before starting Firebase. Never fall back to the owner.
    const client = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    await client.getAccessToken();
    const directory = mkdtempSync(join(tmpdir(), 'bark-native-deploy-'));
    const credentialPath = join(directory, 'adc.json');
    // Temporary SDK input, not a service-account key. Removed even if deployment fails.
    writeFileSync(credentialPath, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
    console.log(`Deploying native functions/rules/indexes as ${principal}; no hosting target.`);
    try {
        const child = spawn(process.execPath, [require.resolve('firebase-tools/lib/bin/firebase'),
            'deploy', '--config', 'firebase.native.json', '--project', project,
            '--only', 'functions:native-ios,firestore', '--non-interactive'], {
            cwd: root, stdio: 'inherit', env: { ...process.env,
                PATH: `${require('node:path').dirname(process.execPath)}:${process.env.PATH}`,
                XDG_CONFIG_HOME: directory, GOOGLE_APPLICATION_CREDENTIALS: credentialPath },
        });
        const code = await new Promise((resolve, reject) => {
            child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
        });
        if (code !== 0) throw new Error(`Native deployment exited ${code}.`);
    } finally {
        unlinkSync(credentialPath);
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
