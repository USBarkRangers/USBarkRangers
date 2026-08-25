const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

test('renewal date appears in lower account billing but not the profile premium card', async ({ browser }) => {
    const context = await newBarkContext(browser, {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
    });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}profileRenewalCopy=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.BARK &&
        window.BARK.paywall &&
        window.BARK.authAccountUi &&
        window.BARK.services &&
        window.BARK.services.premium
    ), { timeout: 30000 });

    await page.evaluate(() => {
        const entitlement = {
            premium: true,
            status: 'active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_copy_test',
            providerSubscriptionId: 'sub_copy_test',
            currentPeriodEnd: '2027-08-01T12:00:00.000Z'
        };
        const premiumService = window.BARK.services.premium;
        premiumService.isPremium = () => true;
        premiumService.getEntitlement = () => entitlement;
        window.firebase = {
            auth: () => ({
                currentUser: {
                    uid: 'paid-copy-test',
                    email: 'paid@example.com',
                    emailVerified: true,
                    displayName: 'Paid Ranger',
                    providerData: [{ providerId: 'google.com' }]
                }
            })
        };

        window.BARK.paywall.renderCurrentState();
        window.BARK.authAccountUi.refreshAccountDisplay();
    });

    await expect(page.locator('#profile-premium-card')).toHaveAttribute('data-paywall-state', 'premium');
    await expect(page.locator('#profile-premium-copy')).toHaveText('Premium is active on this account.');
    await expect(page.locator('#profile-premium-copy')).not.toContainText(/renew|2027/i);
    await expect(page.locator('#account-billing-copy')).toContainText('Auto-renews August 1, 2027');

    await context.close();
});
