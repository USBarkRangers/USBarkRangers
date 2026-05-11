const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_STORAGE_STATE = '03-tests/.auth/free-user.json';
const DEFAULT_PREMIUM_STORAGE_STATE = '03-tests/.auth/premium-user.json';
const GLOBAL_SEARCH_QUERY = 'zzzxqfreegate';

const missingBaseEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
].filter(Boolean);

const missingSignedInEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null
].filter(Boolean);

const storageStatePath = STORAGE_STATE ? path.resolve(STORAGE_STATE) : null;
const storageStateExists = storageStatePath ? fs.existsSync(storageStatePath) : false;
const premiumStorageStatePath = PREMIUM_STORAGE_STATE ? path.resolve(PREMIUM_STORAGE_STATE) : null;
const premiumStorageStateExists = premiumStorageStatePath ? fs.existsSync(premiumStorageStatePath) : false;

function buildEnvHelp(missing = missingSignedInEnv) {
    return [
        'Phase 3A premium gating smoke tests are skipped because required configuration is missing.',
        `Missing: ${missing.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}"`,
        '  npm run e2e:auth:save',
        '  npm run test:e2e:premium',
        '',
        'Notes:',
        '  - The storage state should be created with the Firebase Email/Password E2E test account.',
        '  - Google OAuth remains blocked in Playwright Chromium.',
        '  - Real users still use Google sign-in; no email/password UI was added.'
    ].join('\n');
}

if (missingBaseEnv.length > 0) {
    console.warn(buildEnvHelp(missingBaseEnv));
} else if (missingSignedInEnv.length > 0) {
    console.warn(buildEnvHelp(missingSignedInEnv));
}

test.skip(missingBaseEnv.length > 0, buildEnvHelp(missingBaseEnv));

test.beforeAll(() => {
    if (!BASE_URL) return;
    try {
        new URL(BASE_URL);
    } catch (error) {
        throw new Error(`BARK_E2E_BASE_URL is not a valid absolute URL: ${BASE_URL}`);
    }

    if (STORAGE_STATE && !storageStateExists) {
        throw new Error([
            `BARK_E2E_STORAGE_STATE points to a missing file: ${storageStatePath}`,
            'Generate it with:',
            `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
            `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}"`,
            '  npm run e2e:auth:save'
        ].join('\n'));
    }

    if (PREMIUM_STORAGE_STATE && !premiumStorageStateExists) {
        throw new Error([
            `BARK_E2E_PREMIUM_STORAGE_STATE points to a missing file: ${premiumStorageStatePath}`,
            'Generate it with:',
            `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
            `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
            '  npm run save:e2e:premium'
        ].join('\n'));
    }
});

function withCheckoutParams(baseUrl, checkoutState) {
    const url = new URL(baseUrl);
    url.searchParams.set('checkout', checkoutState);
    url.searchParams.set('provider', 'lemonsqueezy');
    return url.toString();
}

async function openApp(page, url = BASE_URL) {
    await page.goto(url);
    await page.waitForFunction(() => {
        const bark = window.BARK;
        return Boolean(
            bark &&
            bark.authPremiumUi &&
            typeof bark.authPremiumUi.applyPremiumGating === 'function' &&
            document.getElementById('premium-filters-wrap') &&
            document.getElementById('visited-filter') &&
            document.getElementById('map-style-select')
        );
    }, { timeout: 30000 });
}

async function waitForSignedInApp(page, url = BASE_URL) {
    await openApp(page, url);
    await page.waitForFunction(() => {
        return Boolean(
            window.firebase &&
            typeof window.firebase.auth === 'function' &&
            window.firebase.auth().currentUser
        );
    }, { timeout: 30000 });
    await page.waitForFunction(() => {
        const service = window.BARK && window.BARK.services && window.BARK.services.premium;
        if (!service || typeof service.getDebugState !== 'function') return false;
        const state = service.getDebugState();
        return Boolean(state && state.meta && /^auth-user-snapshot/.test(state.meta.reason || ''));
    }, { timeout: 30000 });
}

