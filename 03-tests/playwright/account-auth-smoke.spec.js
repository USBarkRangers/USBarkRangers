const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL;
const STORAGE_STATE = process.env.BARK_E2E_STORAGE_STATE;
const DEFAULT_BASE_URL = 'http://localhost:4173/index.html';
const DEFAULT_STORAGE_STATE = '03-tests/.auth/free-user.json';

const storageStatePath = STORAGE_STATE ? path.resolve(STORAGE_STATE) : null;
const storageStateExists = storageStatePath ? fs.existsSync(storageStatePath) : false;

function buildEnvHelp() {
    return [
        'Account auth UI smoke tests are skipped because BARK_E2E_BASE_URL is missing.',
        '',
        'Local setup:',
        '  python3 -m http.server 4173 --bind localhost --directory 01-code/app',
        `  export BARK_E2E_BASE_URL=${DEFAULT_BASE_URL}`,
        `  export BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}"`,
        '  npm run test:e2e:auth-ui'
    ].join('\n');
}

if (!BASE_URL) {
    console.warn(buildEnvHelp());
}

test.skip(!BASE_URL, buildEnvHelp());

test.beforeAll(() => {
    if (!BASE_URL) return;
    try {
        new URL(BASE_URL);
    } catch (error) {
        throw new Error(`BARK_E2E_BASE_URL is not a valid absolute URL: ${BASE_URL}`);
    }
});

async function openApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => {
        return Boolean(
            window.BARK &&
            window.BARK.authAccountUi &&
            typeof window.BARK.authAccountUi.showMode === 'function' &&
            window.firebase &&
            typeof window.firebase.auth === 'function' &&
            document.getElementById('account-auth-card')
        );
    }, { timeout: 30000 });
}

async function openProfile(page) {
    await page.locator('.nav-item[data-target="profile-view"]').click();
    await expect(page.locator('#profile-view')).toBeVisible();
}

async function getProfileCardOrder(page) {
    return page.evaluate(() => {
        const profile = document.getElementById('profile-view');
        if (!profile) throw new Error('Profile view not found.');

        const cardContaining = (text) => {
            const cards = Array.from(profile.querySelectorAll('.profile-section-card'));
            const card = cards.find(element => element.textContent && element.textContent.includes(text));
            if (!card) throw new Error(`Profile card not found for text: ${text}`);
            return card;
        };

        const nodes = {
            welcome: document.getElementById('user-profile-name').closest('.profile-section-card'),
            premium: document.getElementById('profile-premium-card'),
            achievement: cardContaining('Achievement Vault'),
            virtual: document.getElementById('virtual-basecamp-module'),
            dossier: cardContaining('Classified'),
            leaderboard: document.getElementById('leaderboard-container'),
            data: cardContaining('My Data & Routes'),
            account: document.getElementById('account-status-card'),
            accountSignout: document.getElementById('account-signout-btn'),
            admin: document.getElementById('admin-controls-container'),
            missingLocation: document.getElementById('add-location-portal'),
            feedback: document.getElementById('feedback-portal')
        };

        Object.entries(nodes).forEach(([key, node]) => {
            if (!node) throw new Error(`Profile order node missing: ${key}`);
        });

        const before = (left, right) => Boolean(
            nodes[left].compareDocumentPosition(nodes[right]) & Node.DOCUMENT_POSITION_FOLLOWING
        );

        return {
            welcomeBeforePremium: before('welcome', 'premium'),
            premiumBeforeAchievement: before('premium', 'achievement'),
            achievementBeforeVirtual: before('achievement', 'virtual'),
            virtualBeforeDossier: before('virtual', 'dossier'),
            dossierBeforeLeaderboard: before('dossier', 'leaderboard'),
            leaderboardBeforeData: before('leaderboard', 'data'),
            dataBeforeAccount: before('data', 'account'),
            accountContainsSignout: nodes.account.contains(nodes.accountSignout),
            accountBeforeAdmin: before('account', 'admin'),
            adminBeforeMissingLocation: before('admin', 'missingLocation'),
            missingLocationBeforeFeedback: before('missingLocation', 'feedback')
        };
    });
}

