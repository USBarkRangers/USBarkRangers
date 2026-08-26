const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const IPHONE_17_SCREEN = { width: 402, height: 874 };
const IPHONE_17_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

test('iPhone 17 standalone portrait keeps the nav and an opened park card on-screen', async ({ browser }) => {
    const context = await newBarkContext(browser, {
        viewport: { width: 402, height: 681 },
        screen: IPHONE_17_SCREEN,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: IPHONE_17_USER_AGENT
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', {
            configurable: true,
            get: () => true
        });
    });

    const page = await context.newPage();
    try {
        await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}iphone17Shell=${Date.now()}`);
        await expectBarkAppIdentity(page, expect);
        await page.waitForFunction(() => Boolean(
            window.BARK
            && window.BARK.markerManager
            && !document.getElementById('bark-loader')
            && document.querySelector('.custom-bark-marker')
        ), undefined, { timeout: 30000 });

        const shell = await page.evaluate(() => {
            const nav = document.getElementById('main-nav');
            const navRect = nav.getBoundingClientRect();
            return {
                innerHeight: window.innerHeight,
                screenHeight: window.screen.height,
                shellHeight: parseFloat(getComputedStyle(document.documentElement)
                    .getPropertyValue('--bark-ios-app-height')),
                navTop: navRect.top,
                navBottom: navRect.bottom,
                navHeight: navRect.height,
                navVisiblePixels: Math.max(
                    0,
                    Math.min(navRect.bottom, window.innerHeight) - Math.max(navRect.top, 0)
                ),
                standaloneClass: document.documentElement.classList
                    .contains('bark-ios-standalone-fullscreen')
            };
        });

        expect(shell.screenHeight).toBe(874);
        expect(shell.innerHeight).toBe(681);
        expect(shell.standaloneClass).toBe(true);
        expect(shell.shellHeight).toBeLessThanOrEqual(shell.innerHeight);
        expect(shell.navTop).toBeGreaterThanOrEqual(0);
        expect(shell.navBottom).toBeLessThanOrEqual(shell.innerHeight + 0.5);
        expect(shell.navVisiblePixels).toBeGreaterThanOrEqual(shell.navHeight - 0.5);

        const markers = await page.locator('.custom-bark-marker').all();
        let clickedPin = false;
        for (const marker of markers) {
            const box = await marker.boundingBox();
            if (!box) continue;
            const centerX = box.x + box.width / 2;
            const centerY = box.y + box.height / 2;
            if (centerX < 0 || centerX > 402 || centerY < 150 || centerY > 640) continue;
            await marker.click({ force: true });
            if (await page.locator('#slide-panel.open').count()) {
                clickedPin = true;
                break;
            }
        }

        expect(clickedPin).toBe(true);
        await expect(page.locator('#slide-panel')).toHaveClass(/\bopen\b/);
        await page.waitForFunction(() => {
            const nav = document.getElementById('main-nav');
            const panel = document.getElementById('slide-panel');
            if (!nav || !panel || !panel.classList.contains('open')) return false;
            return panel.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top + 0.5;
        }, undefined, { timeout: 2000 });

        const opened = await page.evaluate(() => {
            const navRect = document.getElementById('main-nav').getBoundingClientRect();
            const panelRect = document.getElementById('slide-panel').getBoundingClientRect();
            return {
                navTop: navRect.top,
                navBottom: navRect.bottom,
                panelTop: panelRect.top,
                panelBottom: panelRect.bottom,
                viewportHeight: window.innerHeight
            };
        });

        expect(opened.panelTop).toBeGreaterThanOrEqual(0);
        expect(opened.panelBottom).toBeLessThanOrEqual(opened.navTop + 0.5);
        expect(opened.navBottom).toBeLessThanOrEqual(opened.viewportHeight + 0.5);
    } finally {
        await context.close();
    }
});

test('iPhone 17 standalone landscape keeps the already-working nav on-screen', async ({ browser }) => {
    const context = await newBarkContext(browser, {
        viewport: { width: 756, height: 351 },
        screen: IPHONE_17_SCREEN,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: IPHONE_17_USER_AGENT
    });

    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', {
            configurable: true,
            get: () => true
        });
    });

    const page = await context.newPage();
    try {
        await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}iphone17Landscape=${Date.now()}`);
        await expectBarkAppIdentity(page, expect);
        await page.waitForFunction(() => !document.getElementById('bark-loader'), undefined, { timeout: 30000 });

        const geometry = await page.evaluate(() => {
            const navRect = document.getElementById('main-nav').getBoundingClientRect();
            return {
                innerHeight: window.innerHeight,
                shellHeight: parseFloat(getComputedStyle(document.documentElement)
                    .getPropertyValue('--bark-ios-app-height')),
                navTop: navRect.top,
                navBottom: navRect.bottom,
                navHeight: navRect.height,
                navVisiblePixels: Math.max(
                    0,
                    Math.min(navRect.bottom, window.innerHeight) - Math.max(navRect.top, 0)
                )
            };
        });

        expect(geometry.shellHeight).toBeLessThanOrEqual(geometry.innerHeight);
        expect(geometry.navTop).toBeGreaterThanOrEqual(0);
        expect(geometry.navBottom).toBeLessThanOrEqual(geometry.innerHeight + 0.5);
        expect(geometry.navVisiblePixels).toBeGreaterThanOrEqual(geometry.navHeight - 0.5);
    } finally {
        await context.close();
    }
});
