const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const FREE_STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_FREE_STORAGE_STATE = '03-tests/.auth/free-user.json';
const DEFAULT_PREMIUM_STORAGE_STATE = '03-tests/.auth/premium-user.json';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !FREE_STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null,
    !PREMIUM_STORAGE_STATE ? 'BARK_E2E_PREMIUM_STORAGE_STATE' : null
].filter(Boolean);

const freeStorageStatePath = FREE_STORAGE_STATE ? path.resolve(FREE_STORAGE_STATE) : null;
const premiumStorageStatePath = PREMIUM_STORAGE_STATE ? path.resolve(PREMIUM_STORAGE_STATE) : null;

function buildEnvHelp() {
    return [
        'Account switch premium matrix smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_FREE_STORAGE_STATE}"`,
        `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
        '  npx playwright test 03-tests/playwright/account-switch-premium-matrix.spec.js --workers=1 --reporter=list'
    ].join('\n');
}

if (missingEnv.length > 0) {
    console.warn(buildEnvHelp());
}

test.skip(missingEnv.length > 0, buildEnvHelp());

test.beforeAll(() => {
    if (!BASE_URL) return;
    try {
        new URL(BASE_URL);
    } catch (error) {
        throw new Error(`BARK_E2E_BASE_URL is not a valid absolute URL: ${BASE_URL}`);
    }

    for (const [name, storagePath] of [
        ['BARK_E2E_STORAGE_STATE', freeStorageStatePath],
        ['BARK_E2E_PREMIUM_STORAGE_STATE', premiumStorageStatePath]
    ]) {
        if (storagePath && !fs.existsSync(storagePath)) {
            throw new Error(`${name} points to a missing file: ${storagePath}`);
        }
    }
});

function withCheckoutParams(baseUrl, checkoutState) {
    const url = new URL(baseUrl);
    url.searchParams.set('checkout', checkoutState);
    url.searchParams.set('provider', 'lemonsqueezy');
    return url.toString();
}

function collectMatrixErrors(page, label, errors, diagnostics) {
    const nonFatalConnectivityPattern = /Could not reach Cloud Firestore backend|Data poll failed, backing off/i;
    const relevantPattern = /FirebaseError|Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|authService|authAccountUi|premiumService|paywall|ReferenceError|TypeError/i;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (nonFatalConnectivityPattern.test(text)) {
            diagnostics.push(`${label} non-fatal connectivity console error: ${text}`);
            return;
        }
        if (relevantPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', error => {
        errors.push(`${label} page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openMatrixApp(page, url = BASE_URL) {
    await page.goto(url);
    await page.waitForFunction(() => {
        const bark = window.BARK;
        return Boolean(
            bark &&
            bark.services &&
            bark.services.premium &&
            typeof bark.services.premium.isPremium === 'function' &&
            typeof bark.services.premium.getDebugState === 'function' &&
            bark.paywall &&
            typeof bark.paywall.renderCurrentState === 'function' &&
            window.firebase &&
            typeof window.firebase.auth === 'function' &&
            document.getElementById('premium-filters-wrap') &&
            document.getElementById('profile-premium-card') &&
            document.getElementById('account-display-uid')
        );
    }, { timeout: 30000 });
}

async function waitForSignedInEntitlement(page, expectedPremium) {
    await page.waitForFunction((expected) => {
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
        const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
        if (!user || !premiumService || typeof premiumService.getDebugState !== 'function') return false;

        const state = premiumService.getDebugState();
        const reason = state && state.meta ? state.meta.reason || '' : '';
        return /^auth-user-snapshot/.test(reason) && premiumService.isPremium() === expected;
    }, expectedPremium, { timeout: 30000 });

    await page.waitForFunction(() => {
        const user = window.firebase.auth().currentUser;
        const uidText = document.getElementById('account-display-uid')?.textContent?.trim();
        return Boolean(user && uidText === user.uid);
    }, { timeout: 30000 });
}

async function waitForSignedOut(page) {
    await page.waitForFunction(() => (
        window.firebase &&
        typeof window.firebase.auth === 'function' &&
        !window.firebase.auth().currentUser &&
        window.BARK &&
        window.BARK.services &&
        window.BARK.services.premium &&
        window.BARK.services.premium.isPremium() === false
    ), { timeout: 30000 });
}

async function readMatrixState(page) {
    return page.evaluate(() => {
        const user = window.firebase.auth().currentUser;
        const premiumService = window.BARK.services.premium;
        const premiumWrap = document.getElementById('premium-filters-wrap');
        const visitedFilter = document.getElementById('visited-filter');
        const mapStyleSelect = document.getElementById('map-style-select');
        const clusterToggle = document.getElementById('premium-cluster-toggle');
        const profilePremiumCard = document.getElementById('profile-premium-card');
        const profilePremiumStatus = document.getElementById('profile-premium-status');
        const paywallOverlay = document.getElementById('paywall-overlay');
        const accountUid = document.getElementById('account-display-uid');
        const accountEmail = document.getElementById('account-display-email');
        const trailButtons = Array.from(document.querySelectorAll('#toggle-virtual-trail, #toggle-completed-trails'));

        return {
            user: user ? {
                uid: user.uid,
                email: user.email || null
            } : null,
            accountUi: {
                uid: accountUid ? accountUid.textContent.trim() : null,
                email: accountEmail ? accountEmail.textContent.trim() : null
            },
            premium: {
                isPremium: premiumService.isPremium(),
                entitlement: premiumService.getEntitlement(),
                debugState: premiumService.getDebugState()
            },
            paywall: {
                profileState: profilePremiumCard ? profilePremiumCard.dataset.paywallState || null : null,
                profileStatus: profilePremiumStatus ? profilePremiumStatus.textContent.trim() : null,
                overlayState: paywallOverlay ? paywallOverlay.dataset.paywallState || null : null
            },
            controls: {
                premiumWrapLocked: premiumWrap ? premiumWrap.classList.contains('premium-locked') : null,
                premiumWrapUnlocked: premiumWrap ? premiumWrap.classList.contains('premium-unlocked') : null,
                visitedFilterDisabled: visitedFilter ? visitedFilter.disabled === true : null,
                visitedFilterValue: visitedFilter ? visitedFilter.value : null,
                mapStyleDisabled: mapStyleSelect ? mapStyleSelect.disabled === true : null,
                mapStyleValue: mapStyleSelect ? mapStyleSelect.value : null,
                premiumClusteringEnabled: window.premiumClusteringEnabled,
                clusterToggleDisabled: clusterToggle ? clusterToggle.disabled === true : null,
                clusterToggleChecked: clusterToggle ? clusterToggle.checked === true : null,
                clusterToggleAriaDisabled: clusterToggle ? clusterToggle.getAttribute('aria-disabled') : null,
                trailButtons: trailButtons.map(button => ({
                    id: button.id,
                    disabled: button.disabled === true,
                    ariaDisabled: button.getAttribute('aria-disabled'),
                    active: button.classList.contains('active')
                }))
            }
        };
    });
}

function expectAccountUiMatchesUser(state) {
    expect(state.user, 'Expected a signed-in Firebase user').toBeTruthy();
    expect(state.accountUi.uid, 'Account UI UID should match Firebase Auth UID').toBe(state.user.uid);
    if (state.user.email) {
        expect(state.accountUi.email, 'Account UI email should match Firebase Auth email').toBe(state.user.email);
    }
}

function expectFreeLockedState(state, expectedPaywallState = 'free') {
    expect(state.premium.isPremium, JSON.stringify(state, null, 2)).toBe(false);
    expect(state.controls.premiumWrapLocked).toBe(true);
    expect(state.controls.premiumWrapUnlocked).toBe(false);
    expect(state.controls.visitedFilterDisabled).toBe(true);
    expect(state.controls.visitedFilterValue).toBe('all');
    expect(state.controls.mapStyleDisabled).toBe(true);
    expect(state.controls.mapStyleValue).toBe('default');
    expect(state.controls.premiumClusteringEnabled).toBe(false);
    expect(state.controls.clusterToggleDisabled).toBe(true);
    expect(state.controls.clusterToggleChecked).toBe(false);
    expect(state.controls.clusterToggleAriaDisabled).toBe('true');
    expect(state.paywall.profileState).toBe(expectedPaywallState);

    expect(state.controls.trailButtons.length, 'Trail controls should be rendered').toBeGreaterThan(0);
    state.controls.trailButtons.forEach(button => {
        expect(button.disabled, `${button.id} should be disabled`).toBe(true);
        expect(button.ariaDisabled, `${button.id} should be aria-disabled`).toBe('true');
        expect(button.active, `${button.id} should not be active`).toBe(false);
    });
}

function expectPremiumUnlockedState(state) {
    expect(state.premium.isPremium, JSON.stringify(state, null, 2)).toBe(true);
    expect(state.controls.premiumWrapLocked).toBe(false);
    expect(state.controls.premiumWrapUnlocked).toBe(true);
    expect(state.controls.visitedFilterDisabled).toBe(false);
    expect(state.controls.mapStyleDisabled).toBe(false);
    expect(state.controls.clusterToggleDisabled).toBe(false);
    expect(state.controls.clusterToggleAriaDisabled).toBe('false');
    expect(state.paywall.profileState).toBe('premium');
    expect(state.paywall.profileStatus).toBe('Premium active');

    expect(state.controls.trailButtons.length, 'Trail controls should be rendered').toBeGreaterThan(0);
    state.controls.trailButtons.forEach(button => {
        expect(button.disabled, `${button.id} should be enabled`).toBe(false);
        expect(button.ariaDisabled, `${button.id} should not be aria-disabled`).toBe('false');
    });
}

test.describe('account switch premium matrix smoke', () => {
    test('A01/A07 free account stays locked on normal and fake success URLs', async ({ browser }) => {
        const errors = [];
        const diagnostics = [];

        const normalContext = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const normalPage = await normalContext.newPage();
        collectMatrixErrors(normalPage, 'A01 free normal', errors, diagnostics);
        try {
            await openMatrixApp(normalPage);
            await waitForSignedInEntitlement(normalPage, false);
            const normalState = await readMatrixState(normalPage);
            expectAccountUiMatchesUser(normalState);
            expectFreeLockedState(normalState, 'free');
        } finally {
            await normalContext.close();
        }

        const successContext = await newBarkContext(browser, { storageState: freeStorageStatePath });
        await successContext.addInitScript(() => {
            window.BARK = window.BARK || {};
            window.BARK.PAYWALL_VERIFYING_FALLBACK_MS = 0;
        });
        const successPage = await successContext.newPage();
        collectMatrixErrors(successPage, 'A07 free fake success', errors, diagnostics);
        try {
            await openMatrixApp(successPage, withCheckoutParams(BASE_URL, 'success'));
            await waitForSignedInEntitlement(successPage, false);
            await successPage.waitForFunction(() => (
                document.getElementById('profile-premium-card')?.dataset.paywallState === 'verification-delayed'
            ), { timeout: 5000 });
            const successState = await readMatrixState(successPage);
            expectAccountUiMatchesUser(successState);
            expectFreeLockedState(successState, 'verification-delayed');
            expect(successState.paywall.profileStatus).toBe('Still verifying premium');
        } finally {
            await successContext.close();
        }

        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('A02/A08 premium account unlocks on normal and success URLs', async ({ browser }) => {
        const errors = [];
        const diagnostics = [];

        for (const [label, url] of [
            ['A02 premium normal', BASE_URL],
            ['A08 premium success', withCheckoutParams(BASE_URL, 'success')]
        ]) {
            const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
            const page = await context.newPage();
            collectMatrixErrors(page, label, errors, diagnostics);
            try {
                await openMatrixApp(page, url);
                await waitForSignedInEntitlement(page, true);
                const state = await readMatrixState(page);
                expectAccountUiMatchesUser(state);
                expectPremiumUnlockedState(state);
            } finally {
                await context.close();
            }
        }

        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('A06 premium sign-out then refresh stays signed out and locked', async ({ browser }) => {
        const errors = [];
        const diagnostics = [];
        const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const page = await context.newPage();
        collectMatrixErrors(page, 'A06 premium sign-out refresh', errors, diagnostics);
        try {
            await openMatrixApp(page);
            await waitForSignedInEntitlement(page, true);
            expectPremiumUnlockedState(await readMatrixState(page));

            await page.evaluate(() => window.firebase.auth().signOut());
            await waitForSignedOut(page);
            await page.reload();
            await openMatrixApp(page);
            await waitForSignedOut(page);

            const signedOutState = await readMatrixState(page);
            expect(signedOutState.user).toBeNull();
            expectFreeLockedState(signedOutState, 'signed-out');
            expect(signedOutState.paywall.profileStatus).not.toBe('Premium active');
        } finally {
            await context.close();
        }

        expect(errors, errors.join('\n')).toEqual([]);
    });

    test('A12 free account sanitizes premium localStorage settings on refresh', async ({ browser }) => {
        const errors = [];
        const diagnostics = [];
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        await context.addInitScript(() => {
            window.localStorage.setItem('barkMapStyle', 'terrain');
            window.localStorage.setItem('barkVisitedFilter', 'visited');
            window.localStorage.setItem('barkPremiumClustering', 'true');
        });
        const page = await context.newPage();
        collectMatrixErrors(page, 'A12 free premium localStorage refresh', errors, diagnostics);
        try {
            await openMatrixApp(page);
            await waitForSignedInEntitlement(page, false);
            const state = await readMatrixState(page);
            expectAccountUiMatchesUser(state);
            expectFreeLockedState(state, 'free');

            const storageState = await page.evaluate(() => ({
                mapStyle: window.localStorage.getItem('barkMapStyle'),
                visitedFilter: window.localStorage.getItem('barkVisitedFilter'),
                premiumClustering: window.localStorage.getItem('barkPremiumClustering')
            }));
            expect(storageState).toEqual({
                mapStyle: 'default',
                visitedFilter: 'all',
                premiumClustering: 'false'
            });
        } finally {
            await context.close();
        }

        expect(errors, errors.join('\n')).toEqual([]);
    });
});
