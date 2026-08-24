const { test, expect } = require('@playwright/test');
const { expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

test.describe('pre-launch App Check and rate-limit warning', () => {
    test('initializes App Check before use and keeps the warning usable on a short phone', async ({ page }) => {
        await page.setViewportSize({ width: 568, height: 320 });
        let dialogs = 0;
        page.on('dialog', async dialog => {
            dialogs += 1;
            await dialog.dismiss();
        });

        await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}prelaunchSmoke=${Date.now()}`);
        await expectBarkAppIdentity(page, expect);
        await page.waitForFunction(() => window.BARK && window.BARK.appCheckStatus);
        await expect.poll(() => page.evaluate(() => window.BARK.appCheckStatus.active)).toBe(true);
        expect(await page.evaluate(() => window.BARK.appCheckStatus.mode)).toBe(
            BASE_URL.includes('localhost') ? 'debug' : 'recaptcha-enterprise'
        );

        await page.evaluate(() => window.BARK.rateLimitUi.showRateLimitWarning({
            code: 'functions/resource-exhausted',
            details: {
                action: 'getPremiumRoute',
                scope: 'user',
                retryAt: new Date(Date.now() + 60_000).toISOString()
            }
        }));

        const panel = page.locator('#rate-limit-warning');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('Are you a bot?');
        const box = await panel.boundingBox();
        expect(box).not.toBeNull();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(568);
        expect(box.y + box.height).toBeLessThanOrEqual(320);
        expect(dialogs).toBe(0);

        await panel.locator('.rate-limit-warning__close').click();
        await expect(panel).toBeHidden();
    });
});
