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
        window.BARK.externalPinReturn &&
        window.BARK.markerManager &&
        window.BARK.markerManager.markers &&
        window.BARK.markerManager.markers.size > 0 &&
        document.getElementById('slide-panel') &&
        document.querySelector('.glass-nav')
    ), { timeout: 30000 });
}

test.describe('Safari installed-app external return', () => {
    test('park Suggest an Edit opens the in-app feedback dialog', async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();
        await openLoadedApp(page);

        const park = await page.evaluate(() => {
            const marker = Array.from(window.BARK.markerManager.markers.values())
                .find(candidate => candidate && candidate._parkData);
            if (!marker) throw new Error('No park marker is available for the feedback entry-point test.');
            window.BARK.markerManager.renderMarkerPanel(marker);
            return {
                id: marker._parkData.id,
                name: marker._parkData.name,
                state: marker._parkData.state
            };
        });

        await page.locator('#suggest-edit-btn').click();

        const state = await page.evaluate(() => ({
            bodyPending: document.body.classList.contains('bark-external-handoff-pending'),
            panelOpen: document.getElementById('slide-panel').classList.contains('open'),
            panelTitle: document.getElementById('panel-title').textContent,
            feedbackOpen: document.getElementById('feedback-overlay').classList.contains('active'),
            feedbackHidden: document.getElementById('feedback-overlay').getAttribute('aria-hidden'),
            subject: document.getElementById('feedback-subject-input').value,
            correctionSelected: document.querySelector('[data-feedback-type="correction"]')
                .classList.contains('is-selected')
        }));

        expect(state.bodyPending).toBe(false);
        expect(state.panelOpen).toBe(true);
        expect(state.panelTitle).toBe(park.name);
        expect(state.feedbackOpen).toBe(true);
        expect(state.feedbackHidden).toBe('false');
        expect(state.subject).toContain(park.name);
        if (park.state) expect(state.subject).toContain(park.state);
        expect(state.correctionSelected).toBe(true);

        await context.close();
    });

    test('closing Profile feedback leaves park cards usable', async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();
        await openLoadedApp(page);

        await page.locator('.nav-item[data-target="profile-view"]').click();
        await page.locator('#email-suggest-btn').click();
        await expect(page.locator('#feedback-overlay')).toHaveClass(/\bactive\b/);
        await page.locator('#feedback-close-btn').click();

        const stateAfterClose = await page.evaluate(() => ({
            feedbackOpen: document.getElementById('feedback-overlay').classList.contains('active'),
            externalHandoffPending: document.body.classList.contains('bark-external-handoff-pending')
        }));
        expect(stateAfterClose.feedbackOpen).toBe(false);
        expect(stateAfterClose.externalHandoffPending).toBe(false);

        await page.locator('.nav-item[data-target="map-view"]').click();
        await page.waitForFunction(() => document.querySelectorAll('.custom-bark-marker').length > 1);

        const visiblePinIndexes = await page.getByRole('button', { name: 'Park Pin' }).evaluateAll(elements =>
            elements.map((element, index) => {
                const rect = element.getBoundingClientRect();
                const visible = rect.width > 0 && rect.height > 0
                    && rect.right > 0 && rect.bottom > 0
                    && rect.left < window.innerWidth && rect.top < window.innerHeight;
                if (!visible) return null;
                const centerTarget = document.elementFromPoint(
                    rect.left + (rect.width / 2),
                    rect.top + (rect.height / 2)
                );
                return (centerTarget === element || element.contains(centerTarget)) ? index : null;
            }).filter(index => index !== null).slice(0, 2)
        );
        expect(visiblePinIndexes.length).toBeGreaterThanOrEqual(2);

        const openedTitles = [];
        for (const pinIndex of visiblePinIndexes) {
            await page.getByRole('button', { name: 'Park Pin' }).nth(pinIndex).click();
            const panelState = await page.evaluate(() => {
                const panel = document.getElementById('slide-panel');
                const style = getComputedStyle(panel);
                return {
                    open: panel.classList.contains('open'),
                    title: document.getElementById('panel-title').textContent.trim(),
                    display: style.display,
                    visibility: style.visibility,
                    pointerEvents: style.pointerEvents
                };
            });

            expect(panelState.open).toBe(true);
            expect(panelState.title).not.toBe('');
            expect(panelState.display).not.toBe('none');
            expect(panelState.visibility).toBe('visible');
            expect(panelState.pointerEvents).toBe('auto');
            openedTitles.push(panelState.title);
            await page.locator('#close-slide-panel').click();
        }
        expect(openedTitles).toHaveLength(2);

        await context.close();
    });

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

    test('a park website return rebuilds the same park sheet after viewport recovery', async ({ browser }) => {
        const context = await newBarkContext(browser, {
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true
        });
        const page = await context.newPage();
        await openLoadedApp(page);

        const selectedPark = await page.evaluate(() => {
            const marker = Array.from(window.BARK.markerManager.markers.values())
                .find(candidate => candidate && candidate._parkData && /https?:\/\//.test(candidate._parkData.website || ''));
            if (!marker) throw new Error('No park website is available for the return restoration test.');

            window.BARK.markerManager.renderMarkerPanel(marker);
            const websiteLink = document.querySelector('#websites-container a[href]');
            if (!websiteLink) throw new Error('The selected park did not render a website link.');
            websiteLink.addEventListener('click', event => event.preventDefault());
            const panelContent = document.querySelector('#slide-panel .panel-content');
            panelContent.scrollTop = panelContent.scrollHeight;

            window.__barkWebsiteReturnSettled = false;
            window.__barkWebsiteReturnStarted = false;
            window.addEventListener('bark:external-return-started', () => {
                window.__barkWebsiteReturnStarted = true;
            }, { once: true });
            window.addEventListener('bark:external-return-settled', () => {
                window.__barkWebsiteReturnSettled = true;
            }, { once: true });

            return { id: String(marker._parkData.id), name: marker._parkData.name };
        });

        await page.locator('#websites-container a[href]').first().click();

        const hiddenState = await page.evaluate(() => ({
            pending: document.body.classList.contains('bark-external-handoff-pending'),
            panelOpen: document.getElementById('slide-panel').classList.contains('open'),
            panelTitle: document.getElementById('panel-title').textContent,
            activePin: window.BARK.activePinMarker
        }));
        expect(hiddenState.pending).toBe(true);
        expect(hiddenState.panelOpen).toBe(false);
        expect(hiddenState.panelTitle).toBe('');
        expect(hiddenState.activePin).toBeNull();

        const immediateReturnState = await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            const panel = document.getElementById('slide-panel');
            return {
                started: window.__barkWebsiteReturnStarted,
                settled: window.__barkWebsiteReturnSettled,
                pending: document.body.classList.contains('bark-external-handoff-pending'),
                returnVisible: document.body.classList.contains('bark-external-pin-return-visible'),
                panelOpen: panel.classList.contains('open'),
                display: getComputedStyle(panel).display,
                activePin: Boolean(window.BARK.activePinMarker)
            };
        });
        expect(immediateReturnState).toEqual({
            started: true,
            settled: false,
            pending: true,
            returnVisible: true,
            panelOpen: true,
            display: 'flex',
            activePin: true
        });
        await page.waitForFunction(() => Boolean(
            window.__barkWebsiteReturnSettled
            && document.getElementById('slide-panel').classList.contains('open')
            && window.BARK.activePinMarker
        ), undefined, { timeout: 4000 });
        await page.waitForFunction(() => {
            const panel = document.getElementById('slide-panel').getBoundingClientRect();
            const nav = document.querySelector('.glass-nav').getBoundingClientRect();
            return Math.abs(panel.bottom - nav.top) <= 1;
        }, undefined, { timeout: 2000 });

        const restoredState = await page.evaluate(() => {
            const panel = document.getElementById('slide-panel');
            const nav = document.querySelector('.glass-nav');
            return {
                pending: document.body.classList.contains('bark-external-handoff-pending'),
                panelOpen: panel.classList.contains('open'),
                panelTitle: document.getElementById('panel-title').textContent,
                activePinId: String(window.BARK.activePinMarker._parkData.id),
                activePinName: window.BARK.activePinMarker._parkData.name,
                panelScrollTop: document.querySelector('#slide-panel .panel-content').scrollTop,
                panelBottom: panel.getBoundingClientRect().bottom,
                navTop: nav.getBoundingClientRect().top,
                websiteButtonCount: document.getElementById('websites-container').childElementCount
            };
        });

        expect(restoredState.pending).toBe(false);
        expect(restoredState.panelOpen).toBe(true);
        expect(restoredState.panelTitle).toBe(selectedPark.name);
        expect(restoredState.activePinId).toBe(selectedPark.id);
        expect(restoredState.activePinName).toBe(selectedPark.name);
        expect(restoredState.panelScrollTop).toBe(0);
        expect(restoredState.websiteButtonCount).toBeGreaterThan(0);
        expect(Math.abs(restoredState.panelBottom - restoredState.navTop)).toBeLessThanOrEqual(1);

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
            const allMarkers = Array.from(window.BARK.markerManager.markers.values())
                .filter(candidate => candidate && candidate._parkData);
            const firstMarker = allMarkers.find(candidate => /https?:\/\//.test(candidate._parkData.website || ''));
            const secondMarker = allMarkers.find(candidate => candidate !== firstMarker);
            if (!firstMarker || !secondMarker) {
                throw new Error('Two park markers, including one website, are required for the rapid Safari return test.');
            }

            window.BARK.markerManager.renderMarkerPanel(firstMarker);
            window.__barkRapidInvalidateSizeCount = 0;
            const originalInvalidateSize = window.map.invalidateSize.bind(window.map);
            window.map.invalidateSize = (...args) => {
                window.__barkRapidInvalidateSizeCount += 1;
                return originalInvalidateSize(...args);
            };
            const externalLink = document.querySelector('#websites-container a[href]');
            if (!externalLink) throw new Error('The first rapid-return marker did not render a website link.');
            externalLink.addEventListener('click', event => event.preventDefault());
            externalLink.click();

            window.__barkRapidReturnSettled = false;
            window.addEventListener('bark:external-return-settled', () => {
                window.__barkRapidReturnSettled = true;
            }, { once: true });
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

            // This is the race from the real iPhone: the user returns to Map
            // and opens a pin before the 1.2-second compositor quarantine ends.
            window.BARK.markerManager.renderMarkerPanel(secondMarker);
            return secondMarker._parkData.name;
        });

        const immediateState = await page.evaluate(() => {
            const panel = document.getElementById('slide-panel');
            const style = getComputedStyle(panel);
            return {
                settled: window.__barkRapidReturnSettled,
                bodyPending: document.body.classList.contains('bark-external-handoff-pending'),
                panelOpen: panel.classList.contains('open'),
                display: style.display,
                visibility: style.visibility,
                pointerEvents: style.pointerEvents,
                invalidateSizeCount: window.__barkRapidInvalidateSizeCount
            };
        });
        expect(immediateState.settled).toBe(true);
        expect(immediateState.bodyPending).toBe(false);
        expect(immediateState.panelOpen).toBe(true);
        expect(immediateState.display).not.toBe('none');
        expect(immediateState.visibility).toBe('visible');
        expect(immediateState.pointerEvents).toBe('auto');

        await page.waitForTimeout(1400);

        const state = await page.evaluate(() => ({
            bodyPending: document.body.classList.contains('bark-external-handoff-pending'),
            panelOpen: document.getElementById('slide-panel').classList.contains('open'),
            panelTitle: document.getElementById('panel-title').textContent,
            activePinName: window.BARK.activePinMarker &&
                window.BARK.activePinMarker._parkData &&
                window.BARK.activePinMarker._parkData.name,
            invalidateSizeCount: window.__barkRapidInvalidateSizeCount
        }));

        expect(state.bodyPending).toBe(false);
        expect(state.panelOpen).toBe(true);
        expect(state.panelTitle).toBe(expectedTitle);
        expect(state.activePinName).toBe(expectedTitle);
        expect(state.invalidateSizeCount).toBe(immediateState.invalidateSizeCount);
        await context.close();
    });
});
