const { test, expect } = require('@playwright/test');
const { newBarkContext, expectBarkAppIdentity } = require('./helpers/barkContext');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

async function openLoadedApp(page) {
    await page.goto(`${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}safariExternalReturn=${Date.now()}`);
    await expectBarkAppIdentity(page, expect);
    await page.waitForFunction(() => Boolean(
        window.map &&
        window.BARK &&
        typeof window.BARK.prepareExternalHandoff === 'function' &&
        window.BARK.markerManager &&
        window.BARK.markerManager.markers &&
        window.BARK.markerManager.markers.size > 0 &&
        document.getElementById('slide-panel') &&
        document.querySelector('.glass-nav')
    ), { timeout: 30000 });
}

test.describe('Safari installed-app external return', () => {
    test('external links hard-close the park sheet and settle the map after Back or X', async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();
        await openLoadedApp(page);

        await page.evaluate(() => {
            const marker = Array.from(window.BARK.markerManager.markers.values())
                .find(candidate => candidate && candidate._parkData);
            if (!marker) throw new Error('No park marker is available for the Safari return test.');
            window.BARK.markerManager.renderMarkerPanel(marker);

            const externalLink = document.createElement('a');
            externalLink.id = 'safari-return-test-link';
            externalLink.href = 'https://www.nps.gov/test/';
            externalLink.target = '_blank';
            externalLink.textContent = 'Visit external website';
            externalLink.addEventListener('click', event => event.preventDefault());
            document.body.appendChild(externalLink);

            window.__barkInvalidateSizeCount = 0;
            const originalInvalidateSize = window.map.invalidateSize.bind(window.map);
            window.map.invalidateSize = (...args) => {
                window.__barkInvalidateSizeCount += 1;
                return originalInvalidateSize(...args);
            };
            window.__barkExternalReturnSettled = false;
            window.addEventListener('bark:external-return-settled', () => {
                window.__barkExternalReturnSettled = true;
            }, { once: true });
        });

        await page.evaluate(() => document.getElementById('safari-return-test-link').click());

        const handoffState = await page.evaluate(() => {
            const panel = document.getElementById('slide-panel');
            const rect = panel.getBoundingClientRect();
            const style = getComputedStyle(panel);
            return {
                bodyPending: document.body.classList.contains('bark-external-handoff-pending'),
                panelOpen: panel.classList.contains('open'),
                panelTitle: document.getElementById('panel-title').textContent,
                panelTop: rect.top,
                viewportHeight: window.innerHeight,
                pointerEvents: style.pointerEvents,
                visibility: style.visibility
            };
        });

        expect(handoffState.bodyPending).toBe(true);
        expect(handoffState.panelOpen).toBe(false);
        expect(handoffState.panelTitle).toBe('Park Name');
        expect(handoffState.panelTop).toBeGreaterThanOrEqual(handoffState.viewportHeight);
        expect(handoffState.pointerEvents).toBe('none');
        expect(handoffState.visibility).toBe('hidden');

        await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        });
        await page.waitForFunction(() => window.__barkExternalReturnSettled === true, { timeout: 3000 });

        const returnedState = await page.evaluate(() => {
            const panel = document.getElementById('slide-panel');
            const rect = panel.getBoundingClientRect();
            const style = getComputedStyle(panel);
            return {
                bodyPending: document.body.classList.contains('bark-external-handoff-pending'),
                invalidateSizeCount: window.__barkInvalidateSizeCount,
                panelOpen: panel.classList.contains('open'),
                panelTop: rect.top,
                viewportHeight: window.innerHeight,
                pointerEvents: style.pointerEvents,
                visibility: style.visibility
            };
        });

        expect(returnedState.bodyPending).toBe(false);
        expect(returnedState.invalidateSizeCount).toBeGreaterThanOrEqual(2);
        expect(returnedState.panelOpen).toBe(false);
        expect(returnedState.panelTop).toBeGreaterThanOrEqual(returnedState.viewportHeight);
        expect(returnedState.pointerEvents).toBe('none');
        expect(returnedState.visibility).toBe('hidden');

        await context.close();
    });

    test('ordinary internal links do not disturb an open park sheet', async ({ browser }) => {
        const context = await newBarkContext(browser, { viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        await openLoadedApp(page);

        const state = await page.evaluate(() => {
            const panel = document.getElementById('slide-panel');
            panel.classList.add('open');
            document.getElementById('panel-title').textContent = 'Internal Navigation Test Park';

            const internalLink = document.createElement('a');
            internalLink.href = 'pages/privacy.html';
            internalLink.textContent = 'Internal page';
            internalLink.addEventListener('click', event => event.preventDefault());
            document.body.appendChild(internalLink);
            internalLink.click();

            return {
                bodyPending: document.body.classList.contains('bark-external-handoff-pending'),
                panelOpen: panel.classList.contains('open'),
                panelTitle: document.getElementById('panel-title').textContent
            };
        });

        expect(state.bodyPending).toBe(false);
        expect(state.panelOpen).toBe(true);
        expect(state.panelTitle).toBe('Internal Navigation Test Park');
        await context.close();
    });
});
