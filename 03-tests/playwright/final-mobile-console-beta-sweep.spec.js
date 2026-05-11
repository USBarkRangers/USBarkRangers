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

function collectFatalConsoleOutput(page, label, errors) {
    const fatalPattern = /FirebaseError|Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|ReferenceError|TypeError|Cannot read properties|is not defined|premiumService|authPremiumUi|RefreshCoordinator|paywall|settingsController|authService|profile|passport|trip|planner|search|filter|achievement|gamification|logout|ORS directions request failed|Route failed/i;
    const knownNonFatalPattern = /Data poll failed, backing off|Failed to fetch|Could not reach Cloud Firestore backend|code=unavailable|net::ERR_ABORTED|favicon/i;

    page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (knownNonFatalPattern.test(text)) return;
        if (fatalPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', (error) => {
        errors.push(`${label} page error: ${error && error.message ? error.message : String(error)}`);
    });
}

async function openApp(page, expectedPremium = null) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean(
        window.BARK &&
        window.BARK.services &&
        window.BARK.services.premium &&
        window.BARK.paywall &&
        window.BARK.settings &&
        window.BARK.repos &&
        window.BARK.repos.ParkRepo &&
        typeof window.BARK.repos.ParkRepo.getAll === 'function' &&
        window.BARK.repos.ParkRepo.getAll().length > 0 &&
        document.getElementById('map') &&
        document.getElementById('park-search') &&
        document.getElementById('paywall-overlay') &&
        document.getElementById('settings-overlay') &&
        document.getElementById('profile-view')
    ), { timeout: 30000 });

    if (expectedPremium !== null) {
        await page.waitForFunction((premium) => {
            const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
            const service = window.BARK && window.BARK.services && window.BARK.services.premium;
            return Boolean(user && service && typeof service.isPremium === 'function' && service.isPremium() === premium);
        }, expectedPremium, { timeout: 30000 });
    }
}

async function openProfile(page) {
    await page.locator('.nav-item[data-target="profile-view"]').click();
    await expect(page.locator('#profile-view')).toHaveClass(/active/, { timeout: 15000 });
}

async function openPlanner(page) {
    await page.locator('.nav-item[data-target="planner-view"]').click();
    await expect(page.locator('#planner-view')).toHaveClass(/active/, { timeout: 15000 });
}

async function openPaywall(page, source = 'manual') {
    await page.evaluate((paywallSource) => window.BARK.paywall.openPaywall({ source: paywallSource }), source);
    await expect(page.locator('#paywall-overlay')).toHaveClass(/active/, { timeout: 15000 });
}

async function closePaywall(page) {
    const active = await page.locator('#paywall-overlay').evaluate((overlay) => overlay.classList.contains('active'));
    if (!active) return;
    await page.locator('#paywall-close-btn').click();
    await expect(page.locator('#paywall-overlay')).not.toHaveClass(/active/, { timeout: 15000 });
}

async function openSettings(page) {
    await page.evaluate(() => {
        const overlay = document.getElementById('settings-overlay');
        if (!overlay) throw new Error('settings-overlay missing');
        overlay.classList.add('active');
    });
    await expect(page.locator('#settings-overlay')).toHaveClass(/active/, { timeout: 15000 });
}

async function closeSettings(page) {
    const active = await page.locator('#settings-overlay').evaluate((overlay) => overlay.classList.contains('active'));
    if (!active) return;
    await page.locator('#close-settings-btn').click();
    await expect(page.locator('#settings-overlay')).not.toHaveClass(/active/, { timeout: 15000 });
}

async function expectBoxWithinViewport(page, selector, label) {
    const result = await page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
        };
    });

    expect(result.left, `${label} should not overflow left`).toBeGreaterThanOrEqual(-1);
    expect(result.right, `${label} should not overflow right`).toBeLessThanOrEqual(result.viewportWidth + 1);
    expect(result.width, `${label} should fit viewport width`).toBeLessThanOrEqual(result.viewportWidth + 1);
    expect(result.top, `${label} should not overflow top`).toBeGreaterThanOrEqual(-1);
    expect(result.bottom, `${label} should not overflow bottom`).toBeLessThanOrEqual(result.viewportHeight + 1);
}

async function expectHorizontalFit(page, selector, label) {
    const result = await page.locator(selector).evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left,
            right: rect.right,
            width: rect.width,
            viewportWidth: window.innerWidth
        };
    });

    expect(result.left, `${label} should not overflow left`).toBeGreaterThanOrEqual(-1);
    expect(result.right, `${label} should not overflow right`).toBeLessThanOrEqual(result.viewportWidth + 1);
    expect(result.width, `${label} should fit viewport width`).toBeLessThanOrEqual(result.viewportWidth + 1);
}

