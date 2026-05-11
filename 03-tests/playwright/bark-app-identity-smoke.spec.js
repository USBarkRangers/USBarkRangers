const { test, expect } = require('@playwright/test');
const { expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

test.describe('BARK app identity and cache safety', () => {
    test('loads the BARK app, not a stale copied prototype from localhost cache', async ({ page }) => {
        await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}identitySmoke=${Date.now()}`);
        await expectBarkAppIdentity(page, expect);
    });
});
