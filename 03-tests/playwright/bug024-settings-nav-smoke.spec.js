const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

async function openLoadedApp(page) {
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}settingsNavSmoke=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.map &&
        window.BARK &&
        window.BARK.settings &&
        typeof window.BARK.closeSettingsModal === 'function' &&
        document.getElementById('profile-view') &&
        document.getElementById('settings-gear-btn') &&
        document.getElementById('settings-overlay') &&
        document.querySelector('.nav-item[data-target="map-view"]')
    ), { timeout: 30000 });
}

test.describe('BUG-024 settings modal navigation handoff', () => {
    test('tapping Map while Settings is open closes Settings and navigates in one tap', async ({ browser }) => {
        const context = await newBarkContext(browser, { viewport: { width: 390, height: 844 } });
        const page = await context.newPage();

        await openLoadedApp(page);

        await page.locator('.nav-item[data-target="profile-view"]').click();
        await expect(page.locator('#profile-view')).toHaveClass(/active/, { timeout: 15000 });

        await page.locator('#settings-gear-btn').click();
        await expect(page.locator('#settings-overlay')).toHaveClass(/active/, { timeout: 15000 });

        await page.locator('.nav-item[data-target="map-view"]').click();

        await expect(page.locator('#settings-overlay')).not.toHaveClass(/active/, { timeout: 15000 });
        await expect(page.locator('#profile-view')).not.toHaveClass(/active/, { timeout: 15000 });
        await expect(page.locator('.nav-item[data-target="map-view"]')).toHaveClass(/active/, { timeout: 15000 });

        await page.locator('.nav-item[data-target="profile-view"]').click();
        await expect(page.locator('#profile-view')).toHaveClass(/active/, { timeout: 15000 });
        await expect(page.locator('#settings-overlay')).not.toHaveClass(/active/, { timeout: 15000 });

        await context.close();
    });

    test('Apple Pencil pointer input changes tabs on iPad in one activation', async ({ browser }) => {
        const context = await newBarkContext(browser, { viewport: { width: 744, height: 1133 } });
        const page = await context.newPage();

        await openLoadedApp(page);

        const profileTab = page.locator('.nav-item[data-target="profile-view"]');
        const box = await profileTab.boundingBox();
        expect(box).toBeTruthy();
        const startX = box.x + (box.width / 2);
        const startY = box.y + (box.height / 2);

        await profileTab.dispatchEvent('pointerdown', {
            pointerId: 41,
            pointerType: 'pen',
            isPrimary: true,
            button: 0,
            clientX: startX,
            clientY: startY
        });
        await profileTab.dispatchEvent('pointerup', {
            pointerId: 41,
            pointerType: 'pen',
            isPrimary: true,
            button: 0,
            clientX: startX + 3,
            clientY: startY + 2
        });

        await expect(page.locator('#profile-view')).toHaveClass(/active/, { timeout: 15000 });
        await expect(profileTab).toHaveAttribute('aria-current', 'page');

        const gearBox = await page.locator('#settings-gear-btn').boundingBox();
        expect(gearBox).toBeTruthy();
        expect(gearBox.y).toBeGreaterThanOrEqual(22);

        await context.close();
    });
});