test.describe('account auth UI smoke', () => {
    test('signed-out users see Google, email sign-in, create, and reset options', async ({ page }) => {
        await openApp(page);
        await page.evaluate(() => window.firebase.auth().signOut());
        await page.waitForFunction(() => !window.firebase.auth().currentUser, { timeout: 30000 });
        await openProfile(page);
        await expect(page.locator('#login-container')).toBeVisible();
        await expect(page.locator('#google-login-btn')).toBeVisible();
        await expect(page.locator('#account-signin-form')).toBeVisible();
        await expect(page.locator('#account-signin-email')).toBeVisible();
        await expect(page.locator('#account-signin-password')).toBeVisible();

        await page.locator('#account-mode-create').click();
        await expect(page.locator('#account-create-form')).toBeVisible();
        await expect(page.locator('#account-create-password')).toHaveAttribute('minlength', '8');

        await page.locator('#account-mode-reset').click();
        await expect(page.locator('#account-reset-form')).toBeVisible();
        await expect(page.locator('#account-reset-email')).toBeVisible();
    });

    test('switch account forces Google account chooser on the next popup only', async ({ page }) => {
        await openApp(page);
        await page.waitForFunction(() => {
            return Boolean(
                window.BARK &&
                window.BARK.services &&
                window.BARK.services.auth &&
                typeof window.BARK.services.auth.requestGoogleAccountChooser === 'function' &&
                typeof window.BARK.services.auth.createGoogleProvider === 'function'
            );
        }, { timeout: 30000 });

        const result = await page.evaluate(async () => {
            const auth = firebase.auth();
            const originalGoogleProvider = firebase.auth.GoogleAuthProvider;
            const originalSignInWithPopup = auth.signInWithPopup;
            const originalSignOut = auth.signOut;
            const popupPrompts = [];

            function FakeGoogleProvider() {
                this.customParameters = null;
            }

            FakeGoogleProvider.prototype.setCustomParameters = function setCustomParameters(params) {
                this.customParameters = params ? { ...params } : params;
            };

            firebase.auth.GoogleAuthProvider = FakeGoogleProvider;
            auth.signInWithPopup = async (provider) => {
                popupPrompts.push(provider && provider.customParameters ? { ...provider.customParameters } : null);
                return { user: auth.currentUser || null };
            };
            auth.signOut = async () => {};

            async function clickGoogleAndReadPrompt() {
                const expectedLength = popupPrompts.length + 1;
                document.getElementById('google-login-btn').click();

                const startedAt = Date.now();
                while (popupPrompts.length < expectedLength && Date.now() - startedAt < 1000) {
                    await new Promise(resolve => setTimeout(resolve, 10));
                }

                if (popupPrompts.length < expectedLength) {
                    throw new Error('Expected Google sign-in popup to be requested.');
                }
                return popupPrompts[popupPrompts.length - 1];
            }

            try {
                const normalPrompt = await clickGoogleAndReadPrompt();
                await window.BARK.authAccountUi.signOut({ switchAccount: true });
                const chooserFlagAfterSwitch = window.BARK.auth && window.BARK.auth.forceGoogleAccountChooserOnNextSignIn;
                const forcedPrompt = await clickGoogleAndReadPrompt();
                const chooserFlagAfterForcedPopup = window.BARK.auth && window.BARK.auth.forceGoogleAccountChooserOnNextSignIn;
                const consumedPrompt = await clickGoogleAndReadPrompt();

                return {
                    normalPrompt,
                    chooserFlagAfterSwitch,
                    forcedPrompt,
                    chooserFlagAfterForcedPopup,
                    consumedPrompt,
                    popupPrompts
                };
            } finally {
                firebase.auth.GoogleAuthProvider = originalGoogleProvider;
                auth.signInWithPopup = originalSignInWithPopup;
                auth.signOut = originalSignOut;
            }
        });

        expect(result.normalPrompt).toBeNull();
        expect(result.chooserFlagAfterSwitch).toBe(true);
        expect(result.forcedPrompt).toEqual({ prompt: 'select_account' });
        expect(result.chooserFlagAfterForcedPopup).toBe(false);
        expect(result.consumedPrompt).toBeNull();
        expect(result.popupPrompts).toEqual([
            null,
            { prompt: 'select_account' },
            null
        ]);
    });

    test('profile card DOM puts account controls below profile value cards', async ({ page }) => {
        const errors = [];
        page.on('console', message => {
            if (message.type() === 'error') errors.push(message.text());
        });
        page.on('pageerror', error => {
            errors.push(error && error.message ? error.message : String(error));
        });

        await openApp(page);
        await openProfile(page);

        await expect(getProfileCardOrder(page)).resolves.toEqual({
            welcomeBeforePremium: true,
            premiumBeforeAchievement: true,
            achievementBeforeVirtual: true,
            virtualBeforeDossier: true,
            dossierBeforeLeaderboard: true,
            leaderboardBeforeData: true,
            dataBeforeAccount: true,
            accountContainsSignout: true,
            accountBeforeAdmin: true,
            adminBeforeMissingLocation: true,
            missingLocationBeforeFeedback: true
        });
        expect(errors).toEqual([]);
    });

    test('signed-in users can sign out from the account card', async ({ browser }) => {
        test.skip(!storageStateExists, [
            `BARK_E2E_STORAGE_STATE points to a missing file: ${storageStatePath || '(unset)'}`,
            `Generate it with BARK_E2E_STORAGE_STATE="$PWD/${DEFAULT_STORAGE_STATE}" npm run e2e:auth:save`
        ].join('\n'));

        const context = await newBarkContext(browser, { storageState: storageStatePath });
        const page = await context.newPage();
        try {
            await openApp(page);
            await page.waitForFunction(() => window.firebase.auth().currentUser, { timeout: 30000 });
            await openProfile(page);
            await expect(page.locator('#account-status-card')).toBeVisible();
            await expect(page.locator('#account-display-uid')).not.toHaveText('Loading');
            await expect(getProfileCardOrder(page)).resolves.toMatchObject({
                welcomeBeforePremium: true,
                premiumBeforeAchievement: true,
                dataBeforeAccount: true,
                accountContainsSignout: true,
                missingLocationBeforeFeedback: true
            });
            await expect(page.locator('#account-signout-btn')).toBeVisible();

            await page.locator('#account-signout-btn').click();
            await page.waitForFunction(() => !window.firebase.auth().currentUser, { timeout: 30000 });
            await expect(page.locator('#account-status-card')).toBeHidden();
            await expect(page.locator('#login-container')).toBeVisible();
        } finally {
            await context.close();
        }
    });
});
