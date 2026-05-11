const fs = require('fs/promises');
const path = require('path');
const { chromium } = require('@playwright/test');

const AUTH_WAIT_TIMEOUT_MS = 300000;
const baseUrl = process.env.BARK_E2E_BASE_URL;
const storageState = process.env.BARK_E2E_STORAGE_STATE;
const authEmail = process.env.BARK_E2E_AUTH_EMAIL;
const authPassword = process.env.BARK_E2E_AUTH_PASSWORD;

function fail(message) {
    console.error(message);
    process.exit(1);
}

function getMissingAuthVars() {
    return [
        !authEmail ? 'BARK_E2E_AUTH_EMAIL' : null,
        !authPassword ? 'BARK_E2E_AUTH_PASSWORD' : null
    ].filter(Boolean);
}

function printAuthTroubleshooting() {
    console.error([
        `Firebase Auth currentUser was not detected within ${AUTH_WAIT_TIMEOUT_MS}ms.`,
        'Troubleshooting:',
        '  - Confirm the local or staging server is running.',
        '  - Confirm the app loaded in the opened browser window.',
        '  - Confirm popup sign-in completed successfully.',
        '  - Confirm Firebase Auth currentUser exists in the browser console:',
        '      firebase.auth().currentUser'
    ].join('\n'));
}

function printManualFallbackWarning(missingAuthVars) {
    console.warn([
        `Automated Firebase Email/Password sign-in is disabled because ${missingAuthVars.join(', ')} is missing.`,
        'Falling back to manual sign-in in the opened browser window.',
        'Warning: Google OAuth may be blocked in Playwright Chromium with "This browser or app may not be secure."',
        'For reliable storage-state setup, use a dedicated Firebase Email/Password test account and set:',
        '  BARK_E2E_AUTH_EMAIL',
        '  BARK_E2E_AUTH_PASSWORD'
    ].join('\n'));
}

async function waitForFirebaseAuthSdk(page) {
    console.log('Waiting for Firebase Auth SDK...');
    await page.waitForFunction(() => {
        return Boolean(
            window.firebase
            && typeof window.firebase.auth === 'function'
        );
    }, undefined, { timeout: AUTH_WAIT_TIMEOUT_MS });
    console.log('Firebase Auth SDK detected.');
}

async function signInWithEmailAndPassword(page) {
    console.log(`Signing in with Firebase Email/Password test account: ${authEmail}`);
    const result = await page.evaluate(async ({ email, password }) => {
        const auth = window.firebase.auth();
        const credential = await auth.signInWithEmailAndPassword(email, password);
        const user = credential.user || auth.currentUser;
        if (!user) throw new Error('Email/Password sign-in completed without a currentUser.');
        return {
            uid: user.uid,
            email: user.email || email
        };
    }, { email: authEmail, password: authPassword });
    console.log(`Email/Password sign-in completed for ${result.email || authEmail}; uid=${result.uid}`);
}

async function waitForCurrentUser(page) {
    console.log(`Waiting up to ${Math.round(AUTH_WAIT_TIMEOUT_MS / 1000)} seconds for Firebase Auth currentUser...`);
    const handle = await page.waitForFunction(() => {
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
        return user ? {
            uid: user.uid,
            email: user.email || null
        } : null;
    }, undefined, { timeout: AUTH_WAIT_TIMEOUT_MS });
    return handle.jsonValue();
}

async function saveStorageState(context, storageStatePath) {
    try {
        await context.storageState({ path: storageStatePath, indexedDB: true });
        return 'with IndexedDB';
    } catch (error) {
        const message = error && error.message ? error.message : String(error);
        if (!/indexedDB|unknown option|unexpected option/i.test(message)) throw error;
        console.warn('This Playwright version does not support IndexedDB in storageState; saving standard storage state only.');
        await context.storageState({ path: storageStatePath });
        return 'without IndexedDB';
    }
}

if (!baseUrl) {
    fail('BARK_E2E_BASE_URL is required, for example: http://localhost:4173/index.html');
}

if (!storageState) {
    fail('BARK_E2E_STORAGE_STATE is required, for example: 03-tests/.auth/free-user.json');
}

try {
    new URL(baseUrl);
} catch (error) {
    fail(`BARK_E2E_BASE_URL must be an absolute URL: ${baseUrl}`);
}

(async () => {
    const storageStatePath = path.resolve(storageState);
    const missingAuthVars = getMissingAuthVars();

    console.log(`Opening browser at ${baseUrl}`);
    if (missingAuthVars.length > 0) {
        printManualFallbackWarning(missingAuthVars);
        console.log('After manual sign-in, keep this script running until Firebase Auth detects currentUser.');
    }

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
        console.log('Browser opened.');
        await waitForFirebaseAuthSdk(page);

        if (missingAuthVars.length === 0) {
            await signInWithEmailAndPassword(page);
        } else {
            console.log('Manual sign-in required: use the Phase 1B smoke test account in the opened browser window.');
        }

        let currentUser;
        try {
            currentUser = await waitForCurrentUser(page);
        } catch (error) {
            printAuthTroubleshooting();
            throw error;
        }

        console.log(`Firebase Auth currentUser detected: ${currentUser.email || '(no email)'}; uid=${currentUser.uid}`);
        await fs.mkdir(path.dirname(storageStatePath), { recursive: true });
        const storageMode = await saveStorageState(context, storageStatePath);
        console.log(`Saved signed-in Playwright storage state ${storageMode} to: ${storageStatePath}`);
        console.log('Use the same BARK_E2E_BASE_URL origin when running the smoke suite.');
    } finally {
        await browser.close();
    }
})().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
});
