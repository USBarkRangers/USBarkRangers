const { test, expect, devices } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

const IOS_PHONES = [
    'iPhone 6', 'iPhone 6 Plus', 'iPhone SE', 'iPhone SE (3rd gen)',
    'iPhone 8', 'iPhone 8 Plus', 'iPhone X', 'iPhone XR',
    'iPhone 11', 'iPhone 11 Pro', 'iPhone 11 Pro Max',
    'iPhone 12', 'iPhone 12 Mini', 'iPhone 12 Pro Max',
    'iPhone 13', 'iPhone 13 Mini', 'iPhone 13 Pro Max',
    'iPhone 14', 'iPhone 14 Plus', 'iPhone 14 Pro', 'iPhone 14 Pro Max',
    'iPhone 15', 'iPhone 15 Plus', 'iPhone 15 Pro', 'iPhone 15 Pro Max'
];

const ANDROID_PHONES = [
    'Galaxy Note II', 'Galaxy Note 3', 'Galaxy S III', 'Galaxy S5',
    'Galaxy S8', 'Galaxy S9+', 'Galaxy S24', 'Galaxy A55',
    'Nexus 4', 'Nexus 5', 'Nexus 5X', 'Nexus 6', 'Nexus 6P',
    'Pixel 2', 'Pixel 2 XL', 'Pixel 3', 'Pixel 4', 'Pixel 4a (5G)',
    'Pixel 5', 'Pixel 7', 'Moto G4'
];

function contextOptions(deviceName, orientation) {
    const descriptorName = orientation === 'landscape' ? `${deviceName} landscape` : deviceName;
    const descriptor = devices[descriptorName];
    if (!descriptor) throw new Error(`Missing Playwright device descriptor: ${descriptorName}`);
    const { defaultBrowserType, ...options } = descriptor;
    return options;
}

async function openShell(browser, deviceName, orientation, standalone) {
    const context = await newBarkContext(browser, contextOptions(deviceName, orientation));
    if (standalone) {
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'standalone', {
                configurable: true,
                get: () => true
            });
        });
    }
    const page = await context.newPage();
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}viewportMatrix=${encodeURIComponent(deviceName)}-${orientation}-${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.BARK
        && window.BARK.viewportCoordinator
        && !document.getElementById('bark-loader')
        && document.getElementById('main-nav')
    ), undefined, { timeout: 30000 });
    return { context, page };
}

async function readGeometry(page) {
    return page.evaluate(() => {
        const rect = selector => {
            const value = document.querySelector(selector).getBoundingClientRect();
            return {
                top: value.top,
                right: value.right,
                bottom: value.bottom,
                left: value.left,
                width: value.width,
                height: value.height
            };
        };
        const visualTop = window.visualViewport ? window.visualViewport.offsetTop : 0;
        const visualLeft = window.visualViewport ? window.visualViewport.offsetLeft : 0;
        const visualBottom = window.visualViewport
            ? window.visualViewport.offsetTop + window.visualViewport.height
            : window.innerHeight;
        const visualRight = window.visualViewport
            ? window.visualViewport.offsetLeft + window.visualViewport.width
            : window.innerWidth;
        const navContent = Array.from(document.querySelectorAll('#main-nav .nav-item svg, #main-nav .nav-item > span'))
            .filter(element => element.id !== 'planner-badge' || element.offsetParent !== null)
            .map(element => element.getBoundingClientRect());
        return {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
            visualTop,
            visualRight,
            visualBottom,
            visualLeft,
            map: rect('#map'),
            nav: rect('#main-nav'),
            filter: rect('#filter-panel'),
            navContentTop: Math.min(...navContent.map(value => value.top)),
            navContentRight: Math.max(...navContent.map(value => value.right)),
            navContentBottom: Math.max(...navContent.map(value => value.bottom)),
            navContentLeft: Math.min(...navContent.map(value => value.left)),
            documentWidth: document.documentElement.scrollWidth,
            bodyBottom: document.body.getBoundingClientRect().bottom
        };
    });
}

async function assertShellFits(page) {
    const geometry = await readGeometry(page);
    expect(geometry.map.top).toBeLessThanOrEqual(1);
    expect(geometry.map.left).toBeLessThanOrEqual(1);
    expect(geometry.map.right).toBeGreaterThanOrEqual(geometry.innerWidth - 1);
    expect(geometry.map.bottom).toBeGreaterThanOrEqual(geometry.innerHeight - 1);
    expect(geometry.bodyBottom).toBeGreaterThanOrEqual(geometry.innerHeight - 1);
    expect(geometry.navContentTop).toBeGreaterThanOrEqual(geometry.visualTop - 1);
    expect(geometry.navContentRight).toBeLessThanOrEqual(geometry.visualRight + 1);
    expect(geometry.navContentBottom).toBeLessThanOrEqual(geometry.visualBottom + 1);
    expect(geometry.navContentLeft).toBeGreaterThanOrEqual(geometry.visualLeft - 1);
    expect(geometry.filter.top).toBeGreaterThanOrEqual(geometry.visualTop - 1);
    expect(geometry.filter.right).toBeLessThanOrEqual(geometry.visualRight + 1);
    expect(geometry.filter.left).toBeGreaterThanOrEqual(geometry.visualLeft - 1);
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.innerWidth + 1);
}