async function waitForSignedOutApp(page, url = BASE_URL) {
    await openApp(page, url);
    await page.waitForFunction(() => {
        return Boolean(
            window.firebase &&
            typeof window.firebase.auth === 'function' &&
            !window.firebase.auth().currentUser
        );
    }, { timeout: 30000 });
}

async function getTrailButtonStates(page) {
    return page.locator('#toggle-virtual-trail, #toggle-completed-trails').evaluateAll(buttons => (
        buttons.map(button => ({
            id: button.id,
            disabled: button.disabled === true,
            ariaDisabled: button.getAttribute('aria-disabled')
        }))
    ));
}

async function expectLowRiskPremiumControlsLocked(page) {
    const premiumWrap = page.locator('#premium-filters-wrap');
    const visitedFilter = page.locator('#visited-filter');
    const mapStyleSelect = page.locator('#map-style-select');

    await expect(premiumWrap).toHaveCount(1);
    await expect(premiumWrap).toHaveClass(/premium-locked/);
    await expect(premiumWrap).not.toHaveClass(/premium-unlocked/);

    await expect(visitedFilter).toHaveCount(1);
    await expect(visitedFilter).toBeDisabled();
    await expect(visitedFilter).toHaveValue('all');

    await expect(mapStyleSelect).toHaveCount(1);
    await expect(mapStyleSelect).toBeDisabled();
    await expect(mapStyleSelect).toHaveValue('default');
}

async function expectTrailButtonsLocked(page) {
    const trailButtons = await getTrailButtonStates(page);
    for (const button of trailButtons) {
        expect(button.disabled, `${button.id} should be disabled`).toBe(true);
        expect(button.ariaDisabled, `${button.id} should be aria-disabled`).toBe('true');
    }
}

async function expectPremiumClusteringLocked(page) {
    const toggle = page.locator('#premium-cluster-toggle');
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toBeDisabled();
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');

    const state = await page.evaluate(() => ({
        enabled: window.premiumClusteringEnabled,
        stored: window.localStorage.getItem('barkPremiumClustering')
    }));
    expect(state.enabled).toBe(false);
    expect(state.stored).toBe('false');
}

async function expectPremiumClusteringUnlocked(page) {
    const toggle = page.locator('#premium-cluster-toggle');
    await expect(toggle).toHaveCount(1);
    await expect(toggle).toBeEnabled();
    await expect(toggle).toHaveAttribute('aria-disabled', 'false');
}

async function expectLowRiskPremiumControlsUnlocked(page) {
    const premiumWrap = page.locator('#premium-filters-wrap');
    const visitedFilter = page.locator('#visited-filter');
    const mapStyleSelect = page.locator('#map-style-select');

    await expect(premiumWrap).toHaveCount(1);
    await expect(premiumWrap).toHaveClass(/premium-unlocked/);
    await expect(premiumWrap).not.toHaveClass(/premium-locked/);

    await expect(visitedFilter).toHaveCount(1);
    await expect(visitedFilter).toBeEnabled();

    await expect(mapStyleSelect).toHaveCount(1);
    await expect(mapStyleSelect).toBeEnabled();
}

async function getCurrentUid(page) {
    return page.evaluate(() => {
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
        return user ? user.uid : null;
    });
}

async function expectTrailButtonsUnlocked(page) {
    const trailButtons = await getTrailButtonStates(page);
    for (const button of trailButtons) {
        expect(button.disabled, `${button.id} should be enabled`).toBe(false);
        expect(button.ariaDisabled, `${button.id} should not be aria-disabled`).toBe('false');
    }
}

async function forceTrailButtonClick(page, buttonId) {
    return page.evaluate((id) => {
        const button = document.getElementById(id);
        if (!button) return { present: false };

        button.disabled = false;
        button.setAttribute('aria-disabled', 'false');
        button.classList.remove('active');
        button.click();

        if (
            window.BARK &&
            window.BARK.paywall &&
            typeof window.BARK.paywall.closePaywall === 'function'
        ) {
            window.BARK.paywall.closePaywall();
        }

        return {
            present: true,
            active: button.classList.contains('active'),
            disabled: button.disabled === true,
            ariaDisabled: button.getAttribute('aria-disabled')
        };
    }, buttonId);
}

