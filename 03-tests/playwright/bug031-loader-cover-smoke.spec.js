const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

for (const viewport of [
    { name: 'portrait phone', width: 390, height: 844 },
    { name: 'short landscape phone', width: 740, height: 360 }
]) {
    test(`loader keeps the bottom navigation covered while content fades on a ${viewport.name}`, async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: viewport.width, height: viewport.height },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();

        await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}loaderCoverSmoke=${Date.now()}`);
        await expectBarkAppIdentity(page, expect);
        await page.waitForFunction(() => Boolean(
            window.dismissBarkLoader &&
            document.getElementById('main-nav') &&
            !document.getElementById('bark-loader')
        ), { timeout: 30000 });

        await page.evaluate(() => {
            const loader = document.createElement('div');
            loader.id = 'bark-loader';
            loader.innerHTML = '<div class="dog-spinner">🐾</div><p>US BARK Rangers Loading...</p>';
            document.body.prepend(loader);
            window.dismissBarkLoader();
        });

        const duringFade = await page.evaluate(() => {
            const loader = document.getElementById('bark-loader');
            const rect = loader.getBoundingClientRect();
            const bottomHit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 2);
            return {
                className: loader.className,
                opacity: getComputedStyle(loader).opacity,
                top: rect.top,
                bottom: rect.bottom,
                viewportHeight: window.innerHeight,
                coversBottomHit: bottomHit === loader || loader.contains(bottomHit)
            };
        });

        expect(duringFade.className).toContain('is-dismissing');
        expect(duringFade.opacity).toBe('1');
        expect(duringFade.top).toBeLessThanOrEqual(0);
        expect(duringFade.bottom).toBeGreaterThanOrEqual(duringFade.viewportHeight - 1);
        expect(duringFade.coversBottomHit).toBe(true);

        await expect(page.locator('#bark-loader')).toHaveCount(0, { timeout: 1500 });
        await expect(page.locator('#main-nav')).toBeVisible();

        await context.close();
    });
}
