const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');
const path = require('path');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const FREE_STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE || '03-tests/.auth/free-user.json';
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE || '03-tests/.auth/premium-user.json';
const GLOBAL_SEARCH_QUERY = 'zzzxqglobal';

const missingEnv = [];
if (!process.env.BARK_E2E_STORAGE_STATE && !FREE_STORAGE_STATE) missingEnv.push('BARK_E2E_STORAGE_STATE');
if (!process.env.BARK_E2E_PREMIUM_STORAGE_STATE && !PREMIUM_STORAGE_STATE) missingEnv.push('BARK_E2E_PREMIUM_STORAGE_STATE');

function resolveStorageState(storageStatePath) {
    return path.isAbsolute(storageStatePath)
        ? storageStatePath
        : path.join(process.cwd(), storageStatePath);
}

function collectRelevantErrors(page, label, errors) {
    const relevantPattern = /FirebaseError|Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|ReferenceError|TypeError|premium|global search|geocode|trail|cluster|map style|visited filter/i;
    page.on('console', (message) => {
        const text = message.text();
        if (message.type() === 'error' && relevantPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', (error) => {
        errors.push(`${label} page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openSignedInApp(page, expectedPremium) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean(
        window.firebase &&
        typeof window.firebase.auth === 'function' &&
        window.firebase.auth().currentUser &&
        window.BARK &&
        window.BARK.authPremiumUi &&
        window.BARK.services &&
        window.BARK.services.premium &&
        document.getElementById('visited-filter') &&
        document.getElementById('map-style-select') &&
        document.getElementById('premium-cluster-toggle') &&
        document.getElementById('toggle-virtual-trail') &&
        document.getElementById('toggle-completed-trails')
    ), { timeout: 30000 });

    await page.waitForFunction((premium) => {
        const service = window.BARK && window.BARK.services && window.BARK.services.premium;
        if (!service || typeof service.getDebugState !== 'function') return false;
        const state = service.getDebugState();
        return Boolean(
            state &&
            state.meta &&
            /^auth-user-snapshot/.test(state.meta.reason || '') &&
            service.isPremium() === premium
        );
    }, expectedPremium, { timeout: 30000 });
}

async function installGeocodeSpy(page) {
    await page.evaluate(() => {
        window.__barkBug017Alerts = [];
        window.__barkBug017GeocodeCalls = [];
        const originalAlert = window.alert;
        const originalGeocode = window.BARK.services.ors.geocode;
        window.alert = function bug017AlertSpy(message) {
            window.__barkBug017Alerts.push(String(message));
        };
        window.BARK.services.ors.geocode = async function bug017GeocodeSpy(query, options = {}) {
            window.__barkBug017GeocodeCalls.push({ query, options });
            return {
                features: [{
                    geometry: { coordinates: [-81.65, 30.33] },
                    properties: { label: `Stubbed global result for ${query}` }
                }]
            };
        };
        window.__barkBug017RestoreSpies = () => {
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
    await page.waitForFunction((query) => {
        const suggestions = document.getElementById('search-suggestions');
        return Boolean(
            suggestions &&
            suggestions.style.display === 'block' &&
            suggestions.textContent &&
            suggestions.textContent.includes(query) &&
            /(Search (global towns|towns & cities)|Searching towns & cities|SELECT FOR ADD STOP|Stubbed global result)/.test(suggestions.textContent)
        );
    }, GLOBAL_SEARCH_QUERY, { timeout: 30000 });
}

function globalSearchButton(page) {
    return page.locator('#search-suggestions .suggestion-item').filter({
        hasText: /Search (global towns|towns & cities)/
    }).last();
}

test.describe('BUG-017 premium product rules audit', () => {
    test('free account cannot bypass global search, clustering, map filters, or trail controls', async ({ browser }) => {
        test.skip(missingEnv.length > 0, `Missing storage state env: ${missingEnv.join(', ')}`);
        const errors = [];
        const context = await newBarkContext(browser, { storageState: resolveStorageState(FREE_STORAGE_STATE) });
        await context.addInitScript(() => {
            window.localStorage.setItem('premiumLoggedIn', 'true');
            window.localStorage.setItem('barkPremiumClustering', 'true');
            window.localStorage.setItem('barkMapStyle', 'terrain');
            window.localStorage.setItem('barkVisitedFilter', 'visited');
        });
        const page = await context.newPage();
        collectRelevantErrors(page, 'free product rules', errors);

        try {
            await openSignedInApp(page, false);
            await installGeocodeSpy(page);
            await showGlobalSearchSuggestion(page);
            await expect(globalSearchButton(page)).toContainText('Upgrade to unlock global search');
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

            const lockedSearchState = await page.evaluate(() => ({
                geocodeCalls: window.__barkBug017GeocodeCalls.slice(),
                alerts: window.__barkBug017Alerts.slice(),
                paywallTitle: document.getElementById('paywall-title').textContent,
                paywallBody: document.getElementById('paywall-body').textContent,
                paywallSource: document.getElementById('paywall-source').textContent
            }));

            const forcedState = await page.evaluate(() => {
                const visitedFilter = document.getElementById('visited-filter');
                const mapStyle = document.getElementById('map-style-select');
                const clusterToggle = document.getElementById('premium-cluster-toggle');
                const virtualTrail = document.getElementById('toggle-virtual-trail');
                const completedTrail = document.getElementById('toggle-completed-trails');

                visitedFilter.value = 'visited';
                visitedFilter.dispatchEvent(new Event('change', { bubbles: true }));

                mapStyle.value = 'terrain';
                mapStyle.dispatchEvent(new Event('change', { bubbles: true }));

                clusterToggle.checked = true;
                clusterToggle.dispatchEvent(new Event('change', { bubbles: true }));

                [virtualTrail, completedTrail].forEach((button) => {
                    button.disabled = false;
                    button.setAttribute('aria-disabled', 'false');
                    button.classList.remove('active');
                    button.click();
                });

                if (window.BARK.paywall && typeof window.BARK.paywall.closePaywall === 'function') {
                    window.BARK.paywall.closePaywall();
                }

                return {
                    isPremium: window.BARK.services.premium.isPremium(),
                    geocodeCalls: window.__barkBug017GeocodeCalls.slice(),
                    alerts: window.__barkBug017Alerts.slice(),
                    paywallTitle: document.getElementById('paywall-title').textContent,
                    paywallBody: document.getElementById('paywall-body').textContent,
                    premiumLoggedIn: window.localStorage.getItem('premiumLoggedIn'),
                    visitedFilterValue: visitedFilter.value,
                    visitedFilterState: window.BARK.visitedFilterState,
                    storedVisitedFilter: window.localStorage.getItem('barkVisitedFilter'),
                    mapStyleValue: mapStyle.value,
                    storedMapStyle: window.localStorage.getItem('barkMapStyle'),
                    premiumClusteringEnabled: window.premiumClusteringEnabled,
                    clusterChecked: clusterToggle.checked,
                    storedClustering: window.localStorage.getItem('barkPremiumClustering'),
                    trailButtons: [virtualTrail, completedTrail].map((button) => ({
                        id: button.id,
                        active: button.classList.contains('active'),
                        disabled: button.disabled,
                        ariaDisabled: button.getAttribute('aria-disabled')
                    })),
                    cloudPayload: window.BARK.buildCloudSettingsPayload()
                };
            });

            expect(forcedState.isPremium).toBe(false);
            expect(lockedSearchState.geocodeCalls, 'free global search must not call ORS geocode').toEqual([]);
            expect(lockedSearchState.alerts, 'free global search should use the paywall modal instead of alert').toEqual([]);
            expect(lockedSearchState.paywallTitle).toMatch(/Global towns and cities/);
            expect(lockedSearchState.paywallBody).toMatch(/add any city or town to your trip/);
            expect(lockedSearchState.paywallSource).toContain('global town search');
            expect(forcedState.geocodeCalls, 'free premium controls must not call ORS geocode').toEqual([]);
            expect(forcedState.paywallTitle).toMatch(/Premium map filters|Premium map tools|Global towns and cities|Virtual trail tracking/);
            expect(forcedState.premiumLoggedIn).toBe('true');
            expect(forcedState.visitedFilterValue).toBe('all');
            expect(forcedState.visitedFilterState).toBe('all');
            expect(forcedState.storedVisitedFilter).toBe('all');
            expect(forcedState.mapStyleValue).toBe('default');
            expect(forcedState.storedMapStyle).toBe('default');
            expect(forcedState.premiumClusteringEnabled).toBe(false);
            expect(forcedState.clusterChecked).toBe(false);
            expect(forcedState.storedClustering).toBe('false');
            expect(forcedState.cloudPayload).toMatchObject({
                mapStyle: 'default',
                visitedFilter: 'all',
                premiumClustering: false
            });
            for (const button of forcedState.trailButtons) {
                expect(button.active, `${button.id} should fail closed`).toBe(false);
                expect(button.disabled, `${button.id} should be relocked`).toBe(true);
                expect(button.ariaDisabled, `${button.id} should be aria-disabled`).toBe('true');
            }
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('premium account can use global search, clustering, map filters, and trail controls', async ({ browser }) => {
        test.skip(missingEnv.length > 0, `Missing storage state env: ${missingEnv.join(', ')}`);
        const errors = [];
        const context = await newBarkContext(browser, { storageState: resolveStorageState(PREMIUM_STORAGE_STATE) });
        const page = await context.newPage();
        collectRelevantErrors(page, 'premium product rules', errors);

        try {
            await openSignedInApp(page, true);
            await installGeocodeSpy(page);
            await showGlobalSearchSuggestion(page);
            await expect(page.locator('#search-suggestions')).toContainText('Stubbed global result', { timeout: 15000 });

            const premiumState = await page.evaluate(() => {
                const visitedFilter = document.getElementById('visited-filter');
                const mapStyle = document.getElementById('map-style-select');
                const clusterToggle = document.getElementById('premium-cluster-toggle');
                const virtualTrail = document.getElementById('toggle-virtual-trail');
                const completedTrail = document.getElementById('toggle-completed-trails');

                visitedFilter.value = 'visited';
                visitedFilter.dispatchEvent(new Event('change', { bubbles: true }));

                mapStyle.value = 'terrain';
                mapStyle.dispatchEvent(new Event('change', { bubbles: true }));

                window.BARK.settings.set('premiumClusteringEnabled', true);
                if (typeof window.BARK.syncSettingsControls === 'function') window.BARK.syncSettingsControls();

                [virtualTrail, completedTrail].forEach((button) => {
                    button.classList.remove('active');
                    button.click();
                });

                const state = {
                    isPremium: window.BARK.services.premium.isPremium(),
                    geocodeCalls: window.__barkBug017GeocodeCalls.slice(),
                    visitedFilterDisabled: visitedFilter.disabled,
                    visitedFilterValue: visitedFilter.value,
                    visitedFilterState: window.BARK.visitedFilterState,
                    mapStyleDisabled: mapStyle.disabled,
                    mapStyleValue: mapStyle.value,
                    premiumClusteringEnabled: window.premiumClusteringEnabled,
                    clusterDisabled: clusterToggle.disabled,
                    clusterChecked: clusterToggle.checked,
                    trailButtons: [virtualTrail, completedTrail].map((button) => ({
                        id: button.id,
                        active: button.classList.contains('active'),
                        disabled: button.disabled,
                        ariaDisabled: button.getAttribute('aria-disabled')
                    }))
                };

                [virtualTrail, completedTrail].forEach((button) => {
                    if (button.classList.contains('active')) button.click();
                });
                window.BARK.settings.set('premiumClusteringEnabled', false);
                if (typeof window.BARK.syncSettingsControls === 'function') window.BARK.syncSettingsControls();
                visitedFilter.value = 'all';
                visitedFilter.dispatchEvent(new Event('change', { bubbles: true }));
                mapStyle.value = 'default';
                mapStyle.dispatchEvent(new Event('change', { bubbles: true }));

                return state;
            });

            expect(premiumState.isPremium).toBe(true);
            expect(premiumState.geocodeCalls.length, 'premium global search should reach ORS geocode path').toBeGreaterThan(0);
            expect(premiumState.visitedFilterDisabled).toBe(false);
            expect(premiumState.visitedFilterValue).toBe('visited');
            expect(premiumState.visitedFilterState).toBe('visited');
            expect(premiumState.mapStyleDisabled).toBe(false);
            expect(premiumState.mapStyleValue).toBe('terrain');
            expect(premiumState.premiumClusteringEnabled).toBe(true);
            expect(premiumState.clusterDisabled).toBe(false);
            expect(premiumState.clusterChecked).toBe(true);
            for (const button of premiumState.trailButtons) {
                expect(button.disabled, `${button.id} should be enabled`).toBe(false);
                expect(button.ariaDisabled, `${button.id} should be aria-enabled`).toBe('false');
                expect(button.active, `${button.id} should toggle active`).toBe(true);
            }
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
