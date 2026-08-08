const { test, expect } = require('@playwright/test');
const { newBarkContext } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const RECOVERY_CLASS = 'bark-risky-android-desktop-phone-recovery';

async function pretendInstalledStandalone(page) {
    await page.addInitScript(() => {
        const nativeMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = (query) => {
            const result = nativeMatchMedia(query);
            if (query !== '(display-mode: standalone)') return result;
            return new Proxy(result, {
                get(target, property) {
                    if (property === 'matches') return true;
                    const value = Reflect.get(target, property, target);
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            });
        };
    });
}

test.describe('RISKY Android desktop viewport recovery', () => {
    test('leaves an ordinary installed mobile viewport unchanged', async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: 390, height: 844 },
            screen: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();
        await pretendInstalledStandalone(page);

        await page.goto(`${BASE_URL}?riskyViewportNormalMobile=${Date.now()}`, {
            waitUntil: 'domcontentloaded'
        });

        await expect(page.locator('html')).not.toHaveClass(new RegExp(RECOVERY_CLASS));
        const state = await page.evaluate(() => ({
            zoom: Number.parseFloat(getComputedStyle(document.body).zoom) || 1,
            viewportWidth: window.innerWidth,
            bodyWidth: document.body.getBoundingClientRect().width
        }));
        expect(state.zoom).toBe(1);
        expect(state.viewportWidth).toBe(390);
        expect(state.bodyWidth).toBeCloseTo(390, 0);

        await context.close();
    });

    test('counter-scales the Galaxy-like standalone 980px viewport into phone layout', async ({ browser }) => {
        // isMobile intentionally stays false here: that makes Chromium honor the
        // 980px test viewport just as Request Desktop Site does. screen.width and
        // touch still describe the underlying phone.
        const context = await newBarkContext(browser, {
            viewport: { width: 980, height: 2100 },
            screen: { width: 412, height: 915 },
            hasTouch: true
        });
        const page = await context.newPage();
        await pretendInstalledStandalone(page);

        await page.goto(`${BASE_URL}?riskyViewportGalaxy=${Date.now()}`, {
            waitUntil: 'domcontentloaded'
        });
        await expect(page.locator('html')).toHaveClass(new RegExp(RECOVERY_CLASS));

        await page.evaluate(() => {
            document.getElementById('profile-view').classList.add('active');
            document.getElementById('settings-overlay').classList.add('active');
        });

        const state = await page.evaluate(() => {
            const rect = (selector) => {
                const box = document.querySelector(selector).getBoundingClientRect();
                return { left: box.left, right: box.right, width: box.width, bottom: box.bottom };
            };
            return {
                zoom: Number.parseFloat(getComputedStyle(document.body).zoom),
                logicalWidth: getComputedStyle(document.documentElement)
                    .getPropertyValue('--bark-risky-phone-width').trim(),
                body: rect('body'),
                profile: rect('#profile-view .view-content'),
                settings: rect('#settings-modal'),
                nav: rect('.glass-nav'),
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight
            };
        });

        expect(state.logicalWidth).toBe('412px');
        expect(state.zoom).toBeCloseTo(980 / 412, 2);
        expect(state.body.width).toBeCloseTo(state.viewportWidth, 0);
        expect(state.profile.width).toBeGreaterThan(state.viewportWidth * 0.85);
        expect(state.settings.width).toBeGreaterThan(state.viewportWidth * 0.8);
        expect(state.settings.bottom).toBeLessThanOrEqual(state.viewportHeight + 1);
        expect(state.nav.width).toBeCloseTo(state.viewportWidth, 0);

        await context.close();
    });
});
