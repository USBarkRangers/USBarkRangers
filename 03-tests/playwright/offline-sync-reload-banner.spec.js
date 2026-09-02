const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

test('offline sync banner reloads safely, clears on recovery, and stays tappable during a walk', async ({ browser }) => {
    const context = await newBarkContext(browser, {
        viewport: { width: 320, height: 568 }
    });
    const page = await context.newPage();
    const journalKey = 'bark.unconfirmedVisits.banner-test-user';
    const journalValue = JSON.stringify({
        park: {
            visit: { id: 'park', syncToken: 'banner-test-token' },
            offlinePremiumProvisional: false
        }
    });

    try {
        await page.goto(BASE_URL);
        await page.waitForFunction(() => Boolean(window.BARK && window.BARK.showOfflineRecoveryNotice));
        await page.evaluate(({ journalKey, journalValue }) => {
            localStorage.setItem(journalKey, journalValue);
            window.BARK.showOfflineRecoveryNotice();
        }, { journalKey, journalValue });

        const banner = page.locator('#auth-failure-message');
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('You appear offline');
        await expect(banner).toContainText('Saved visits will keep retrying');

        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
            page.getByRole('button', { name: 'Reload', exact: true }).click()
        ]);
        await page.waitForFunction(() => Boolean(window.BARK && window.BARK.showOfflineRecoveryNotice));
        expect(await page.evaluate((key) => localStorage.getItem(key), journalKey)).toBe(journalValue);

        await page.evaluate(() => window.BARK.showOfflineRecoveryNotice());
        await expect(banner).toBeVisible();
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await expect(banner).toBeHidden();

        await page.evaluate(() => {
            const liveWalk = document.createElement('div');
            liveWalk.id = 'live-walk-banner';
            liveWalk.className = 'live-walk-banner';
            liveWalk.style.display = 'flex';
            liveWalk.innerHTML = '<button type="button" class="live-walk-banner__distance">🟢 <strong>1.25 mi</strong></button>'
                + '<button type="button" class="live-walk-banner__map">🗺️</button>';
            document.body.appendChild(liveWalk);
            window.BARK.showOfflineRecoveryNotice();
        });
        await expect(banner).toBeVisible();
        const noticeBox = await banner.boundingBox();
        const walkBox = await page.locator('#live-walk-banner').boundingBox();
        expect(noticeBox.y).toBeGreaterThanOrEqual(walkBox.y + walkBox.height);

        await page.getByRole('button', { name: 'Dismiss offline warning' }).click();
        await expect(banner).toBeHidden();
        expect(await page.evaluate((key) => localStorage.getItem(key), journalKey)).toBe(journalValue);

        await page.evaluate(() => window.BARK.showOfflineRecoveryNotice());
        await expect(banner).toBeHidden();
        await page.evaluate(() => window.BARK.showAuthFailure('Account sync failed.'));
        await expect(banner).toBeVisible();
        await expect(banner).toContainText('Sign-in unavailable');
        await expect(banner).toContainText('Account sync failed.');
    } finally {
        await context.close();
    }
});
