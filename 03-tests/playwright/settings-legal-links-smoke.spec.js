const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

const PHONE_VIEWPORTS = [
    { label: 'small portrait', width: 320, height: 568 },
    { label: 'short landscape', width: 568, height: 320 }
];

for (const viewport of PHONE_VIEWPORTS) {
    test(`Settings legal links clear the bottom edge on ${viewport.label}`, async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: viewport.width, height: viewport.height },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();

        try {
            await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}settingsLegal=${Date.now()}`);
            await expectBarkAppIdentity(page, expect);
            await page.waitForFunction(() => Boolean(
                window.BARK
                && window.BARK.markerManager
                && document.getElementById('settings-gear-btn')
            ), { timeout: 30000 });

            await page.locator('.nav-item[data-target="profile-view"]').click();
            await page.locator('#settings-gear-btn').click();
            await expect(page.locator('#settings-overlay')).toHaveClass(/\bactive\b/);

            await page.locator('#settings-modal .modal-body').evaluate(element => {
                element.scrollTop = element.scrollHeight;
            });

            const geometry = await page.evaluate(() => {
                const modal = document.getElementById('settings-modal');
                const body = modal.querySelector('.modal-body');
                const legal = modal.querySelector('.settings-legal-links');
                const terms = legal.querySelector('a[href*="terms.html"]');
                const privacy = legal.querySelector('a[href*="privacy.html"]');
                const modalRect = modal.getBoundingClientRect();
                const bodyRect = body.getBoundingClientRect();
                const legalRect = legal.getBoundingClientRect();
                const bodyStyle = getComputedStyle(body);

                return {
                    viewportWidth: window.innerWidth,
                    viewportHeight: window.innerHeight,
                    modalLeft: modalRect.left,
                    modalRight: modalRect.right,
                    modalTop: modalRect.top,
                    modalBottom: modalRect.bottom,
                    legalTop: legalRect.top,
                    legalBottom: legalRect.bottom,
                    bodyTop: bodyRect.top,
                    bodyBottom: bodyRect.bottom,
                    legalBottomGap: bodyRect.bottom - legalRect.bottom,
                    bottomPadding: parseFloat(bodyStyle.paddingBottom) || 0,
                    termsText: terms && terms.textContent.trim(),
                    privacyText: privacy && privacy.textContent.trim()
                };
            });

            expect(geometry.modalLeft).toBeGreaterThanOrEqual(0);
            expect(geometry.modalRight).toBeLessThanOrEqual(geometry.viewportWidth);
            expect(geometry.modalTop).toBeGreaterThanOrEqual(0);
            expect(geometry.modalBottom).toBeLessThanOrEqual(geometry.viewportHeight);
            expect(geometry.legalTop).toBeGreaterThanOrEqual(geometry.bodyTop);
            expect(geometry.legalBottom).toBeLessThanOrEqual(geometry.bodyBottom);
            expect(geometry.bottomPadding).toBeGreaterThanOrEqual(20);
            expect(geometry.legalBottomGap).toBeGreaterThanOrEqual(15);
            expect(geometry.termsText).toBe('Terms of Use');
            expect(geometry.privacyText).toBe('Privacy Policy');
        } finally {
            await context.close();
        }
    });
}
