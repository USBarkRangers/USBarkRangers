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
const GLOBAL_SEARCH_QUERY = 'zzzxqglobal';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !FREE_STORAGE_STATE ? 'BARK_E2E_STORAGE_STATE' : null,
    !PREMIUM_STORAGE_STATE ? 'BARK_E2E_PREMIUM_STORAGE_STATE' : null
].filter(Boolean);

const freeStorageStatePath = FREE_STORAGE_STATE ? path.resolve(FREE_STORAGE_STATE) : null;
const premiumStorageStatePath = PREMIUM_STORAGE_STATE ? path.resolve(PREMIUM_STORAGE_STATE) : null;

function buildEnvHelp() {
    return [
        'Phase 4C global search entitlement smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_FREE_STORAGE_STATE}"`,
        `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
        '  npm run test:e2e:global-search',
        '',
        'Notes:',
        '  - The free and premium storage states use Firebase Email/Password E2E accounts.',
        '  - The premium account must have users/{uid}.entitlement seeded outside the client app.',
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
        throw new Error(`BARK_E2E_STORAGE_STATE points to a missing file: ${freeStorageStatePath}`);
    }

    if (PREMIUM_STORAGE_STATE && !fs.existsSync(premiumStorageStatePath)) {
        throw new Error(`BARK_E2E_PREMIUM_STORAGE_STATE points to a missing file: ${premiumStorageStatePath}`);
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

async function openSearchReadyApp(page, expectedPremium) {
    await page.goto(BASE_URL);
    await page.waitForFunction(({ expected }) => {
        const bark = window.BARK;
        const repo = bark && bark.repos && bark.repos.ParkRepo;
        const premiumService = bark && bark.services && bark.services.premium;
        const ors = bark && bark.services && bark.services.ors;

        if (!bark || !repo || typeof repo.getAll !== 'function' || repo.getAll().length === 0) return false;
        if (!premiumService || typeof premiumService.isPremium !== 'function') return false;
        if (!ors || typeof ors.geocode !== 'function') return false;
        if (!document.getElementById('park-search') || !document.getElementById('search-suggestions')) return false;

        if (expected === null) {
            return Boolean(window.firebase && typeof window.firebase.auth === 'function' && !window.firebase.auth().currentUser);
        }

        const debugState = typeof premiumService.getDebugState === 'function' ? premiumService.getDebugState() : null;
        const hasAuthSnapshot = Boolean(debugState && debugState.meta && /^auth-user-snapshot/.test(debugState.meta.reason || ''));
        return hasAuthSnapshot && premiumService.isPremium() === expected;
    }, { expected: expectedPremium }, { timeout: 30000 });
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
            return {
                features: [{
                    geometry: { coordinates: [-122.4194, 37.7749] },
                    properties: { label: `Stubbed global result for ${query}` }
                }]
            };
        };
        window.__barkE2eRestoreGeocode = () => {
            window.alert = originalAlert;
            window.BARK.services.ors.geocode = originalGeocode;
        };
    });
}

async function getGeocodeCallCount(page) {
    return page.evaluate(() => Array.isArray(window.__barkE2eGeocodeCalls) ? window.__barkE2eGeocodeCalls.length : 0);
}

async function getAlertMessages(page) {
    return page.evaluate(() => Array.isArray(window.__barkE2eAlerts) ? window.__barkE2eAlerts.slice() : []);
}

async function showGlobalSearchSuggestion(page) {
    await page.locator('#park-search').fill(GLOBAL_SEARCH_QUERY);
    await page.waitForFunction(({ query }) => {
        const suggestions = document.getElementById('search-suggestions');
        return Boolean(
            suggestions &&
            suggestions.style.display === 'block' &&
            suggestions.textContent &&
            suggestions.textContent.includes(query) &&
            /(Search (global towns|towns & cities)|Searching towns & cities|SELECT FOR ADD STOP|Stubbed global result)/.test(suggestions.textContent)
        );
    }, { query: GLOBAL_SEARCH_QUERY }, { timeout: 30000 });
}

function globalSearchButton(page) {
    return page.locator('#search-suggestions .suggestion-item').filter({
        hasText: /Search (global towns|towns & cities)/
    }).last();
}

async function expectGlobalSearchPaywallFromClick(page) {
    await globalSearchButton(page).click();
    await page.waitForFunction(() => {
        const overlay = document.getElementById('paywall-overlay');
        const title = document.getElementById('paywall-title');
        return Boolean(
            overlay &&
            overlay.classList.contains('active') &&
            title &&
            /Global towns and cities/.test(title.textContent || '')
        );
    }, { timeout: 5000 });
    const state = await page.evaluate(() => ({
        alerts: Array.isArray(window.__barkE2eAlerts) ? window.__barkE2eAlerts.slice() : [],
        title: document.getElementById('paywall-title').textContent,
        body: document.getElementById('paywall-body').textContent,
        source: document.getElementById('paywall-source').textContent
    }));
    expect(state.alerts, 'locked global search should use the paywall modal instead of alert').toEqual([]);
    expect(state.title).toMatch(/Global towns and cities/);
    expect(state.body).toMatch(/add any city or town to your trip/);
    expect(state.source).toContain('global town search');
}

test.describe('Phase 4C global search entitlement smoke', () => {
    test('signed-out global search stays locked with sign-in prompt', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser);
        const page = await context.newPage();
        collectConsoleErrors(page, 'signed-out', errors);

        try {
            await openSearchReadyApp(page, null);
            await installGeocodeSpy(page);
            await showGlobalSearchSuggestion(page);

            await expect(globalSearchButton(page)).toContainText('Sign in to unlock global search');
            await expectGlobalSearchPaywallFromClick(page);
            await expect(await getGeocodeCallCount(page)).toBe(0);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('signed-in free global search stays locked and does not call ORS geocode', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const page = await context.newPage();
        collectConsoleErrors(page, 'signed-in free', errors);

        try {
            await openSearchReadyApp(page, false);
            await installGeocodeSpy(page);
            await showGlobalSearchSuggestion(page);

            await expect(globalSearchButton(page)).toContainText('Upgrade to unlock global search');
            await expectGlobalSearchPaywallFromClick(page);
            await expect(await getGeocodeCallCount(page)).toBe(0);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('premium global search auto-runs and reaches stubbed geocode path', async ({ browser }) => {
        const errors = [];
        const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const page = await context.newPage();
        collectConsoleErrors(page, 'premium', errors);

        try {
            await openSearchReadyApp(page, true);
            await installGeocodeSpy(page);
            await showGlobalSearchSuggestion(page);

            await page.waitForFunction(() => {
                return Array.isArray(window.__barkE2eGeocodeCalls) && window.__barkE2eGeocodeCalls.length === 1;
            }, { timeout: 15000 });
            await expect(page.locator('#search-suggestions')).toContainText('Stubbed global result', { timeout: 15000 });
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
