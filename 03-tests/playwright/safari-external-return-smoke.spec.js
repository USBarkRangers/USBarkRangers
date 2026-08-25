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
                visibility: style.visibility,
                display: style.display
            };
        });

        expect(handoffState.bodyPending).toBe(true);
        expect(handoffState.panelOpen).toBe(false);
        expect(handoffState.panelTitle).toBe('');
        expect(handoffState.pointerEvents).toBe('none');
        expect(handoffState.display).toBe('none');

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
                visibility: style.visibility,
                display: style.display,
                panelTitle: document.getElementById('panel-title').textContent,
                websiteButtonCount: document.getElementById('websites-container').childElementCount,
                videoHref: document.getElementById('panel-video').getAttribute('href')
            };
        });

        expect(returnedState.bodyPending).toBe(false);
        expect(returnedState.invalidateSizeCount).toBeGreaterThanOrEqual(2);
        expect(returnedState.panelOpen).toBe(false);
        expect(returnedState.panelTop).toBeGreaterThanOrEqual(returnedState.viewportHeight);
        expect(returnedState.pointerEvents).toBe('none');
        expect(returnedState.visibility).toBe('hidden');
        expect(returnedState.display).not.toBe('none');
        expect(returnedState.panelTitle).toBe('');
        expect(returnedState.websiteButtonCount).toBe(0);
        expect(returnedState.videoHref).toBeNull();

        const viewportGeometry = await page.evaluate(() => {
            const mapRect = document.getElementById('map').getBoundingClientRect();
            const navRect = document.querySelector('.glass-nav').getBoundingClientRect();
            return {
                mapBottom: mapRect.bottom,
                navTop: navRect.top,
                viewportHeight: window.innerHeight
            };
        });

        // Safari can preserve a percentage-height child at the shorter height
        // used by its external-site overlay. The map must cover the viewport
        // beneath the fixed nav, and the mobile sheet must anchor to that nav.
        expect(viewportGeometry.mapBottom).toBeGreaterThanOrEqual(viewportGeometry.viewportHeight - 1);
        expect(viewportGeometry.mapBottom).toBeGreaterThanOrEqual(viewportGeometry.navTop);

        const reopenedState = await page.evaluate(() => {
            const marker = Array.from(window.BARK.markerManager.markers.values())
                .find(candidate => candidate && candidate._parkData);
            window.BARK.markerManager.renderMarkerPanel(marker);
            return {
                panelOpen: document.getElementById('slide-panel').classList.contains('open'),
                panelTitle: document.getElementById('panel-title').textContent,
                expectedTitle: marker._parkData.name
            };
        });
        expect(reopenedState.panelOpen).toBe(true);
        expect(reopenedState.panelTitle).toBe(reopenedState.expectedTitle);

        await page.waitForTimeout(400);
        const openSheetGeometry = await page.evaluate(() => ({
            panelBottom: document.getElementById('slide-panel').getBoundingClientRect().bottom,
            navTop: document.querySelector('.glass-nav').getBoundingClientRect().top
        }));
        expect(Math.abs(openSheetGeometry.panelBottom - openSheetGeometry.navTop)).toBeLessThanOrEqual(1);

        await context.close();
    });

    test('community information links use an isolated Safari window', async ({ browser }) => {
        const context = await newBarkContext(browser, { viewport: { width: 390, height: 844 } });
        const page = await context.newPage();
        await openLoadedApp(page);

        const links = await page.locator('a[href^="https://usbarkrangers.com/"]').evaluateAll(elements =>
            elements
                .filter(element => /\/(safety-tips|meet-the-team)$/.test(element.href))
                .map(element => ({
                    href: element.href,
                    target: element.target,
                    rel: element.rel.split(/\s+/).filter(Boolean).sort()
                }))
        );

        expect(links).toHaveLength(2);
        for (const link of links) {
            expect(link.target).toBe('_blank');
            expect(link.rel).toEqual(['noopener', 'noreferrer']);
        }

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

    test('a pin opened immediately after Safari return survives delayed viewport cleanup', async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();
        await openLoadedApp(page);

        const expectedTitle = await page.evaluate(() => {
            const markers = Array.from(window.BARK.markerManager.markers.values())
                .filter(candidate => candidate && candidate._parkData);
            if (markers.length < 2) throw new Error('Two park markers are required for the rapid Safari return test.');

            window.BARK.markerManager.renderMarkerPanel(markers[0]);
            const externalLink = document.createElement('a');
            externalLink.href = 'https://www.nps.gov/test/';
            externalLink.target = '_blank';
            externalLink.addEventListener('click', event => event.preventDefault());
            document.body.appendChild(externalLink);
            externalLink.click();

            window.__barkRapidReturnSettled = false;
            window.addEventListener('bark:external-return-settled', () => {
                window.__barkRapidReturnSettled = true;
            }, { once: true });
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

            // This is the race from the real iPhone: the user returns to Map
            // and opens a pin before the 1.2-second compositor quarantine ends.
            window.BARK.markerManager.renderMarkerPanel(markers[1]);
            return markers[1]._parkData.name;
        });

        await page.waitForFunction(() => window.__barkRapidReturnSettled === true, { timeout: 3000 });

        const state = await page.evaluate(() => ({
            bodyPending: document.body.classList.contains('bark-external-handoff-pending'),
            panelOpen: document.getElementById('slide-panel').classList.contains('open'),
            panelTitle: document.getElementById('panel-title').textContent,
            activePinName: window.BARK.activePinMarker &&
                window.BARK.activePinMarker._parkData &&
                window.BARK.activePinMarker._parkData.name
        }));

        expect(state.bodyPending).toBe(false);
        expect(state.panelOpen).toBe(true);
        expect(state.panelTitle).toBe(expectedTitle);
        expect(state.activePinName).toBe(expectedTitle);
        await context.close();
    });
});
