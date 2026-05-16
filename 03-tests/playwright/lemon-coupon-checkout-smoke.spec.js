const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const CHECKOUT_URL = 'https://usbarkrangers.lemonsqueezy.com/checkout/test-session';

async function openApp(page) {
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean(
        window.BARK &&
        window.BARK.paywall &&
        window.BARK.services &&
        window.BARK.services.premium &&
        document.getElementById('profile-premium-card')
    ), { timeout: 30000 });
}

async function installCheckoutHarness(page, options = {}) {
    await page.evaluate(({ user }) => {
        const authState = { currentUser: user || null };
        window.__checkoutCalls = [];
        window.__unexpectedCallableNames = [];

        if (!window.firebase) window.firebase = {};
        window.firebase.apps = window.firebase.apps && window.firebase.apps.length ? window.firebase.apps : [{}];
        window.firebase.auth = () => ({
            get currentUser() {
                return authState.currentUser;
            },
            onAuthStateChanged(callback) {
                callback(authState.currentUser);
                return () => {};
            }
        });
        window.firebase.functions = () => ({
            httpsCallable(name) {
                return async (payload) => {
                    if (name !== 'createCheckoutSession') {
                        window.__unexpectedCallableNames.push(name);
                        throw new Error(`Unexpected callable ${name}`);
                    }
                    window.__checkoutCalls.push({ name, payload });
                    return {
                        data: {
                            checkoutUrl: `https://usbarkrangers.lemonsqueezy.com/checkout/test-session?payload=${encodeURIComponent(JSON.stringify(payload || {}))}`
                        }
                    };
                };
            }
        });
    }, options);
}

test.describe('Lemon-only coupon checkout flow', () => {
    test('Premium modal does not show app-side discount or access-code fields', async ({ page }) => {
        await openApp(page);
        await installCheckoutHarness(page, {
            user: {
                uid: 'coupon-field-user',
                email: 'coupon-field@example.test',
                emailVerified: true,
                providerData: [{ providerId: 'password' }]
            }
        });

        await page.evaluate(() => window.BARK.paywall.openPaywall({ source: 'manual-upgrade-check' }));

        await expect(page.locator('#paywall-overlay')).toHaveClass(/active/);
        await expect(page.locator('#paywall-discount-code-input')).toHaveCount(0);
        await expect(page.locator('#paywall-promo-code-input')).toHaveCount(0);
        await expect(page.locator('#paywall-promo-code-btn')).toHaveCount(0);
        await expect(page.locator('input[id*="coupon"], input[id*="promo"], input[id*="beta"], input[id*="access"], input[id*="discount"]')).toHaveCount(0);
        await expect(page.locator('.paywall-support-copy')).toContainText('Payment and coupon codes are handled securely by Lemon Squeezy');
    });

    test('signed-out upgrade path prompts sign-in before checkout', async ({ page }) => {
        await openApp(page);
        await installCheckoutHarness(page, { user: null });

        await page.evaluate(() => window.BARK.paywall.openPaywall({ source: 'profile-premium-card' }));
        await expect(page.locator('#paywall-primary-btn')).toContainText('Sign in to upgrade');
        await page.locator('#paywall-primary-btn').click();

        await expect(page.locator('#login-container')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__checkoutCalls.length)).toBe(0);
        await expect.poll(() => page.evaluate(() => window.__unexpectedCallableNames.length)).toBe(0);
    });

    test('signed-in user goes straight to Lemon checkout without app-side discount payload', async ({ page }) => {
        await page.route('https://usbarkrangers.lemonsqueezy.com/**', route => route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><title>Lemon Checkout</title><h1>Lemon Checkout</h1>'
        }));
        await openApp(page);
        await installCheckoutHarness(page, {
            user: {
                uid: 'coupon-checkout-user',
                email: 'coupon-checkout@example.test',
                emailVerified: true,
                providerData: [{ providerId: 'password' }]
            }
        });

        await page.evaluate(() => window.BARK.paywall.openPaywall({ source: 'profile-premium-card' }));
        await page.locator('#paywall-primary-btn').click();

        await page.waitForURL(`${CHECKOUT_URL}?payload=%7B%7D`, { timeout: 10000 });
    });

    test('unverified email/password user is blocked before Lemon checkout', async ({ page }) => {
        await openApp(page);
        await installCheckoutHarness(page, {
            user: {
                uid: 'unverified-checkout-user',
                email: 'unverified-checkout@example.test',
                emailVerified: false,
                providerData: [{ providerId: 'password' }]
            }
        });

        await page.evaluate(() => window.BARK.paywall.openPaywall({ source: 'profile-premium-card' }));
        await page.locator('#paywall-primary-btn').click();

        await expect(page.locator('#paywall-body')).toContainText('Please verify your email');
        await expect.poll(() => page.evaluate(() => window.__checkoutCalls.length)).toBe(0);
        await expect.poll(() => page.evaluate(() => window.__unexpectedCallableNames.length)).toBe(0);
    });

});
