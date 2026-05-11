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
const EXPECTED_PREMIUM_UID = 'F8hS3KCvBBX4giarDtnJHDQSMmz2';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !FREE_STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null,
    !PREMIUM_STORAGE_STATE ? 'BARK_E2E_PREMIUM_STORAGE_STATE' : null
].filter(Boolean);

const freeStorageStatePath = FREE_STORAGE_STATE ? path.resolve(FREE_STORAGE_STATE) : null;
const premiumStorageStatePath = PREMIUM_STORAGE_STATE ? path.resolve(PREMIUM_STORAGE_STATE) : null;

function buildEnvHelp() {
    return [
        'Phase 4C premium entitlement smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_FREE_STORAGE_STATE}"`,
        `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
        '',
        'Premium account setup:',
        '  - Create the premium storage state with a dedicated Firebase Email/Password E2E account.',
        '  - Seed users/{uid}.entitlement outside the client app:',
        '      premium: true',
        '      status: "manual_active"',
        '      source: "admin_override"',
        '      manualOverride: true',
        '      currentPeriodEnd: null',
        '',
        'Run:',
        '  npm run test:e2e:entitlement',
        '',
        'Notes:',
        '  - The client test must not write entitlement.',
        '  - Google OAuth remains blocked in Playwright Chromium.',
        '  - Real users still use Google sign-in; no email/password UI was added.'
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

    if (FREE_STORAGE_STATE && !fs.existsSync(freeStorageStatePath)) {
        throw new Error([
            `BARK_E2E_STORAGE_STATE points to a missing file: ${freeStorageStatePath}`,
            'Generate the free E2E storage state with:',
            `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
            `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_FREE_STORAGE_STATE}"`,
            '  npm run e2e:auth:save'
        ].join('\n'));
    }

    if (PREMIUM_STORAGE_STATE && !fs.existsSync(premiumStorageStatePath)) {
        throw new Error([
            `BARK_E2E_PREMIUM_STORAGE_STATE points to a missing file: ${premiumStorageStatePath}`,
            'Generate the premium/manual override E2E storage state with:',
            `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
            `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
            '  export BARK_E2E_AUTH_EMAIL="<premium test account email>"',
            '  export BARK_E2E_AUTH_PASSWORD="<test-only password from the secure vault>"',
            '  BARK_E2E_STORAGE_STATE="$BARK_E2E_PREMIUM_STORAGE_STATE" npm run e2e:auth:save',
            '',
            'The premium test account must already have users/{uid}.entitlement seeded by Firebase Console or admin tooling.'
        ].join('\n'));
    }
});