async function expectForcedTrailClicksBlocked(page) {
    for (const buttonId of ['toggle-virtual-trail', 'toggle-completed-trails']) {
        const result = await forceTrailButtonClick(page, buttonId);
        expect(result, `${buttonId} forced click should fail closed`).toMatchObject({
            present: true,
            active: false,
            disabled: true,
            ariaDisabled: 'true'
        });
    }
}

async function installGeocodeSpy(page) {
    await page.evaluate(() => {
        window.__barkE2eAlerts = [];
        window.__barkE2eGeocodeCalls = [];
        const originalAlert = window.alert;
        const originalGeocode = window.BARK.services.ors.geocode;
        window.alert = function e2eAlertSpy(message) {
            window.__barkE2eAlerts.push(String(message));
        };
        window.BARK.services.ors.geocode = async function e2eGeocodeSpy(query, options = {}) {
            window.__barkE2eGeocodeCalls.push({ query, options });
            return { features: [] };
        };
        window.__barkE2eRestoreGeocode = () => {
            window.alert = originalAlert;
            window.BARK.services.ors.geocode = originalGeocode;
        };
    });
}

async function showGlobalSearchSuggestion(page) {
    await page.waitForFunction(() => {
        const bark = window.BARK;
        const repo = bark && bark.repos && bark.repos.ParkRepo;
        return Boolean(
            bark &&
            bark.services &&
            bark.services.ors &&
            typeof bark.services.ors.geocode === 'function' &&
            repo &&
            typeof repo.getAll === 'function' &&
            repo.getAll().length > 0 &&
            document.getElementById('park-search') &&
            document.getElementById('search-suggestions')
        );
    }, { timeout: 30000 });

    await page.locator('#park-search').fill(GLOBAL_SEARCH_QUERY);
    await page.waitForFunction(({ query }) => {
        const suggestions = document.getElementById('search-suggestions');
        return Boolean(
            suggestions &&
            suggestions.style.display === 'block' &&
            suggestions.textContent &&
            suggestions.textContent.includes(query) &&
            /Search global towns/.test(suggestions.textContent)
        );
    }, { query: GLOBAL_SEARCH_QUERY }, { timeout: 30000 });
}

function globalSearchButton(page) {
    return page.locator('#search-suggestions .suggestion-item').filter({
        hasText: /Search global towns/
    }).last();
}

async function expectGlobalSearchLocked(page, expectedTextPattern) {
    await installGeocodeSpy(page);
    await showGlobalSearchSuggestion(page);
    await expect(globalSearchButton(page)).toContainText(expectedTextPattern);
    await globalSearchButton(page).click();
    await page.waitForFunction(() => (
        document.getElementById('paywall-overlay') &&
        document.getElementById('paywall-overlay').classList.contains('active') &&
        /Global towns and cities/.test(document.getElementById('paywall-title').textContent || '')
    ), { timeout: 5000 });
    const state = await page.evaluate(() => ({
        geocodeCalls: window.__barkE2eGeocodeCalls.slice(),
        alerts: window.__barkE2eAlerts.slice(),
        paywallTitle: document.getElementById('paywall-title').textContent,
        paywallBody: document.getElementById('paywall-body').textContent,
        paywallSource: document.getElementById('paywall-source').textContent
    }));
    expect(state.geocodeCalls, 'Locked global search must not call ORS geocode').toEqual([]);
    expect(state.alerts, 'Locked global search should use the paywall modal instead of alert').toEqual([]);
    expect(state.paywallTitle).toMatch(/Global towns and cities/);
    expect(state.paywallBody).toMatch(/add any city or town to your trip/);
    expect(state.paywallSource).toContain('global town search');
}