function registerMatrix(familyName, phoneNames, requiredBrowser, standalone) {
    test.describe(`${familyName} viewport matrix`, () => {
        for (const deviceName of phoneNames) {
            for (const orientation of ['portrait', 'landscape']) {
                test(`${deviceName} ${orientation}`, async ({ browser, browserName }) => {
                    test.skip(browserName !== requiredBrowser, `Runs in ${requiredBrowser}`);
                    const { context, page } = await openShell(browser, deviceName, orientation, standalone);
                    try {
                        await assertShellFits(page);

                        await page.locator('#toggle-filter-btn').click();
                        await expect(page.locator('#filter-panel')).not.toHaveClass(/\bcollapsed\b/);
                        const expanded = await page.evaluate(() => {
                            const panel = document.getElementById('filter-panel').getBoundingClientRect();
                            const nav = document.getElementById('main-nav').getBoundingClientRect();
                            const content = document.querySelector('#filter-panel .filter-content');
                            return {
                                panelTop: panel.top,
                                panelBottom: panel.bottom,
                                navTop: nav.top,
                                viewportBottom: visualViewport
                                    ? visualViewport.offsetTop + visualViewport.height
                                    : innerHeight,
                                contentScrollable: content.scrollHeight > content.clientHeight + 1
                                    ? /(auto|scroll)/.test(getComputedStyle(content).overflowY)
                                    : true
                            };
                        });
                        expect(expanded.panelTop).toBeGreaterThanOrEqual(-1);
                        expect(expanded.panelBottom).toBeLessThanOrEqual(expanded.viewportBottom + 1);
                        expect(expanded.contentScrollable).toBe(true);
                    } finally {
                        await context.close();
                    }
                });
            }
        }
    });
}

registerMatrix('installed iPhone', IOS_PHONES, 'webkit', true);
registerMatrix('Android phone', ANDROID_PHONES, 'chromium', false);

const REPRESENTATIVE_FLOWS = [
    { name: 'iPhone SE', browser: 'webkit', standalone: true },
    { name: 'iPhone 15 Pro Max', browser: 'webkit', standalone: true },
    { name: 'Galaxy S III', browser: 'chromium', standalone: false },
    { name: 'Galaxy S24', browser: 'chromium', standalone: false },
    { name: 'Pixel 7', browser: 'chromium', standalone: false }
];

test.describe('representative phone app flows', () => {
    for (const profile of REPRESENTATIVE_FLOWS) {
        test(`${profile.name}: tabs, park card, filter and live external return`, async ({ browser, browserName }) => {
            test.skip(browserName !== profile.browser, `Runs in ${profile.browser}`);
            const { context, page } = await openShell(browser, profile.name, 'portrait', profile.standalone);
            try {
                const documentToken = await page.evaluate(() => {
                    const token = `${Date.now()}-${Math.random()}`;
                    document.documentElement.dataset.viewportDocumentToken = token;
                    return token;
                });

                for (const target of ['home-view', 'planner-view', 'profile-view', 'map-view']) {
                    await page.locator(`.nav-item[data-target="${target}"]`).click();
                    await expect(page.locator(`.nav-item[data-target="${target}"]`)).toHaveClass(/\bactive\b/);
                    await assertShellFits(page);
                }

                await page.evaluate(() => {
                    const marker = Array.from(window.BARK.markerManager.markers.values())
                        .find(candidate => candidate && candidate._parkData);
                    window.BARK.markerManager.renderMarkerPanel(marker);
                });
                await expect(page.locator('#slide-panel')).toHaveClass(/\bopen\b/);
                await page.waitForFunction(() => {
                    const panel = document.getElementById('slide-panel').getBoundingClientRect();
                    const nav = document.getElementById('main-nav').getBoundingClientRect();
                    return panel.top >= -1 && panel.bottom <= nav.top + 1;
                }, undefined, { timeout: 2000 });
                await page.locator('#close-slide-panel').click();

                await page.evaluate(() => {
                    window.__viewportReturnSettled = false;
                    window.addEventListener('bark:external-return-settled', () => {
                        window.__viewportReturnSettled = true;
                    }, { once: true });
                    window.BARK.prepareExternalHandoff({ source: 'viewport-matrix' });
                    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
                });
                await page.waitForFunction(() => window.__viewportReturnSettled === true, undefined, { timeout: 3000 });
                expect(await page.evaluate(() => document.documentElement.dataset.viewportDocumentToken))
                    .toBe(documentToken);
                await assertShellFits(page);
            } finally {
                await context.close();
            }
        });
    }
});
