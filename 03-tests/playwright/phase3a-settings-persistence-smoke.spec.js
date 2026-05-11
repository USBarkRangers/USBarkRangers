const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const PREMIUM_STORAGE_STATE = process.env.BARK_E2E_PREMIUM_STORAGE_STATE;
const STORAGE_STATE = PREMIUM_STORAGE_STATE;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_STORAGE_STATE = '03-tests/.auth/premium-user.json';

const missingEnv = [
    !BASE_URL ? 'BARK_E2E_BASE_URL' : null,
    !STORAGE_STATE ? 'BARK_E2E_PREMIUM_STORAGE_STATE' : null
].filter(Boolean);

const storageStatePath = STORAGE_STATE ? path.resolve(STORAGE_STATE) : null;
const storageStateExists = storageStatePath ? fs.existsSync(storageStatePath) : false;

function buildEnvHelp() {
    return [
        'Phase 3A settings persistence smoke tests are skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}"`,
        '  BARK_E2E_STORAGE_STATE="$BARK_E2E_PREMIUM_STORAGE_STATE" npm run e2e:auth:save',
        '  npm run test:e2e:settings',
        '',
        'Notes:',
        '  - The storage state should be created with the premium/manual override Firebase Email/Password E2E test account.',
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

    if (STORAGE_STATE && !storageStateExists) {
        throw new Error([
            `BARK_E2E_PREMIUM_STORAGE_STATE points to a missing file: ${storageStatePath}`,
            'Generate it with:',
            `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
            `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}"`,
            '  BARK_E2E_STORAGE_STATE="$BARK_E2E_PREMIUM_STORAGE_STATE" npm run e2e:auth:save'
        ].join('\n'));
    }
});

test.use(storageStateExists ? { storageState: storageStatePath } : {});

function collectRelevantConsoleErrors(page, label, errors) {
    const relevantPattern = /settingsController|settingsStore|authService.*cloud|cloud settings|localStorage|sessionStorage|saveUserSettings|Firebase write|Firestore|firestore/i;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (relevantPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', error => {
        const text = error && error.message ? error.message : String(error);
        if (relevantPattern.test(text)) errors.push(`${label} page error: ${text}`);
    });
}

async function openSignedInApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        const bark = window.BARK;
        const repo = bark && bark.repos && bark.repos.ParkRepo;
        const firebaseReady = typeof window.firebase !== 'undefined'
            && firebase.auth
            && firebase.auth().currentUser;
        return Boolean(
            bark
            && repo
            && typeof repo.getAll === 'function'
            && repo.getAll().length > 0
            && bark.services
            && bark.services.firebase
            && typeof bark.buildCloudSettingsPayload === 'function'
            && document.getElementById('settings-gear-btn')
            && document.getElementById('save-settings-cloud-btn')
            && firebaseReady
        );
    }, { timeout: 30000 });
}

async function getCurrentUser(page) {
    return page.evaluate(() => {
        const user = window.firebase && window.firebase.auth && window.firebase.auth().currentUser;
        return user ? {
            uid: user.uid,
            email: user.email || null
        } : null;
    });
}

async function ensureVisitedFilterAvailable(page) {
    const visitedFilter = page.locator('#visited-filter');
    if (await visitedFilter.count() === 0) {
        test.skip(true, '#visited-filter is not rendered in this app state.');
    }
    await expect(visitedFilter).toBeEnabled({ timeout: 30000 });
}

async function getVisitedFilterValue(page) {
    return page.locator('#visited-filter').inputValue();
}

async function chooseAlternateVisitedFilter(page, originalValue) {
    const options = await page.locator('#visited-filter option').evaluateAll(nodes => nodes.map(option => option.value));
    const preferred = originalValue === 'unvisited' ? 'all' : 'unvisited';
    if (options.includes(preferred)) return preferred;
    const fallback = options.find(value => value !== originalValue);
    if (!fallback) throw new Error('No alternate visited filter option is available.');
    return fallback;
}

async function setVisitedFilter(page, value) {
    await ensureVisitedFilterAvailable(page);
    await page.locator('#visited-filter').selectOption(value);
    await page.waitForFunction(
        ({ expected }) => {
            const filter = document.getElementById('visited-filter');
            return Boolean(
                filter &&
                filter.value === expected &&
                localStorage.getItem('barkVisitedFilter') === expected &&
                window.BARK &&
                window.BARK.visitedFilterState === expected
            );
        },
        { expected: value },
        { timeout: 30000 }
    );
}