async function expectFreePaywallState(page, expectedMode = 'free') {
    await expect(page.locator('#profile-premium-card')).toHaveAttribute('data-paywall-state', expectedMode);
    const restoreButton = page.locator('#paywall-restore-btn');

    if (expectedMode === 'verify-signed-out') {
        await expect(page.locator('#paywall-overlay')).toHaveAttribute('data-paywall-state', 'verify-signed-out');
        await expect(page.locator('#paywall-title')).toHaveText('Sign in to verify premium');
        await expect(page.locator('#paywall-primary-btn')).toBeEnabled();
        await expect(page.locator('#paywall-clear-url-btn')).toBeHidden();
        await expect(restoreButton).toHaveJSProperty('hidden', true);
        await expect(page.locator('#profile-premium-action')).toBeEnabled();
        return;
    }

    if (expectedMode === 'verifying') {
        await expect(page.locator('#profile-premium-status')).toHaveText('Verifying payment...');
        await expect(page.locator('#profile-premium-action')).toBeDisabled();
        await expect(page.locator('#paywall-overlay')).toHaveAttribute('data-paywall-state', 'verifying');
        await expect(page.locator('#paywall-primary-btn')).toBeDisabled();
        await expect(page.locator('#paywall-clear-url-btn')).toBeHidden();
        await expect(restoreButton).toHaveJSProperty('hidden', false);
        await expect(restoreButton).toBeEnabled();
        return;
    }

    if (expectedMode === 'verification-delayed') {
        await expect(page.locator('#profile-premium-status')).toHaveText('Still verifying premium');
        await expect(page.locator('#profile-premium-action')).toBeEnabled();
        await expect(page.locator('#paywall-overlay')).toHaveAttribute('data-paywall-state', 'verification-delayed');
        await expect(page.locator('#paywall-title')).toHaveText('Still verifying premium');
        await expect(page.locator('#paywall-primary-btn')).toBeEnabled();
        await expect(page.locator('#paywall-primary-btn')).toContainText('Restore');
        await expect(page.locator('#paywall-clear-url-btn')).toBeHidden();
        await expect(restoreButton).toHaveJSProperty('hidden', true);
        await expect(page.locator('#paywall-body')).toContainText('Recheck');
        return;
    }

    if (expectedMode === 'canceled') {
        await expect(page.locator('#profile-premium-status')).toHaveText('Checkout canceled');
        await expect(page.locator('#paywall-overlay')).toHaveAttribute('data-paywall-state', 'canceled');
        await expect(page.locator('#paywall-title')).toHaveText('Checkout canceled');
        await expect(page.locator('#paywall-body')).toContainText('No charge was made');
        await expect(restoreButton).toHaveJSProperty('hidden', true);
        return;
    }

    await expect(page.locator('#profile-premium-status')).toHaveText('Free plan');
    await expect(page.locator('#profile-premium-action')).toHaveAttribute('data-mode', 'free');
    await expect(restoreButton).toHaveJSProperty('hidden', false);
    await expect(restoreButton).toBeEnabled();
}

async function forceSignedInLikeFreeUser(page) {
    return page.evaluate(() => {
        const fakeUser = {
            uid: 'playwright-free-user',
            email: 'playwright-free-user@example.test'
        };
        const auth = window.firebase.auth();

        try {
            Object.defineProperty(auth, 'currentUser', {
                value: fakeUser,
                configurable: true
            });
        } catch (error) {
            const originalAuth = window.firebase.auth;
            window.firebase.auth = function patchedAuth() {
                const nextAuth = originalAuth.call(window.firebase);
                try {
                    Object.defineProperty(nextAuth, 'currentUser', {
                        value: fakeUser,
                        configurable: true
                    });
                } catch (innerError) {
                    nextAuth.currentUser = fakeUser;
                }
                return nextAuth;
            };
        }

        window.BARK.services.premium.reset({
            uid: fakeUser.uid,
            reason: 'playwright-free-user-return-state'
        });
        window.BARK.paywall.renderCurrentState();
        return {
            uid: window.firebase.auth().currentUser && window.firebase.auth().currentUser.uid,
            isPremium: window.BARK.services.premium.isPremium()
        };
    });
}

