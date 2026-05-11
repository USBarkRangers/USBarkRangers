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
        'BUG-001 achievement permission smoke is skipped because required configuration is missing.',
        `Missing: ${missingEnv.join(', ')}`,
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_FREE_STORAGE_STATE}"`,
        `  export BARK_E2E_PREMIUM_STORAGE_STATE="$PWD/${DEFAULT_PREMIUM_STORAGE_STATE}"`,
        '  npx playwright test 03-tests/playwright/bug001-achievement-permission-smoke.spec.js --workers=1 --reporter=list'
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

function collectAchievementPermissionErrors(page, errors, label) {
    const permissionPattern = /FirebaseError|Missing or insufficient permissions|PERMISSION_DENIED|permission-denied|Sync error|Achievement evaluation/i;
    page.on('console', message => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (permissionPattern.test(text)) errors.push(`${label} console error: ${text}`);
    });
    page.on('pageerror', error => {
        const text = error && error.message ? error.message : String(error);
        errors.push(`${label} page error: ${text}`);
    });
}

async function openAchievementReadyProfile(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        return Boolean(
            window.firebase &&
            firebase.auth &&
            firebase.auth().currentUser &&
            window.BARK &&
            typeof window.BARK.evaluateAchievements === 'function' &&
            window.gamificationEngine &&
            typeof window.gamificationEngine.evaluateAndStoreAchievements === 'function' &&
            document.getElementById('profile-view') &&
            document.getElementById('rare-feats-grid') &&
            document.getElementById('paws-grid')
        );
    }, { timeout: 30000 });

    await page.locator('.nav-item[data-target="profile-view"]').click();
    await expect(page.locator('#profile-view')).toHaveClass(/active/);
    await expect(page.locator('#profile-view')).toContainText('Achievement Vault');
}

async function exerciseAchievementRuntime(page) {
    return page.evaluate(async () => {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error('Expected signed-in user for achievement smoke.');
        const smokeId = 'bug001RuntimeSmoke';
        const path = `users/${user.uid}/achievements/${smokeId}`;
        const result = {
            uid: user.uid,
            path,
            payloadKeys: ['achievementId', 'dateEarned', 'tier'],
            evaluationOk: false,
            ownerWriteReadOk: false,
            evaluationError: null,
            ownerWriteReadError: null,
            exists: false,
            keys: [],
            achievementId: null,
            tier: null,
            dateEarnedType: null,
            bronzePawStatus: null
        };

        const now = Date.now();
        const visits = Array.from({ length: 10 }, (_, index) => ({
            id: `bug001-runtime-visit-${index}`,
            name: `BUG001 Runtime Visit ${index + 1}`,
            state: 'FL',
            verified: false,
            ts: now - (index * 1000)
        }));

        try {
            await window.BARK.evaluateAchievements(visits);
            const achievements = window.gamificationEngine.evaluate(visits, null, window.currentWalkPoints || 0);
            result.evaluationOk = true;
            result.bronzePawStatus = achievements.paws.find(item => item.id === 'bronzePaw')?.status || null;
        } catch (error) {
            result.evaluationError = error && error.message ? error.message : String(error);
        }

        const payload = {
            achievementId: smokeId,
            tier: 'honor',
            dateEarned: firebase.firestore.FieldValue.serverTimestamp()
        };
        const ref = firebase.firestore()
            .collection('users')
            .doc(user.uid)
            .collection('achievements')
            .doc(smokeId);

        try {
            await ref.set(payload);
            const snap = await ref.get();
            const data = snap.data() || {};
            result.ownerWriteReadOk = true;
            result.exists = snap.exists;
            result.keys = Object.keys(data).sort();
            result.achievementId = data.achievementId;
            result.tier = data.tier;
            result.dateEarnedType = data.dateEarned && typeof data.dateEarned.toDate === 'function' ? 'timestamp' : typeof data.dateEarned;
        } catch (error) {
            result.ownerWriteReadError = error && error.message ? error.message : String(error);
        }

        return result;
    });
}

async function expectAchievementRuntimeHealthy(page, label) {
    const errors = [];
    collectAchievementPermissionErrors(page, errors, label);

    await openAchievementReadyProfile(page);
    const result = await exerciseAchievementRuntime(page);

    expect(result.uid, `${label} should have a Firebase UID`).toBeTruthy();
    expect(result.path).toContain(`/achievements/bug001RuntimeSmoke`);
    expect(result.payloadKeys).toEqual(['achievementId', 'dateEarned', 'tier']);
    expect(result.evaluationError, JSON.stringify(result, null, 2)).toBeNull();
    expect(result.evaluationOk, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.ownerWriteReadError, JSON.stringify(result, null, 2)).toBeNull();
    expect(result.ownerWriteReadOk, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.exists).toBe(true);
    expect(result.keys).toEqual(['achievementId', 'dateEarned', 'tier']);
    expect(result.achievementId).toBe('bug001RuntimeSmoke');
    expect(result.tier).toBe('honor');
    expect(result.dateEarnedType).toBe('timestamp');
    expect(result.bronzePawStatus).toBe('unlocked');
    await expect(page.locator('#paws-grid')).toContainText('Bronze Paw');

    expect(errors, errors.join('\n')).toEqual([]);
}

test.describe('BUG-001 achievement runtime permission smoke', () => {
    test('signed-in free user can evaluate, write, and read achievement docs', async ({ browser }) => {
        const context = await newBarkContext(browser, { storageState: freeStorageStatePath });
        const page = await context.newPage();
        try {
            await expectAchievementRuntimeHealthy(page, 'free user');
        } finally {
            await context.close();
        }
    });

    test('signed-in premium user can evaluate, write, and read achievement docs', async ({ browser }) => {
        const context = await newBarkContext(browser, { storageState: premiumStorageStatePath });
        const page = await context.newPage();
        try {
            await expectAchievementRuntimeHealthy(page, 'premium user');
        } finally {
            await context.close();
        }
    });
});
