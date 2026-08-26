const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';
const IPHONE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';

async function waitForShell(page) {
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.BARK
        && window.BARK.viewportCoordinator
        && !document.getElementById('bark-loader')
        && document.getElementById('main-nav')
    ), undefined, { timeout: 30000 });
}

test('a normal full-height iPhone keeps its original full-screen geometry', async ({ browser }) => {
    const context = await newBarkContext(browser, {
        viewport: { width: 430, height: 932 },
        screen: { width: 430, height: 932 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: IPHONE_USER_AGENT
    });
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
    });

    const page = await context.newPage();
    await page.goto(`${BASE_URL}?fullHeightIPhone=${Date.now()}`);
    await waitForShell(page);
    await page.waitForTimeout(500);

    const geometry = await page.evaluate(() => {
        const mapRect = document.getElementById('map').getBoundingClientRect();
        const bodyRect = document.body.getBoundingClientRect();
        const navRect = document.getElementById('main-nav').getBoundingClientRect();
        const lift = parseFloat(getComputedStyle(document.documentElement)
            .getPropertyValue('--bark-viewport-bottom-lift')) || 0;
        return { mapRect, bodyRect, navRect, lift, innerHeight: window.innerHeight };
    });

    expect(geometry.lift).toBe(0);
    expect(geometry.mapRect.bottom).toBeGreaterThanOrEqual(geometry.innerHeight - 1);
    expect(geometry.bodyRect.bottom).toBeGreaterThanOrEqual(geometry.innerHeight - 1);
    expect(geometry.navRect.bottom).toBeGreaterThanOrEqual(geometry.innerHeight - 1);
    await context.close();
});

test('a persistently shorter visual viewport lifts only bottom UI', async ({ browser }) => {
    const context = await newBarkContext(browser, {
        viewport: { width: 402, height: 874 },
        screen: { width: 402, height: 874 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: IPHONE_USER_AGENT
    });
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
        const viewport = new EventTarget();
        Object.defineProperties(viewport, {
            width: { configurable: true, get: () => 402 },
            height: { configurable: true, get: () => 681 },
            offsetTop: { configurable: true, get: () => 0 },
            offsetLeft: { configurable: true, get: () => 0 },
            scale: { configurable: true, get: () => 1 }
        });
        Object.defineProperty(window, 'visualViewport', {
            configurable: true,
            get: () => viewport
        });
    });

    const page = await context.newPage();
    await page.goto(`${BASE_URL}?obstructedIPhone=${Date.now()}`);
    await waitForShell(page);
    await page.waitForFunction(() => Number(document.documentElement.dataset.barkViewportLift) > 0);

    const geometry = await page.evaluate(() => {
        const mapRect = document.getElementById('map').getBoundingClientRect();
        const navRect = document.getElementById('main-nav').getBoundingClientRect();
        const contentRects = Array.from(document.querySelectorAll('#main-nav .nav-item svg, #main-nav .nav-item > span'))
            .filter(element => element.id !== 'planner-badge' || element.offsetParent !== null)
            .map(element => element.getBoundingClientRect());
        return {
            lift: Number(document.documentElement.dataset.barkViewportLift),
            mapBottom: mapRect.bottom,
            navBottom: navRect.bottom,
            contentBottom: Math.max(...contentRects.map(rect => rect.bottom)),
            visualBottom: visualViewport.offsetTop + visualViewport.height,
            innerHeight: window.innerHeight
        };
    });

    expect(geometry.lift).toBeGreaterThan(0);
    expect(geometry.mapBottom).toBeGreaterThanOrEqual(geometry.innerHeight - 1);
    expect(geometry.navBottom).toBeGreaterThanOrEqual(geometry.innerHeight - 1);
    expect(geometry.contentBottom).toBeLessThanOrEqual(geometry.visualBottom + 0.5);

    await page.evaluate(() => {
        const marker = Array.from(window.BARK.markerManager.markers.values())
            .find(candidate => candidate && candidate._parkData);
        window.BARK.markerManager.renderMarkerPanel(marker);
    });
    await expect(page.locator('#slide-panel')).toHaveClass(/\bopen\b/);
    await page.waitForFunction(() => {
        const panel = document.getElementById('slide-panel');
        const nav = document.getElementById('main-nav');
        return Math.abs(panel.getBoundingClientRect().bottom - nav.getBoundingClientRect().top) <= 1;
    }, undefined, { timeout: 2000 });
    const openPanel = await page.evaluate(() => ({
        panelBottom: document.getElementById('slide-panel').getBoundingClientRect().bottom,
        navTop: document.getElementById('main-nav').getBoundingClientRect().top
    }));
    expect(Math.abs(openPanel.panelBottom - openPanel.navTop)).toBeLessThanOrEqual(1);
    await context.close();
});