async function forceAuthUserAndRenderPaywall(page, uid) {
    return page.evaluate((nextUid) => {
        const nextUser = nextUid
            ? {
                uid: nextUid,
                email: `${nextUid}@example.test`
            }
            : null;
        const auth = window.firebase.auth();

        try {
            Object.defineProperty(auth, 'currentUser', {
                value: nextUser,
                configurable: true
            });
        } catch (error) {
            auth.currentUser = nextUser;
        }

        window.BARK.services.premium.reset({
            uid: nextUid || null,
            reason: 'playwright-checkout-return-account-change'
        });
        window.BARK.paywall.renderCurrentState();

        const params = new URL(window.location.href).searchParams;
        const card = document.getElementById('profile-premium-card');
        return {
            uid: window.firebase.auth().currentUser && window.firebase.auth().currentUser.uid,
            profileState: card && card.dataset.paywallState,
            profileStatus: document.getElementById('profile-premium-status')?.textContent || '',
            title: document.getElementById('paywall-title')?.textContent || '',
            checkout: params.get('checkout'),
            provider: params.get('provider'),
            isPremium: window.BARK.services.premium.isPremium()
        };
    }, uid);
}

test.describe('Phase 3A premium gating smoke', () => {
    test('signed-out app locks premium controls', async ({ page }) => {
        await waitForSignedOutApp(page);
        await expectLowRiskPremiumControlsLocked(page);
        await expectTrailButtonsLocked(page);
        await expectPremiumClusteringLocked(page);
        await expectForcedTrailClicksBlocked(page);
        await expectGlobalSearchLocked(page, /Sign in to unlock global search/);
    });

    test('signed-out app sanitizes stored premium map surfaces', async ({ browser }) => {
        const context = await newBarkContext(browser);
        await context.addInitScript(() => {
            window.localStorage.setItem('barkMapStyle', 'terrain');
            window.localStorage.setItem('barkVisitedFilter', 'visited');
            window.localStorage.setItem('barkPremiumClustering', 'true');
            window.localStorage.setItem('premiumLoggedIn', 'true');
        });

        const page = await context.newPage();
        try {
            await waitForSignedOutApp(page);
            await expectLowRiskPremiumControlsLocked(page);
            await expectTrailButtonsLocked(page);
            await expectPremiumClusteringLocked(page);
            await page.waitForFunction(() => {
                const styleEl = document.getElementById('map-style-select');
                const filterEl = document.getElementById('visited-filter');
                return Boolean(
                    styleEl &&
                    filterEl &&
                    styleEl.value === 'default' &&
                    filterEl.value === 'all' &&
                    window.BARK &&
                    window.BARK.visitedFilterState === 'all' &&
                    window.premiumClusteringEnabled === false &&
                    window.localStorage.getItem('barkMapStyle') === 'default' &&
                    window.localStorage.getItem('barkVisitedFilter') === 'all' &&
                    window.localStorage.getItem('barkPremiumClustering') === 'false'
                );
            }, { timeout: 30000 });

            const state = await page.evaluate(() => ({
                isPremium: window.BARK.services.premium.isPremium(),
                premiumLoggedIn: window.localStorage.getItem('premiumLoggedIn'),
                attribution: document.querySelector('.leaflet-control-attribution')?.textContent || '',
                tileUrls: Array.from(document.querySelectorAll('img.leaflet-tile')).map(img => img.src)
            }));

            expect(state.isPremium, 'premiumLoggedIn localStorage must not unlock premium').toBe(false);
            expect(state.premiumLoggedIn).toBe('true');
            expect(state.attribution).not.toContain('OpenTopoMap');
            expect(state.tileUrls.some(url => url.includes('opentopomap'))).toBe(false);
        } finally {
            await context.close();
        }
    });

    test('stale premium entitlement for a previous account does not unlock signed-out runtime', async ({ page }) => {
        await waitForSignedOutApp(page);
        const state = await page.evaluate(() => {
            const service = window.BARK.services.premium;
            service.setEntitlement({
                premium: true,
                status: 'manual_active',
                source: 'admin_override',
                manualOverride: true,
                currentPeriodEnd: null
            }, {
                uid: 'previous-premium-user',
                reason: 'bug-003-stale-uid-regression'
            });

            const debugState = service.getDebugState();
            return {
                currentUid: firebase.auth().currentUser ? firebase.auth().currentUser.uid : null,
                isPremium: service.isPremium(),
                entitlement: service.getEntitlement(),
                debugUid: debugState && debugState.meta ? debugState.meta.uid : null
            };
        });

        expect(state.currentUid).toBeNull();
        expect(state.debugUid).toBe('previous-premium-user');
        expect(state.entitlement).toMatchObject({
            premium: true,
            status: 'manual_active',
            source: 'admin_override',
            manualOverride: true,
            currentPeriodEnd: null
        });
        expect(state.isPremium, 'stale previous-account entitlement must not unlock premium').toBe(false);
        await expectLowRiskPremiumControlsLocked(page);
        await expectTrailButtonsLocked(page);
    });

    test('signed-out app blocks premium clustering setting changes', async ({ page }) => {
        await waitForSignedOutApp(page);
        await page.waitForFunction(() => Boolean(
            window.BARK &&
            window.BARK.settings &&
            document.getElementById('premium-cluster-toggle')
        ), { timeout: 30000 });

        const state = await page.evaluate(() => {
            const toggle = document.getElementById('premium-cluster-toggle');
            const before = {
                isPremium: window.BARK.services.premium.isPremium(),
                premiumClusteringEnabled: window.premiumClusteringEnabled,
                checked: toggle.checked,
                disabled: toggle.disabled,
                ariaDisabled: toggle.getAttribute('aria-disabled'),
                stored: window.localStorage.getItem('barkPremiumClustering')
            };

            toggle.checked = true;
            toggle.dispatchEvent(new Event('change', { bubbles: true }));

            return {
                before,
                after: {
                    isPremium: window.BARK.services.premium.isPremium(),
                    premiumClusteringEnabled: window.premiumClusteringEnabled,
                    checked: toggle.checked,
                    disabled: toggle.disabled,
                    ariaDisabled: toggle.getAttribute('aria-disabled'),
                    stored: window.localStorage.getItem('barkPremiumClustering')
                }
            };
        });

        expect(state.before.isPremium).toBe(false);
        expect(state.after.isPremium).toBe(false);
        expect(state.after.premiumClusteringEnabled).toBe(false);
        expect(state.after.checked).toBe(false);
        expect(state.after.disabled).toBe(true);
        expect(state.after.ariaDisabled).toBe('true');
        expect(state.after.stored).toBe('false');
    });

    test('fake checkout success signed-out asks sign-in without unlocking premium', async ({ page }) => {
        await waitForSignedOutApp(page, withCheckoutParams(BASE_URL, 'success'));
        await expect(page.evaluate(() => window.BARK.services.premium.isPremium())).resolves.toBe(false);
        await expectLowRiskPremiumControlsLocked(page);
        await expectTrailButtonsLocked(page);
        await expectPremiumClusteringLocked(page);
        await expectFreePaywallState(page, 'verify-signed-out');
    });

    test('fake checkout success signed-in free falls back without unlocking premium', async ({ browser }) => {
        const context = await newBarkContext(browser);
        await context.addInitScript(() => {
            window.BARK = window.BARK || {};
            window.BARK.PAYWALL_VERIFYING_FALLBACK_MS = 60000;
        });
        const page = await context.newPage();
        try {
            await waitForSignedOutApp(page, withCheckoutParams(BASE_URL, 'success'));
            const forced = await forceSignedInLikeFreeUser(page);
            expect(forced).toMatchObject({
                uid: 'playwright-free-user',
                isPremium: false
            });
            await expectFreePaywallState(page, 'verifying');
            await page.evaluate(() => {
                window.BARK.PAYWALL_VERIFYING_FALLBACK_MS = 0;
                window.BARK.paywall.renderCurrentState();
            });
            await expect(page.locator('#paywall-overlay')).toHaveAttribute('data-paywall-state', 'verification-delayed', { timeout: 5000 });
            await expectFreePaywallState(page, 'verification-delayed');
            await expect(page.evaluate(() => window.BARK.services.premium.isPremium())).resolves.toBe(false);
        } finally {
            await context.close();
        }
    });

    test('checkout success verification clears when the signed-in account changes', async ({ browser }) => {
        const context = await newBarkContext(browser);
        await context.addInitScript(() => {
            window.BARK = window.BARK || {};
            window.BARK.PAYWALL_VERIFYING_FALLBACK_MS = 0;
        });
        const page = await context.newPage();
        try {
            await waitForSignedOutApp(page, withCheckoutParams(BASE_URL, 'success'));
            await expectFreePaywallState(page, 'verify-signed-out');

            const firstAccount = await forceAuthUserAndRenderPaywall(page, 'checkout-return-account-a');
            expect(firstAccount).toMatchObject({
                uid: 'checkout-return-account-a',
                profileState: 'verification-delayed',
                profileStatus: 'Still verifying premium',
                checkout: 'success',
                provider: 'lemonsqueezy',
                isPremium: false
            });

            const secondAccount = await forceAuthUserAndRenderPaywall(page, 'new-google-account-b');
            expect(secondAccount).toMatchObject({
                uid: 'new-google-account-b',
                profileState: 'free',
                profileStatus: 'Free plan',
                checkout: null,
                provider: null,
                isPremium: false
            });
            await expectFreePaywallState(page, 'free');
        } finally {
            await context.close();
        }
    });

    test('checkout canceled signed-out stays non-premium with no-charge copy', async ({ page }) => {
        await waitForSignedOutApp(page, withCheckoutParams(BASE_URL, 'canceled'));
        await expect(page.evaluate(() => window.BARK.services.premium.isPremium())).resolves.toBe(false);
        await expectLowRiskPremiumControlsLocked(page);
        await expectTrailButtonsLocked(page);
        await expectPremiumClusteringLocked(page);
        await expectFreePaywallState(page, 'canceled');
    });

    test('checkout canceled URL does not override active premium entitlement', async ({ browser }) => {
        const context = await newBarkContext(browser);
        const page = await context.newPage();
        try {
            await waitForSignedOutApp(page, withCheckoutParams(BASE_URL, 'canceled'));
            const state = await page.evaluate(() => {
                const user = {
                    uid: 'playwright-resumed-premium-user',
                    email: 'playwright-resumed-premium-user@example.test'
                };
                const auth = window.firebase.auth();
                try {
                    Object.defineProperty(auth, 'currentUser', {
                        value: user,
                        configurable: true
                    });
                } catch (error) {
                    auth.currentUser = user;
                }

                window.BARK.services.premium.setEntitlement({
                    premium: true,
                    status: 'active',
                    source: 'lemon_squeezy',
                    providerSubscriptionId: 'sub_resumed_active'
                }, {
                    uid: user.uid,
                    reason: 'playwright-resumed-active'
                });
                window.BARK.paywall.renderCurrentState();

                const params = new URL(window.location.href).searchParams;
                return {
                    isPremium: window.BARK.services.premium.isPremium(),
                    profileState: document.getElementById('profile-premium-card')?.dataset.paywallState,
                    profileStatus: document.getElementById('profile-premium-status')?.textContent || '',
                    paywallTitle: document.getElementById('paywall-title')?.textContent || '',
                    checkout: params.get('checkout'),
                    provider: params.get('provider')
                };
            });

            expect(state).toMatchObject({
                isPremium: true,
                profileState: 'premium',
                profileStatus: 'Premium active',
                paywallTitle: 'Premium active',
                checkout: null,
                provider: null
            });
        } finally {
            await context.close();
        }
    });

    test('signed-in free app keeps entitlement-gated controls locked', async ({ browser }) => {
        test.skip(missingSignedInEnv.length > 0, buildEnvHelp(missingSignedInEnv));
        const context = await newBarkContext(browser, { storageState: storageStatePath });
        const page = await context.newPage();
        try {
            await waitForSignedInApp(page);
            await expect(page.evaluate(() => window.BARK.services.premium.isPremium())).resolves.toBe(false);
            await expectLowRiskPremiumControlsLocked(page);
            await expectTrailButtonsLocked(page);
            await expectPremiumClusteringLocked(page);
            await expectForcedTrailClicksBlocked(page);
            await expectGlobalSearchLocked(page, /Upgrade to unlock global search/);
            await expectFreePaywallState(page, 'free');

            const fakeSuccessPage = await context.newPage();
            await waitForSignedInApp(fakeSuccessPage, withCheckoutParams(BASE_URL, 'success'));
            await expect(fakeSuccessPage.evaluate(() => window.BARK.services.premium.isPremium())).resolves.toBe(false);
            await expectLowRiskPremiumControlsLocked(fakeSuccessPage);
            await expectTrailButtonsLocked(fakeSuccessPage);
            await expectPremiumClusteringLocked(fakeSuccessPage);
            await expectFreePaywallState(fakeSuccessPage, 'verifying');
            await fakeSuccessPage.close();
        } finally {
            await context.close();
        }
    });

    test('premium and free storage states do not leak entitlement runtime', async ({ browser }) => {
        test.skip(missingSignedInEnv.length > 0, buildEnvHelp(missingSignedInEnv));
        test.skip(!PREMIUM_STORAGE_STATE, `Set BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`);

        let premiumUid;
        const premiumContext = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const premiumPage = await premiumContext.newPage();
        try {
            await waitForSignedInApp(premiumPage);
            premiumUid = await getCurrentUid(premiumPage);
            expect(premiumUid, 'Premium storage state should sign in a Firebase user').toBeTruthy();
            await expect(premiumPage.evaluate(() => window.BARK.services.premium.isPremium())).resolves.toBe(true);
            await expectLowRiskPremiumControlsUnlocked(premiumPage);
            await expectTrailButtonsUnlocked(premiumPage);
            await expectPremiumClusteringUnlocked(premiumPage);
            await expect(premiumPage.locator('#profile-premium-status')).toHaveText('Premium active');

            await premiumPage.evaluate(() => window.firebase.auth().signOut());
            await premiumPage.waitForFunction(() => !window.firebase.auth().currentUser, { timeout: 30000 });
            await premiumPage.waitForFunction(() => window.BARK.services.premium.isPremium() === false, { timeout: 30000 });
            await expectLowRiskPremiumControlsLocked(premiumPage);
            await expectTrailButtonsLocked(premiumPage);
            await expectPremiumClusteringLocked(premiumPage);
        } finally {
            await premiumContext.close();
        }

        const freeContext = await newBarkContext(browser, { storageState: storageStatePath });
        const freePage = await freeContext.newPage();
        try {
            await waitForSignedInApp(freePage);
            const freeUid = await getCurrentUid(freePage);
            expect(freeUid, 'Free storage state should sign in a Firebase user').toBeTruthy();
            expect(freeUid, 'Free and premium storage states must be different accounts').not.toBe(premiumUid);
            await expect(freePage.evaluate(() => window.BARK.services.premium.isPremium())).resolves.toBe(false);
            await expectLowRiskPremiumControlsLocked(freePage);
            await expectTrailButtonsLocked(freePage);
            await expectPremiumClusteringLocked(freePage);
            await expectFreePaywallState(freePage, 'free');
        } finally {
            await freeContext.close();
        }
    });

    test('premium checkout return hides pending cleanup controls after entitlement is active', async ({ browser }) => {
        test.skip(missingSignedInEnv.length > 0, buildEnvHelp(missingSignedInEnv));
        test.skip(!PREMIUM_STORAGE_STATE, `Set BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`);

        const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const page = await context.newPage();
        try {
            await waitForSignedInApp(page, withCheckoutParams(BASE_URL, 'success'));
            await page.waitForFunction(() => window.BARK.services.premium.isPremium() === true, { timeout: 30000 });

            await expect(page.locator('#paywall-overlay')).toHaveClass(/active/);
            await expect(page.locator('#paywall-overlay')).toHaveAttribute('data-paywall-state', 'premium');
            await expect(page.locator('#paywall-title')).toHaveText('Premium active');
            await expect(page.locator('#paywall-primary-btn')).toContainText('Premium is active');
            await expect(page.locator('#paywall-primary-btn')).toBeDisabled();
            await expect(page.locator('#paywall-secondary-btn')).toBeHidden();
            await expect(page.locator('#paywall-clear-url-btn')).toBeHidden();

            const checkoutParams = await page.evaluate(() => {
                const params = new URL(window.location.href).searchParams;
                return {
                    checkout: params.get('checkout'),
                    provider: params.get('provider')
                };
            });
            expect(checkoutParams).toEqual({ checkout: null, provider: null });
        } finally {
            await context.close();
        }
    });
});
