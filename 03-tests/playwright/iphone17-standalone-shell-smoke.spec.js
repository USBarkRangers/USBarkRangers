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
            .getPropertyValue('--bark-nav-content-lift')) || 0;
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
    await page.waitForFunction(() => Number(document.documentElement.dataset.barkNavContentLift) > 0);

    const geometry = await page.evaluate(() => {
        const mapRect = document.getElementById('map').getBoundingClientRect();
        const navRect = document.getElementById('main-nav').getBoundingClientRect();
        const contentRects = Array.from(document.querySelectorAll('#main-nav .nav-item svg, #main-nav .nav-item > span'))
            .filter(element => element.id !== 'planner-badge' || element.offsetParent !== null)
            .map(element => element.getBoundingClientRect());
        return {
            lift: Number(document.documentElement.dataset.barkNavContentLift),
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

    await context.close();
});

test('temporary Safari viewport changes never resize structural UI and clear on restore', async ({ browser }) => {
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
        window.__barkTestVisualHeight = 932;
        const viewport = new EventTarget();
        Object.defineProperties(viewport, {
            width: { configurable: true, get: () => 430 },
            height: { configurable: true, get: () => window.__barkTestVisualHeight },
            offsetTop: { configurable: true, get: () => 0 },
            offsetLeft: { configurable: true, get: () => 0 },
            scale: { configurable: true, get: () => 1 }
        });
        Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => viewport });
        window.__barkTestViewport = viewport;
    });

    const page = await context.newPage();
    await page.goto(`${BASE_URL}?viewportTransition=${Date.now()}`);
    await waitForShell(page);

    const baseline = await page.evaluate(() => {
        const nav = document.getElementById('main-nav').getBoundingClientRect();
        const panel = document.getElementById('slide-panel').getBoundingClientRect();
        return { navTop: nav.top, navHeight: nav.height, panelBottom: panel.bottom };
    });

    await page.evaluate(() => {
        window.__barkTestVisualHeight = 760;
        window.__barkTestViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => Number(document.documentElement.dataset.barkNavContentLift) > 0);

    const obstructed = await page.evaluate(() => {
        const nav = document.getElementById('main-nav').getBoundingClientRect();
        const panel = document.getElementById('slide-panel').getBoundingClientRect();
        return {
            lift: Number(document.documentElement.dataset.barkNavContentLift),
            navTop: nav.top,
            navHeight: nav.height,
            panelBottom: panel.bottom
        };
    });
    expect(obstructed.lift).toBeGreaterThan(0);
    expect(Math.abs(obstructed.navTop - baseline.navTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(obstructed.navHeight - baseline.navHeight)).toBeLessThanOrEqual(1);
    expect(Math.abs(obstructed.panelBottom - baseline.panelBottom)).toBeLessThanOrEqual(1);

    await page.evaluate(() => {
        window.__barkTestVisualHeight = 932;
        window.__barkTestViewport.dispatchEvent(new Event('resize'));
    });
    await page.waitForFunction(() => document.documentElement.dataset.barkNavContentLift === '0');

    const restored = await page.evaluate(() => {
        const nav = document.getElementById('main-nav').getBoundingClientRect();
        return {
            lift: Number(document.documentElement.dataset.barkNavContentLift),
            navTop: nav.top,
            navHeight: nav.height
        };
    });
    expect(restored.lift).toBe(0);
    expect(Math.abs(restored.navTop - baseline.navTop)).toBeLessThanOrEqual(1);
    expect(Math.abs(restored.navHeight - baseline.navHeight)).toBeLessThanOrEqual(1);
    await context.close();
});

test('closing an external picture refreshes stale viewport units without replacing the app document', async ({ browser }) => {
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
    await page.goto(`${BASE_URL}?externalPictureReturn=${Date.now()}`);
    await waitForShell(page);
    const documentToken = await page.evaluate(() => {
        const token = `${Date.now()}-${Math.random()}`;
        document.documentElement.dataset.pictureReturnDocument = token;
        window.BARK.prepareExternalHandoff({ source: 'swag-picture' });
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        return token;
    });

    await page.waitForFunction(() => Boolean(document.documentElement.dataset.barkStandaloneAppHeight));
    await page.waitForFunction(() => !document.body.classList.contains('bark-external-handoff-pending'), undefined, {
        timeout: 3000
    });

    const restored = await page.evaluate(() => {
        const map = document.getElementById('map').getBoundingClientRect();
        const nav = document.getElementById('main-nav').getBoundingClientRect();
        return {
            token: document.documentElement.dataset.pictureReturnDocument,
            stableShell: document.documentElement.classList.contains('bark-stable-standalone-shell'),
            stableHeight: parseFloat(document.documentElement.dataset.barkStandaloneAppHeight),
            mapBottom: map.bottom,
            navBottom: nav.bottom,
            innerHeight: window.innerHeight
        };
    });

    expect(restored.token).toBe(documentToken);
    expect(restored.stableShell).toBe(true);
    expect(restored.stableHeight).toBeGreaterThanOrEqual(restored.innerHeight - 1);
    expect(restored.mapBottom).toBeGreaterThanOrEqual(restored.innerHeight - 1);
    expect(restored.navBottom).toBeGreaterThanOrEqual(restored.innerHeight - 1);
    await context.close();
});

test('park sheet and nav share fixed viewport coordinates', async ({ browser }) => {
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
    await page.goto(`${BASE_URL}?fixedPanelViewport=${Date.now()}`);
    await waitForShell(page);
    await page.evaluate(() => {
        const marker = Array.from(window.BARK.markerManager.markers.values())
            .find(candidate => candidate && candidate._parkData);
        window.BARK.markerManager.renderMarkerPanel(marker);
    });
    await expect(page.locator('#slide-panel')).toHaveClass(/\bopen\b/);
    await page.waitForFunction(() => {
        const panelRect = document.getElementById('slide-panel').getBoundingClientRect();
        const navRect = document.getElementById('main-nav').getBoundingClientRect();
        return Math.abs(panelRect.bottom - navRect.top) <= 1;
    }, undefined, { timeout: 2000 });

    const geometry = await page.evaluate(() => {
        const panel = document.getElementById('slide-panel');
        const panelRect = panel.getBoundingClientRect();
        const navRect = document.getElementById('main-nav').getBoundingClientRect();
        return {
            panelPosition: getComputedStyle(panel).position,
            panelTop: panelRect.top,
            panelBottom: panelRect.bottom,
            navTop: navRect.top,
            innerHeight: window.innerHeight
        };
    });

    expect(['fixed', 'absolute']).toContain(geometry.panelPosition);
    expect(Math.abs(geometry.panelBottom - geometry.navTop)).toBeLessThanOrEqual(1);
    expect(geometry.panelTop).toBeGreaterThan(200);
    expect(geometry.panelBottom).toBeLessThan(geometry.innerHeight);
    await context.close();
});
