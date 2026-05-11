const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

async function openLoadedApp(page) {
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}fixedUiScrollGuardSmoke=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.map &&
        window.BARK &&
        document.querySelector('.glass-nav') &&
        document.getElementById('filter-panel') &&
        document.getElementById('profile-view') &&
        window.BARK.repos &&
        window.BARK.repos.ParkRepo &&
        typeof window.BARK.repos.ParkRepo.getAll === 'function' &&
        window.BARK.repos.ParkRepo.getAll().length > 50
    ), { timeout: 30000 });
}

async function wheelOverLocator(page, locator, deltaY) {
    const box = await locator.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, deltaY);
}

test.describe('BUG-AUDIT-028 fixed UI scroll guards', () => {
    test('bottom nav and map filter panel do not leak scroll gestures', async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();

        await openLoadedApp(page);

        const syntheticGuardState = await page.evaluate(() => {
            const nav = document.querySelector('.glass-nav');
            const filter = document.getElementById('filter-panel');
            const dispatchWheel = (el) => {
                const event = new WheelEvent('wheel', {
                    bubbles: true,
                    cancelable: true,
                    deltaY: 320
                });
                el.dispatchEvent(event);
                return event.defaultPrevented;
            };
            return {
                navPrevented: dispatchWheel(nav),
                filterPrevented: dispatchWheel(filter)
            };
        });

        expect(syntheticGuardState.navPrevented).toBe(true);
        expect(syntheticGuardState.filterPrevented).toBe(true);

        await page.evaluate(() => window.map.setZoom(7, { animate: false }));
        const filterZoomBefore = await page.evaluate(() => window.map.getZoom());
        await wheelOverLocator(page, page.locator('#filter-panel'), -900);
        await page.waitForTimeout(250);
        const filterZoomAfter = await page.evaluate(() => window.map.getZoom());
        expect(filterZoomAfter).toBe(filterZoomBefore);

        await page.locator('.nav-item[data-target="profile-view"]').click();
        await expect(page.locator('#profile-view')).toHaveClass(/active/);

        const scrollSetup = await page.evaluate(() => {
            const profile = document.getElementById('profile-view');
            const maxScroll = Math.max(0, profile.scrollHeight - profile.clientHeight);
            profile.scrollTop = Math.min(260, maxScroll);
            return {
                scrollTop: profile.scrollTop,
                maxScroll
            };
        });
        expect(scrollSetup.maxScroll).toBeGreaterThan(0);

        await wheelOverLocator(page, page.locator('.glass-nav'), 900);
        await page.waitForTimeout(250);

        const profileScrollAfter = await page.evaluate(() => document.getElementById('profile-view').scrollTop);
        expect(profileScrollAfter).toBe(scrollSetup.scrollTop);

        await context.close();
    });
});
