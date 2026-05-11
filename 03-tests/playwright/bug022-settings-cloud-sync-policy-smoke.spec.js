const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const FREE_STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE || '03-tests/.auth/free-user.json';
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE || '03-tests/.auth/premium-user.json';

function resolveStorageState(storageStatePath) {
    return path.isAbsolute(storageStatePath)
        ? storageStatePath
        : path.join(process.cwd(), storageStatePath);
}

const freeStorageStatePath = resolveStorageState(FREE_STORAGE_STATE);
const premiumStorageStatePath = resolveStorageState(PREMIUM_STORAGE_STATE);
const freeStorageExists = fs.existsSync(freeStorageStatePath);
const premiumStorageExists = fs.existsSync(premiumStorageStatePath);

function collectRelevantErrors(page, label, errors) {
    const relevantPattern = /Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|settingsController|authService.*cloud.*failed|cloud settings.*failed|saveUserSettings.*failed|premium cloud.*failed|ReferenceError/i;
    const nonFatalConnectivityPattern = /Could not reach Cloud Firestore backend|code=unavailable|Data poll failed, backing off|Failed to fetch/i;
    page.on('console', (message) => {
        const text = message.text();
        if (nonFatalConnectivityPattern.test(text)) return;
        if (message.type() === 'error' && relevantPattern.test(text)) {
            errors.push(`${label} console error: ${text}`);
        }
    });
    page.on('pageerror', (error) => {
        errors.push(`${label} page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openApp(page, expectedPremium = null) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean(
        window.BARK &&
        window.BARK.settings &&
        window.BARK.services &&
        window.BARK.services.premium &&
        typeof window.BARK.buildCloudSettingsPayload === 'function' &&
        document.getElementById('settings-gear-btn') &&
        document.getElementById('save-settings-cloud-btn') &&
        document.getElementById('save-settings-cloud-copy') &&
        document.getElementById('standard-cluster-toggle') &&
        document.getElementById('premium-cluster-toggle')
    ), { timeout: 30000 });

    if (expectedPremium !== null) {
        await page.waitForFunction((premium) => {
            const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
            const service = window.BARK && window.BARK.services && window.BARK.services.premium;
            return Boolean(user && service && typeof service.isPremium === 'function' && service.isPremium() === premium);
        }, expectedPremium, { timeout: 30000 });
    }
}

async function stubCloudSave(page) {
    await page.evaluate(() => {
        window.__barkBug022CloudWrites = [];
        const firebaseService = window.BARK.services && window.BARK.services.firebase;
        if (!firebaseService || typeof firebaseService.saveUserSettings !== 'function') {
            throw new Error('firebaseService.saveUserSettings is unavailable.');
        }
        firebaseService.saveUserSettings = async function bug022SaveUserSettingsSpy(uid, payload) {
            window.__barkBug022CloudWrites.push({ uid, payload });
        };
    });
}

async function openSettings(page) {
    await page.evaluate(() => {
        document.getElementById('settings-overlay').classList.add('active');
    });
    await expect(page.locator('#settings-overlay')).toHaveClass(/active/, { timeout: 15000 });
}

async function closePaywallIfOpen(page) {
    const active = await page.locator('#paywall-overlay').evaluate((overlay) => (
        overlay.classList.contains('active')
    )).catch(() => false);
    if (!active) return;

    await page.locator('#paywall-close-btn').click({ timeout: 5000 });
}

test.describe('BUG-022 settings cloud sync policy', () => {
    test('signed-out users keep basic settings locally without cloud sync', async ({ browser }) => {
        test.setTimeout(90000);

        const context = await newBarkContext(browser);
        const page = await context.newPage();
        const errors = [];
        collectRelevantErrors(page, 'signed-out local settings', errors);

        try {
            await openApp(page);
            const saved = await page.evaluate(() => {
                window.BARK.settings.set('standardClusteringEnabled', true);
                return {
                    currentUser: window.firebase && window.firebase.auth && window.firebase.auth().currentUser
                        ? window.firebase.auth().currentUser.uid
                        : null,
                    standardClusteringEnabled: window.standardClusteringEnabled,
                    storedStandardClustering: window.localStorage.getItem('barkStandardClustering')
                };
            });

            expect(saved.currentUser).toBeNull();
            expect(saved.standardClusteringEnabled).toBe(true);
            expect(saved.storedStandardClustering).toBe('true');

            await page.reload();
            await openApp(page);
            const restored = await page.evaluate(() => ({
                standardClusteringEnabled: window.standardClusteringEnabled,
                storedStandardClustering: window.localStorage.getItem('barkStandardClustering')
            }));

            expect(restored.standardClusteringEnabled).toBe(true);
            expect(restored.storedStandardClustering).toBe('true');
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('signed-in free users autosave locally and get Premium prompt for cloud sync', async ({ browser }) => {
        test.skip(!freeStorageExists, `Missing free storage state: ${freeStorageStatePath}`);
        test.setTimeout(90000);

        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        await context.addInitScript(() => {
            window.localStorage.setItem('premiumLoggedIn', 'true');
            window.localStorage.setItem('barkMapStyle', 'terrain');
            window.localStorage.setItem('barkVisitedFilter', 'visited');
            window.localStorage.setItem('barkPremiumClustering', 'true');
        });
        const page = await context.newPage();
        const errors = [];
        collectRelevantErrors(page, 'free local settings', errors);

        try {
            await openApp(page, false);
            await closePaywallIfOpen(page);
            await stubCloudSave(page);
            const localState = await page.evaluate(async () => {
                window.BARK.settings.set('standardClusteringEnabled', true);
                if (typeof window.BARK.scheduleCloudSettingsAutosave === 'function') {
                    window.BARK.scheduleCloudSettingsAutosave();
                }
                await new Promise(resolve => setTimeout(resolve, 700));
                return {
                    isPremium: window.BARK.services.premium.isPremium(),
                    standardClusteringEnabled: window.standardClusteringEnabled,
                    storedStandardClustering: window.localStorage.getItem('barkStandardClustering'),
                    premiumClusteringEnabled: window.premiumClusteringEnabled,
                    storedPremiumClustering: window.localStorage.getItem('barkPremiumClustering'),
                    mapStyle: window.localStorage.getItem('barkMapStyle'),
                    visitedFilter: window.localStorage.getItem('barkVisitedFilter'),
                    cloudWrites: window.__barkBug022CloudWrites.slice()
                };
            });

            expect(localState.isPremium).toBe(false);
            expect(localState.standardClusteringEnabled).toBe(true);
            expect(localState.storedStandardClustering).toBe('true');
            expect(localState.premiumClusteringEnabled).toBe(false);
            expect(localState.storedPremiumClustering).toBe('false');
            expect(localState.mapStyle).toBe('default');
            expect(localState.visitedFilter).toBe('all');
            expect(localState.cloudWrites).toEqual([]);

            await openSettings(page);
            await expect(page.locator('#save-settings-cloud-btn')).toContainText('Premium Cloud Sync');
            await expect(page.locator('#save-settings-cloud-copy')).toContainText('Local settings save automatically');
            await page.evaluate(() => document.getElementById('save-settings-cloud-btn').click());
            await expect(page.locator('#paywall-overlay')).toHaveClass(/active/, { timeout: 15000 });
            await expect(page.locator('#paywall-overlay')).toContainText('Cloud settings sync is a Premium feature');
            await closePaywallIfOpen(page);

            const cloudWritesAfterClick = await page.evaluate(() => window.__barkBug022CloudWrites.slice());
            expect(cloudWritesAfterClick).toEqual([]);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('signed-in Premium users can sync premium settings to cloud', async ({ browser }) => {
        test.skip(!premiumStorageExists, `Missing premium storage state: ${premiumStorageStatePath}`);
        test.setTimeout(90000);

        const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const page = await context.newPage();
        const errors = [];
        collectRelevantErrors(page, 'premium cloud settings', errors);

        try {
            await openApp(page, true);
            await closePaywallIfOpen(page);
            await stubCloudSave(page);
            await page.evaluate(() => {
                window.localStorage.setItem('barkMapStyle', 'terrain');
                window.localStorage.setItem('barkVisitedFilter', 'visited');
                window.BARK.visitedFilterState = 'visited';
                window.BARK.settings.set('premiumClusteringEnabled', true);
            });

            await openSettings(page);
            await expect(page.locator('#save-settings-cloud-btn')).toContainText('Save Settings to Cloud');
            await page.evaluate(() => document.getElementById('save-settings-cloud-btn').click());
            await expect(page.locator('#save-settings-cloud-btn')).toContainText('SAVED TO CLOUD', { timeout: 15000 });

            const writes = await page.evaluate(() => window.__barkBug022CloudWrites.slice());
            expect(writes).toHaveLength(1);
            expect(writes[0].payload).toMatchObject({
                mapStyle: 'terrain',
                visitedFilter: 'visited',
                premiumClustering: true
            });
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