function collectConsoleErrors(page, label, errors) {
    page.on('console', message => {
        if (message.type() !== 'error') return;
        errors.push(`${label} console error: ${message.text()}`);
    });
    page.on('pageerror', error => {
        errors.push(`${label} page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openSignedInEntitlementApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        return Boolean(
            window.BARK &&
            window.BARK.services &&
            window.BARK.services.premium &&
            typeof window.BARK.services.premium.isPremium === 'function' &&
            typeof window.BARK.services.premium.getDebugState === 'function' &&
            window.firebase &&
            typeof window.firebase.auth === 'function' &&
            window.firebase.auth().currentUser
        );
    }, { timeout: 30000 });

    await page.waitForFunction(() => {
        const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
        if (!premiumService || typeof premiumService.getDebugState !== 'function') return false;
        const state = premiumService.getDebugState();
        return Boolean(state && state.meta && /^auth-user-snapshot/.test(state.meta.reason || ''));
    }, { timeout: 30000 });
}

async function readEntitlementState(page) {
    return page.evaluate(async ({ expectedPremiumUid }) => {
        const premiumService = window.BARK.services.premium;
        const currentUser = window.firebase.auth().currentUser;
        const premiumWrap = document.getElementById('premium-filters-wrap');
        const visitedFilter = document.getElementById('visited-filter');
        const mapStyleSelect = document.getElementById('map-style-select');
        const trailButtons = Array.from(document.querySelectorAll('#toggle-virtual-trail, #toggle-completed-trails'));
        const firestore = window.firebase.firestore();

        function serializeFirestoreData(value) {
            return JSON.parse(JSON.stringify(value || null));
        }

        async function readUserDoc(docId) {
            if (!docId) {
                return {
                    id: null,
                    exists: false,
                    data: null,
                    entitlement: null,
                    error: 'missing-doc-id'
                };
            }

            try {
                const snap = await firestore.collection('users').doc(docId).get();
                const data = snap.exists ? serializeFirestoreData(snap.data()) : null;
                return {
                    id: snap.id,
                    exists: snap.exists,
                    data,
                    entitlement: data && Object.prototype.hasOwnProperty.call(data, 'entitlement') ? data.entitlement : null,
                    error: null
                };
            } catch (error) {
                return {
                    id: docId,
                    exists: false,
                    data: null,
                    entitlement: null,
                    error: error && error.message ? error.message : String(error)
                };
            }
        }

        async function readEntitlementSubcollection(uid) {
            if (!uid) return { docs: [], error: 'missing-uid' };
            try {
                const snapshot = await firestore.collection('users').doc(uid).collection('entitlement').limit(10).get();
                return {
                    docs: snapshot.docs.map(doc => ({
                        id: doc.id,
                        data: serializeFirestoreData(doc.data())
                    })),
                    error: null
                };
            } catch (error) {
                return {
                    docs: [],
                    error: error && error.message ? error.message : String(error)
                };
            }
        }

        function getEntitlementIssues({ user, uidDoc, emailDoc, subcollection, serviceState }) {
            const issues = [];
            const raw = uidDoc.entitlement;

            if (!user) issues.push('No Firebase currentUser was available.');
            if (user && user.uid !== expectedPremiumUid) {
                issues.push(`Signed-in UID does not match expected premium UID ${expectedPremiumUid}.`);
            }
            if (!uidDoc.exists) {
                issues.push(`Firestore users/${user ? user.uid : '(missing uid)'} document does not exist.`);
            }
            if (uidDoc.exists && !Object.prototype.hasOwnProperty.call(uidDoc.data || {}, 'entitlement')) {
                issues.push(`Firestore users/${uidDoc.id}.entitlement is missing.`);
            }
            if (typeof raw === 'string') {
                issues.push('Firestore entitlement is stored as a string instead of a map.');
            }
            if (raw && typeof raw === 'object') {
                if (raw.isPremium !== undefined && raw.premium === undefined) {
                    issues.push('Firestore entitlement uses isPremium instead of premium.');
                }
                if (raw.status === 'manual_override') {
                    issues.push('Firestore entitlement status is manual_override; expected manual_active.');
                }
                if (raw.premium !== true) {
                    issues.push(`Firestore entitlement.premium is ${JSON.stringify(raw.premium)}; expected true.`);
                }
                if (raw.status !== 'manual_active') {
                    issues.push(`Firestore entitlement.status is ${JSON.stringify(raw.status)}; expected "manual_active".`);
                }
                if (raw.source !== 'admin_override') {
                    issues.push(`Firestore entitlement.source is ${JSON.stringify(raw.source)}; expected "admin_override".`);
                }
                if (raw.manualOverride !== true) {
                    issues.push(`Firestore entitlement.manualOverride is ${JSON.stringify(raw.manualOverride)}; expected true.`);
                }
                if (raw.currentPeriodEnd !== null) {
                    issues.push(`Firestore entitlement.currentPeriodEnd is ${JSON.stringify(raw.currentPeriodEnd)}; expected null.`);
                }
            }
            if (emailDoc.exists) {
                issues.push(`A users/${emailDoc.id} document exists under the email; entitlement must be under users/${user.uid}.`);
            }
            if (subcollection.docs.length > 0) {
                issues.push(`Found ${subcollection.docs.length} users/${user.uid}/entitlement subcollection doc(s); premiumService reads users/${user.uid}.entitlement map only.`);
            }
            if (serviceState.isPremium === false && raw && typeof raw === 'object' && raw.premium === true && raw.status === 'manual_active') {
                issues.push('Firestore entitlement appears correct, but premiumService still normalized to non-premium.');
            }

            return issues;
        }

        const user = currentUser ? {
            uid: currentUser.uid,
            email: currentUser.email || null
        } : null;
        const uidDoc = await readUserDoc(user && user.uid);
        const emailDoc = await readUserDoc(user && user.email);
        const subcollection = await readEntitlementSubcollection(user && user.uid);
        const serviceState = {
            isPremium: premiumService.isPremium(),
            entitlement: premiumService.getEntitlement(),
            debugState: premiumService.getDebugState()
        };
        const debugProbe = {
            expectedPremiumUid,
            uidMatchesExpected: Boolean(user && user.uid === expectedPremiumUid),
            premiumService: serviceState,
            firestore: {
                uidDoc,
                emailDoc,
                entitlementSubcollection: subcollection
            },
            detectedIssues: getEntitlementIssues({
                user,
                uidDoc,
                emailDoc,
                subcollection,
                serviceState
            })
        };

        return {
            user,
            isPremium: serviceState.isPremium,
            entitlement: serviceState.entitlement,
            debugState: serviceState.debugState,
            debugProbe,
            currentUiBehavior: {
                premiumWrapLocked: premiumWrap ? premiumWrap.classList.contains('premium-locked') : null,
                premiumWrapUnlocked: premiumWrap ? premiumWrap.classList.contains('premium-unlocked') : null,
                visitedFilterDisabled: visitedFilter ? visitedFilter.disabled === true : null,
                visitedFilterValue: visitedFilter ? visitedFilter.value : null,
                mapStyleSelectDisabled: mapStyleSelect ? mapStyleSelect.disabled === true : null,
                mapStyleSelectValue: mapStyleSelect ? mapStyleSelect.value : null,
                trailButtons: trailButtons.map(button => ({
                    id: button.id,
                    disabled: button.disabled === true,
                    ariaDisabled: button.getAttribute('aria-disabled'),
                    active: button.classList.contains('active')
                }))
            }
        };
    }, { expectedPremiumUid: EXPECTED_PREMIUM_UID });
}

function expectTrailButtonsLocked(state) {
    expect(state.currentUiBehavior.trailButtons.length, 'Trail buttons should be rendered').toBeGreaterThan(0);
    state.currentUiBehavior.trailButtons.forEach(button => {
        expect(button.disabled, `${button.id} should be disabled`).toBe(true);
        expect(button.ariaDisabled, `${button.id} should be aria-disabled`).toBe('true');
        expect(button.active, `${button.id} should not be active`).toBe(false);
    });
}

function expectTrailButtonsUnlocked(state) {
    expect(state.currentUiBehavior.trailButtons.length, 'Trail buttons should be rendered').toBeGreaterThan(0);
    state.currentUiBehavior.trailButtons.forEach(button => {
        expect(button.disabled, `${button.id} should be enabled`).toBe(false);
        expect(button.ariaDisabled, `${button.id} should not be aria-disabled`).toBe('false');
    });
}

async function forceVirtualTrailClick(page) {
    return page.evaluate(() => {
        const button = document.getElementById('toggle-virtual-trail');
        if (!button) return { present: false };

        button.disabled = false;
        button.setAttribute('aria-disabled', 'false');
        button.classList.remove('active');
        button.click();

        return {
            present: true,
            active: button.classList.contains('active'),
            disabled: button.disabled === true,
            ariaDisabled: button.getAttribute('aria-disabled')
        };
    });
}

async function togglePremiumVirtualTrailIfReady(page) {
    return page.evaluate(() => {
        const button = document.getElementById('toggle-virtual-trail');
        const mapReady = Boolean(
            button &&
            !button.disabled &&
            typeof window.L !== 'undefined' &&
            window.map &&
            typeof window.map.addLayer === 'function'
        );

        if (!mapReady) {
            return {
                attempted: false,
                reason: button ? 'map-or-leaflet-unavailable' : 'missing-button'
            };
        }

        button.classList.remove('active');
        button.click();
        const activeAfterClick = button.classList.contains('active');
        if (activeAfterClick) button.click();

        return {
            attempted: true,
            activeAfterClick,
            activeAfterCleanup: button.classList.contains('active')
        };
    });
}

test.describe('Phase 4C premium entitlement smoke', () => {
    test('premiumService distinguishes signed-in free and active premium users', async ({ browser }) => {
        const consoleErrors = [];

        const freeContext = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const freePage = await freeContext.newPage();
        collectConsoleErrors(freePage, 'free user', consoleErrors);

        let freeState;
        let freeForcedTrailClick;
        try {
            await openSignedInEntitlementApp(freePage);
            freeState = await readEntitlementState(freePage);
            freeForcedTrailClick = await forceVirtualTrailClick(freePage);
        } finally {
            await freeContext.close();
        }

        expect(freeState.user && freeState.user.uid, 'Free storage state should produce a signed-in Firebase user').toBeTruthy();
        expect(freeState.isPremium, 'Free user should not be premium according to premiumService').toBe(false);
        expect(freeState.entitlement.premium, 'Free user normalized entitlement should not be premium').toBe(false);
        expect(freeState.currentUiBehavior).toMatchObject({
            premiumWrapLocked: true,
            premiumWrapUnlocked: false,
            visitedFilterDisabled: true,
            visitedFilterValue: 'all',
            mapStyleSelectDisabled: true,
            mapStyleSelectValue: 'default'
        });
        expectTrailButtonsLocked(freeState);
        expect(freeForcedTrailClick).toMatchObject({
            present: true,
            active: false,
            disabled: true,
            ariaDisabled: 'true'
        });

        const premiumContext = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const premiumPage = await premiumContext.newPage();
        collectConsoleErrors(premiumPage, 'premium user', consoleErrors);

        let premiumState;
        let premiumTrailToggle;
        try {
            await openSignedInEntitlementApp(premiumPage);
            premiumState = await readEntitlementState(premiumPage);
            premiumTrailToggle = await togglePremiumVirtualTrailIfReady(premiumPage);
        } finally {
            await premiumContext.close();
        }

        expect(premiumState.user && premiumState.user.uid, 'Premium storage state should produce a signed-in Firebase user').toBeTruthy();
        expect(
            premiumState.isPremium,
            `Premium user should be premium according to premiumService.\n${JSON.stringify(premiumState.debugProbe, null, 2)}`
        ).toBe(true);
        expect(premiumState.entitlement.premium).toBe(true);
        expect(['active', 'manual_active']).toContain(premiumState.entitlement.status);
        expect(['lemon_squeezy', 'admin_override']).toContain(premiumState.entitlement.source);
        if (premiumState.entitlement.status === 'manual_active') {
            expect(premiumState.entitlement).toMatchObject({
                source: 'admin_override',
                manualOverride: true
            });
        }
        expect(premiumState.currentUiBehavior).toMatchObject({
            premiumWrapLocked: false,
            premiumWrapUnlocked: true,
            visitedFilterDisabled: false,
            mapStyleSelectDisabled: false
        });
        expectTrailButtonsUnlocked(premiumState);
        if (premiumTrailToggle.attempted) {
            expect(premiumTrailToggle).toMatchObject({
                activeAfterClick: true,
                activeAfterCleanup: false
            });
        }

        expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    });

    test('localStorage premiumLoggedIn cannot unlock signed-in free user', async ({ browser }) => {
        const consoleErrors = [];
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        await context.addInitScript(() => {
            window.localStorage.setItem('premiumLoggedIn', 'true');
        });
        const page = await context.newPage();
        collectConsoleErrors(page, 'free user localStorage bypass', consoleErrors);

        let freeState;
        let storedPremiumFlag;
        try {
            await openSignedInEntitlementApp(page);
            storedPremiumFlag = await page.evaluate(() => window.localStorage.getItem('premiumLoggedIn'));
            freeState = await readEntitlementState(page);
        } finally {
            try {
                await page.evaluate(() => window.localStorage.removeItem('premiumLoggedIn'));
            } catch (error) {
                // Context cleanup is best effort; the storage state file is not mutated.
            }
            await context.close();
        }

        expect(storedPremiumFlag).toBe('true');
        expect(freeState.user && freeState.user.uid, 'Free storage state should produce a signed-in Firebase user').toBeTruthy();
        expect(freeState.isPremium, 'localStorage.premiumLoggedIn must not make a free user premium').toBe(false);
        expect(freeState.entitlement.premium, 'Free user normalized entitlement should remain non-premium').toBe(false);
        expect(freeState.currentUiBehavior).toMatchObject({
            premiumWrapLocked: true,
            premiumWrapUnlocked: false,
            visitedFilterDisabled: true,
            visitedFilterValue: 'all',
            mapStyleSelectDisabled: true,
            mapStyleSelectValue: 'default'
        });
        expectTrailButtonsLocked(freeState);
        expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
    });
});
