const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

async function openSearchApp(browser, { viewport, lowGraphics = false, ultraLow = false }) {
    const context = await newBarkContext(browser, { viewport, isMobile: true, hasTouch: true });
    await context.addInitScript(({ lowGraphicsEnabled, ultraLowEnabled }) => {
        localStorage.setItem('barkLowGfxEnabled', lowGraphicsEnabled ? 'true' : 'false');
        localStorage.setItem('barkUltraLowEnabled', ultraLowEnabled ? 'true' : 'false');
    }, { lowGraphicsEnabled: lowGraphics, ultraLowEnabled: ultraLow });
    const page = await context.newPage();

    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}searchViewportSmoke=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.BARK &&
        window.BARK.repos &&
        window.BARK.repos.ParkRepo &&
        window.BARK.repos.ParkRepo.getAll().length > 50 &&
        window.BARK.searchSuggestionLayout
    ), { timeout: 30000 });

    return { context, page };
}

async function showSuggestions(page) {
    await page.locator('#park-search').fill('Yellow');
    await expect(page.locator('#search-suggestions')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#search-suggestions .suggestion-item').first()).toBeVisible();
}

async function readLayout(page) {
    return page.evaluate(() => {
        const panel = document.getElementById('filter-panel');
        const suggestions = document.getElementById('search-suggestions');
        const nav = document.getElementById('main-nav');
        const input = document.getElementById('park-search');
        const suggestionRect = suggestions.getBoundingClientRect();
        const navRect = nav.getBoundingClientRect();
        const inputRect = input.getBoundingClientRect();
        const viewportBottom = window.visualViewport
            ? window.visualViewport.offsetTop + window.visualViewport.height
            : window.innerHeight;
        const visibleBottom = navRect.top > inputRect.bottom && navRect.top < viewportBottom
            ? navRect.top
            : viewportBottom;

        return {
            bodyClass: document.body.className,
            panelClass: panel.className,
            panelOverflow: getComputedStyle(panel).overflow,
            suggestionTop: suggestionRect.top,
            suggestionBottom: suggestionRect.bottom,
            suggestionHeight: suggestionRect.height,
            suggestionScrollHeight: suggestions.scrollHeight,
            inputBottom: inputRect.bottom,
            visibleBottom
        };
    });
}

for (const mode of [
    { name: 'Normal', lowGraphics: false, ultraLow: false, expectedClass: null },
    { name: 'Low Graphics', lowGraphics: true, ultraLow: false, expectedClass: 'low-graphics' },
    { name: 'Ultra Fast', lowGraphics: true, ultraLow: true, expectedClass: 'ultra-low' }
]) {
    test(`${mode.name} search dropdown escapes the phone panel and stays above navigation`, async ({ browser }) => {
        const { context, page } = await openSearchApp(browser, {
            viewport: { width: 360, height: 740 },
            lowGraphics: mode.lowGraphics,
            ultraLow: mode.ultraLow
        });

        await showSuggestions(page);
        const layout = await readLayout(page);

        if (mode.expectedClass) expect(layout.bodyClass).toContain(mode.expectedClass);
        expect(layout.panelClass).toContain('search-suggestions-open');
        expect(layout.panelOverflow).toBe('visible');
        expect(layout.suggestionTop).toBeGreaterThanOrEqual(layout.inputBottom);
        expect(layout.suggestionBottom).toBeLessThanOrEqual(layout.visibleBottom + 1);
        expect(layout.suggestionHeight).toBeGreaterThan(40);

        await context.close();
    });
}

test('search dropdown shrinks and scrolls in short landscape', async ({ browser }) => {
    const { context, page } = await openSearchApp(browser, {
        viewport: { width: 740, height: 360 },
        lowGraphics: true
    });

    await showSuggestions(page);
    const layout = await readLayout(page);

    expect(layout.panelOverflow).toBe('visible');
    expect(layout.suggestionBottom).toBeLessThanOrEqual(layout.visibleBottom + 1);
    expect(layout.suggestionHeight).toBeLessThan(250);
    expect(layout.suggestionScrollHeight).toBeGreaterThan(layout.suggestionHeight);

    await context.close();
});

test('an open dropdown recalculates when the visible viewport shrinks', async ({ browser }) => {
    const { context, page } = await openSearchApp(browser, {
        viewport: { width: 390, height: 740 },
        lowGraphics: true
    });

    await showSuggestions(page);
    const before = await readLayout(page);
    expect(before.suggestionHeight).toBe(250);

    await page.setViewportSize({ width: 390, height: 360 });
    await expect.poll(async () => (await readLayout(page)).suggestionHeight).toBeLessThan(250);
    const after = await readLayout(page);
    expect(after.suggestionBottom).toBeLessThanOrEqual(after.visibleBottom + 1);
    expect(after.suggestionScrollHeight).toBeGreaterThan(after.suggestionHeight);

    await context.close();
});

test('expanded filters keep their scroll region while search suggestions escape', async ({ browser }) => {
    const { context, page } = await openSearchApp(browser, {
        viewport: { width: 390, height: 600 },
        lowGraphics: true
    });

    await page.locator('#toggle-filter-btn').click();
    await expect(page.locator('#filter-panel')).not.toHaveClass(/collapsed/);
    await showSuggestions(page);

    const layout = await readLayout(page);
    const filterScroll = await page.locator('#filter-content').evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight
    }));

    expect(layout.panelOverflow).toBe('visible');
    expect(layout.suggestionBottom).toBeLessThanOrEqual(layout.visibleBottom + 1);
    expect(filterScroll.overflowY).toBe('auto');
    expect(filterScroll.scrollHeight).toBeGreaterThan(filterScroll.clientHeight);

    await context.close();
});