async function waitForVisitedFilterValue(page, value) {
    await ensureVisitedFilterAvailable(page);
    await page.waitForFunction(
        ({ expected }) => {
            const filter = document.getElementById('visited-filter');
            return Boolean(
                filter &&
                filter.value === expected &&
                localStorage.getItem('barkVisitedFilter') === expected &&
                window.BARK &&
                window.BARK.visitedFilterState === expected
            );
        },
        { expected: value },
        { timeout: 30000 }
    );
}

async function saveSettingsToCloud(page) {
    const profileNav = page.locator('.nav-item[data-target="profile-view"]').first();
    if (await profileNav.count() > 0) {
        await profileNav.click();
        await expect(page.locator('#profile-view')).toHaveClass(/active/, { timeout: 15000 });
    }

    await page.locator('#settings-gear-btn').click();
    await expect(page.locator('#settings-overlay')).toHaveClass(/active/, { timeout: 15000 });

    const saveButton = page.locator('#save-settings-cloud-btn');
    await expect(saveButton).toBeVisible({ timeout: 15000 });
    await saveButton.click();
    await expect(saveButton).toContainText('SAVED TO CLOUD', { timeout: 30000 });
    await page.waitForFunction(() => {
        return window._savingCloudSettingsRevision === 0 &&
            window._pendingLocalSettingsChanges !== true &&
            window._cloudSettingsLoaded === true;
    }, { timeout: 30000 });

    await page.locator('#close-settings-btn').click();
    await expect(page.locator('#settings-overlay')).not.toHaveClass(/active/, { timeout: 15000 });
}

async function signOut(page) {
    await page.evaluate(() => window.firebase.auth().signOut());
    await page.waitForFunction(() => !window.firebase.auth().currentUser, { timeout: 30000 });
}

async function restoreVisitedFilter(browser, originalValue, errors) {
    const context = await newBarkContext(browser, { storageState: storageStatePath });
    const page = await context.newPage();
    collectRelevantConsoleErrors(page, 'cleanup', errors);

    try {
        await openSignedInApp(page);
        await setVisitedFilter(page, originalValue);
        await saveSettingsToCloud(page);
        await page.reload();
        await openSignedInApp(page);
        await waitForVisitedFilterValue(page, originalValue);
    } finally {
        await context.close();
    }
}

test.describe('Phase 3A settings persistence smoke', () => {
    test('visited filter persists across reload and saved sign-in state', async ({ browser, page }) => {
        test.setTimeout(90000);

        const relevantErrors = [];
        collectRelevantConsoleErrors(page, 'primary', relevantErrors);

        let originalVisitedFilter = null;
        let cleanupDone = false;

        try {
            await openSignedInApp(page);
            const user = await getCurrentUser(page);
            expect(user && user.uid, 'Signed-in storage state should produce a Firebase user').toBeTruthy();

            await ensureVisitedFilterAvailable(page);
            originalVisitedFilter = await getVisitedFilterValue(page);
            const alternateVisitedFilter = await chooseAlternateVisitedFilter(page, originalVisitedFilter);

            await setVisitedFilter(page, alternateVisitedFilter);
            await saveSettingsToCloud(page);

            await page.reload();
            await openSignedInApp(page);
            await waitForVisitedFilterValue(page, alternateVisitedFilter);

            await signOut(page);

            const restoredContext = await newBarkContext(browser, { storageState: storageStatePath });
            const restoredPage = await restoredContext.newPage();
            collectRelevantConsoleErrors(restoredPage, 'restored sign-in', relevantErrors);
            try {
                await openSignedInApp(restoredPage);
                await waitForVisitedFilterValue(restoredPage, alternateVisitedFilter);
                await setVisitedFilter(restoredPage, originalVisitedFilter);
                await saveSettingsToCloud(restoredPage);
                await restoredPage.reload();
                await openSignedInApp(restoredPage);
                await waitForVisitedFilterValue(restoredPage, originalVisitedFilter);
                cleanupDone = true;
            } finally {
                await restoredContext.close();
            }

            expect(relevantErrors, relevantErrors.join('\n')).toEqual([]);
        } finally {
            if (originalVisitedFilter && !cleanupDone) {
                try {
                    await restoreVisitedFilter(browser, originalVisitedFilter, relevantErrors);
                } catch (error) {
                    relevantErrors.push(`cleanup failed for visited filter ${originalVisitedFilter}: ${error.message || error}`);
                }
            }
        }
    });
});