async function exerciseSearch(page) {
    const mapNav = page.locator('.nav-item[data-target="map-view"]');
    await mapNav.click();
    await expect(mapNav).toHaveClass(/active/, { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.ui-view.active'), { timeout: 15000 });
    await expect(page.locator('#park-search')).toBeVisible();
    await page.locator('#park-search').fill('Acadia');
    await page.waitForTimeout(700);
    await expect(page.locator('#park-search')).toHaveValue('Acadia');
    await expect(page.locator('#clear-search-btn')).toBeVisible({ timeout: 5000 });
    await page.locator('#clear-search-btn').click();
    await expect(page.locator('#park-search')).toHaveValue('');
}

async function openFirstMarkerPanel(page) {
    const mapNav = page.locator('.nav-item[data-target="map-view"]');
    await mapNav.click();
    await expect(mapNav).toHaveClass(/active/, { timeout: 15000 });
    await page.waitForFunction(() => Boolean(
        window.BARK &&
        window.BARK.markerManager &&
        window.BARK.markerManager.markers &&
        window.BARK.markerManager.markers.size > 0
    ), { timeout: 30000 });

    await page.evaluate(() => {
        const marker = Array.from(window.BARK.markerManager.markers.values())
            .find((candidate) => candidate && candidate._parkData);
        if (!marker) throw new Error('No marker with park data available for panel smoke.');
        window.BARK.markerManager.renderMarkerPanel(marker);
    });

    await expect(page.locator('#slide-panel')).toHaveClass(/open/, { timeout: 15000 });
    await expect(page.locator('#panel-title')).not.toHaveText('Park Name');
}

async function seedTwoStopTrip(page) {
    await page.evaluate(() => {
        const stops = window.BARK.repos.ParkRepo.getAll()
            .filter((park) => (
                park &&
                park.id &&
                park.name &&
                Number.isFinite(Number(park.lat)) &&
                Number.isFinite(Number(park.lng))
            ))
            .slice(0, 2)
            .map((park) => ({
                id: park.id,
                name: park.name,
                lat: park.lat,
                lng: park.lng
            }));

        if (stops.length < 2) throw new Error('Need at least two parks for final mobile route prompt smoke.');

        window.BARK.tripDays = [{
            color: window.BARK.DAY_COLORS[0],
            stops,
            notes: ''
        }];
        window.BARK.activeDayIdx = 0;
        window.tripStartNode = null;
        window.tripEndNode = null;
        window.BARK.updateTripUI();
    });
}

test.describe('final mobile and console beta sweep', () => {
    test('signed-out mobile paywall, search, settings, and planner stay readable and console-clean', async ({ browser }) => {
        const context = await newBarkContext(browser, { viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        const errors = [];
        collectFatalConsoleOutput(page, 'signed-out mobile sweep', errors);

        try {
            await openApp(page);
            await page.evaluate(() => window.firebase.auth().signOut());
            await page.waitForFunction(() => !window.firebase.auth().currentUser, { timeout: 30000 });

            await openPaywall(page, 'manual');
            await expect(page.locator('#paywall-title')).toHaveText('Sign in to upgrade');
            await expectBoxWithinViewport(page, '.paywall-modal', 'signed-out paywall modal');
            await closePaywall(page);

            await exerciseSearch(page);
            await openFirstMarkerPanel(page);
            await expectHorizontalFit(page, '#slide-panel', 'signed-out marker detail panel');

            await openProfile(page);
            await openSettings(page);
            await expectHorizontalFit(page, '#settings-modal', 'signed-out settings modal');
            await closeSettings(page);

            await openPlanner(page);
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('signed-in free mobile profile, premium prompts, route prompt, and sign-out stay console-clean', async ({ browser }) => {
        test.skip(!freeStorageExists, `Missing free storage state: ${freeStorageStatePath}`);

        const context = await newBarkContext(browser, {
            storageState: freeStorageStatePath,
            viewport: { width: 390, height: 844 }
        });
        const page = await context.newPage();
        const errors = [];
        collectFatalConsoleOutput(page, 'free mobile sweep', errors);

        try {
            await openApp(page, false);
            await closePaywall(page);
            await openProfile(page);

            await expect(page.locator('#profile-premium-card')).toBeVisible();
            await expect(page.locator('#account-status-card')).toBeVisible();
            await expect(page.locator('#profile-premium-card')).toContainText('Free plan');
            await expect(page.locator('#account-display-email')).not.toHaveText('Loading', { timeout: 15000 });
            await page.locator('#account-status-card').scrollIntoViewIfNeeded();
            await expectHorizontalFit(page, '#account-status-card', 'signed-in account card');

            const cardOrder = await page.evaluate(() => {
                const dataCard = Array.from(document.querySelectorAll('#profile-view .profile-section-card'))
                    .find((card) => card.textContent && card.textContent.includes('My Data & Routes'));
                const premiumCard = document.getElementById('profile-premium-card');
                const accountCard = document.getElementById('account-status-card');
                const achievementCard = Array.from(document.querySelectorAll('#profile-view .profile-section-card'))
                    .find((card) => card.textContent && card.textContent.includes('Achievement Vault'));
                return {
                    premiumBeforeAchievement: Boolean(premiumCard.compareDocumentPosition(achievementCard) & Node.DOCUMENT_POSITION_FOLLOWING),
                    dataBeforeAccount: Boolean(dataCard.compareDocumentPosition(accountCard) & Node.DOCUMENT_POSITION_FOLLOWING)
                };
            });
            expect(cardOrder).toEqual({
                premiumBeforeAchievement: true,
                dataBeforeAccount: true
            });

            await openPaywall(page, 'manual');
            await expect(page.locator('#paywall-title')).toHaveText('Upgrade to BARK Ranger Premium');
            await expectBoxWithinViewport(page, '.paywall-modal', 'free paywall modal');
            await closePaywall(page);

            await openSettings(page);
            await expect(page.locator('#save-settings-cloud-btn')).toContainText('Premium Cloud Sync');
            await expectHorizontalFit(page, '#settings-modal', 'free settings modal');
            await page.evaluate(() => document.getElementById('save-settings-cloud-btn').click());
            await expect(page.locator('#paywall-overlay')).toHaveClass(/active/, { timeout: 15000 });
            await expect(page.locator('#paywall-title')).toHaveText('Cloud settings sync is a Premium feature');
            await expectBoxWithinViewport(page, '.paywall-modal', 'cloud sync paywall modal');
            await closePaywall(page);
            await closeSettings(page);

            await openPlanner(page);
            await seedTwoStopTrip(page);
            await page.evaluate(() => {
                window.__barkFinalSweepDirectionsCalls = [];
                window.BARK.services.ors.directions = async (coordinates, options = {}) => {
                    window.__barkFinalSweepDirectionsCalls.push({ coordinates, options });
                    return { type: 'FeatureCollection', features: [] };
                };
                window.BARK.updateTripUI();
            });
            await expect(page.locator('#start-route-btn')).toHaveAttribute('aria-disabled', 'true');
            await page.locator('#start-route-btn').click({ force: true });
            await expect(page.locator('#paywall-title')).toHaveText('Route generation is a Premium feature');
            await expectBoxWithinViewport(page, '.paywall-modal', 'route generation paywall modal');
            const directionsCalls = await page.evaluate(() => window.__barkFinalSweepDirectionsCalls.slice());
            expect(directionsCalls).toEqual([]);
            await closePaywall(page);

            await exerciseSearch(page);

            await openProfile(page);
            await page.locator('#account-signout-btn').click();
            await page.waitForFunction(() => !window.firebase.auth().currentUser, { timeout: 30000 });
            await expect(page.locator('#login-container')).toBeVisible();
            await expect(page.locator('#profile-premium-status')).not.toHaveText('Premium active');
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });

    test('signed-in Premium mobile profile, settings, search, and planner stay console-clean', async ({ browser }) => {
        test.skip(!premiumStorageExists, `Missing premium storage state: ${premiumStorageStatePath}`);

        const context = await newBarkContext(browser, {
            storageState: premiumStorageStatePath,
            viewport: { width: 390, height: 844 }
        });
        const page = await context.newPage();
        const errors = [];
        collectFatalConsoleOutput(page, 'premium mobile sweep', errors);

        try {
            await openApp(page, true);
            await closePaywall(page);
            await openProfile(page);
            await expect(page.locator('#profile-premium-card')).toContainText('Premium active');
            await expect(page.locator('#account-status-card')).toBeVisible();
            await page.locator('#account-status-card').scrollIntoViewIfNeeded();
            await expectHorizontalFit(page, '#account-status-card', 'premium account card');

            await openSettings(page);
            await expect(page.locator('#save-settings-cloud-btn')).toContainText('Save Settings to Cloud');
            await expectHorizontalFit(page, '#settings-modal', 'premium settings modal');
            await closeSettings(page);

            await exerciseSearch(page);
            await openPlanner(page);
            await seedTwoStopTrip(page);
            await expect(page.locator('#start-route-btn')).not.toHaveAttribute('aria-disabled', 'true');
            expect(errors, errors.join('\n')).toEqual([]);
        } finally {
            await context.close();
        }
    });
});
