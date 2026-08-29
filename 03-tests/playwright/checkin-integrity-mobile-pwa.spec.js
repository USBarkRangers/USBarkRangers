const { test, expect, chromium, webkit, devices } = require('@playwright/test');

const BASE_URL = process.env.BARK_E2E_BASE_URL || 'http://localhost:4173/index.html';

const ANDROID_PWA = {
    userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S938U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
    viewport: { width: 412, height: 915 },
    screen: { width: 412, height: 915 },
    deviceScaleFactor: 3.5,
    isMobile: true,
    hasTouch: true
};

async function openInstalledPwa(browserType, deviceOptions, iosStandalone) {
    const browser = await browserType.launch();
    const context = await browser.newContext({
        ...deviceOptions,
        serviceWorkers: 'block'
    });
    await context.addInitScript(({ ios }) => {
        localStorage.setItem('barkTermsAgreement', '1');
        if (ios) {
            Object.defineProperty(navigator, 'standalone', {
                configurable: true,
                get: () => true
            });
        }
        const nativeMatchMedia = window.matchMedia.bind(window);
        window.matchMedia = query => {
            const result = nativeMatchMedia(query);
            if (query !== '(display-mode: standalone)') return result;
            return new Proxy(result, {
                get(target, property) {
                    if (property === 'matches') return true;
                    const value = target[property];
                    return typeof value === 'function' ? value.bind(target) : value;
                }
            });
        };
    }, { ios: iosStandalone });
    const page = await context.newPage();
    await page.goto(BASE_URL);
    await page.waitForFunction(() => Boolean(
        window.BARK
        && window.BARK.repos
        && window.BARK.repos.VaultRepo
        && window.BARK.services
        && window.BARK.services.checkin
        && window.BARK.services.firebase
    ), { timeout: 30000 });
    return { browser, context, page };
}

async function exerciseIntegrityGuards(page, profileName) {
    return page.evaluate(async profile => {
        const repo = window.BARK.repos.VaultRepo;
        const checkin = window.BARK.services.checkin;
        const realFirebaseService = window.BARK.services.firebase;
        const realFirebase = window.firebase;
        const realSetItem = Storage.prototype.setItem;
        const originalGeolocation = navigator.geolocation;
        let attemptedWrites = 0;

        try {
            repo.clear();
            Storage.prototype.setItem = function (key, value) {
                if (String(key).startsWith('bark.unconfirmedVisits.')) {
                    throw new DOMException('Quota exceeded', 'QuotaExceededError');
                }
                return realSetItem.call(this, key, value);
            };
            Object.defineProperty(navigator, 'geolocation', {
                configurable: true,
                value: {
                    getCurrentPosition(resolve) {
                        resolve({ coords: { latitude: 10, longitude: 20, accuracy: 5 } });
                    }
                }
            });
            window.firebase = {
                auth: () => ({ currentUser: { uid: `${profile}-storage-user` } })
            };
            window.BARK.config.CHECKIN_RADIUS_KM = 25;
            window.BARK.utils.geo.haversine = () => 0;
            window.BARK.services.firebase = {
                stageVisitedPlaceUpsert(visit) {
                    repo.stageUpsert(visit);
                },
                async updateCurrentUserVisitedPlaces() {
                    attemptedWrites++;
                }
            };

            const storageResult = await checkin.verifyGpsCheckin({
                id: `${profile}-storage-park`,
                name: `${profile} Storage Park`,
                lat: 10,
                lng: 20
            });
            const storageGuard = {
                result: storageResult,
                localVisit: repo.hasVisit(`${profile}-storage-park`),
                pending: repo.hasPendingMutation(`${profile}-storage-park`),
                attemptedWrites
            };

            Storage.prototype.setItem = realSetItem;
            repo.clear();
            const localVisit = {
                id: `${profile}-local`, name: 'Local Device Visit', verified: true, ts: 2, syncToken: 'local-token'
            };
            const baseline = { id: 'baseline', name: 'Baseline', verified: true, ts: 1 };
            const remoteVisit = {
                id: `${profile}-remote`, name: 'Other Device Visit', verified: true, ts: 3, syncToken: 'remote-token'
            };
            repo.addVisit(localVisit);
            repo.stageUpsert(localVisit);

            let callbackCount = 0;
            let finalPayload = null;
            const userRef = { path: `users/${profile}-shared-user` };
            const db = {
                collection: () => ({ doc: () => userRef }),
                async runTransaction(callback) {
                    const snapshots = [[baseline], [baseline, remoteVisit]];
                    for (const visits of snapshots) {
                        callbackCount++;
                        let stagedPayload = null;
                        await callback({
                            get: async () => ({
                                exists: true,
                                data: () => ({ visitedPlaces: visits })
                            }),
                            set(_ref, payload) {
                                stagedPayload = payload;
                            }
                        });
                        finalPayload = stagedPayload;
                    }
                }
            };
            window.firebase = {
                auth: () => ({ currentUser: { uid: `${profile}-shared-user` } }),
                firestore: () => db
            };
            window.BARK.services.firebase = realFirebaseService;
            window.BARK.incrementRequestCount = () => {};
            await realFirebaseService.updateCurrentUserVisitedPlaces([localVisit]);

            return {
                profile,
                standalone: navigator.standalone === true || matchMedia('(display-mode: standalone)').matches,
                storageGuard,
                transactionGuard: {
                    callbackCount,
                    finalIds: finalPayload.visitedPlaces.map(visit => visit.id).sort(),
                    localIds: repo.getVisits().map(visit => visit.id).sort()
                }
            };
        } finally {
            Storage.prototype.setItem = realSetItem;
            try {
                Object.defineProperty(navigator, 'geolocation', {
                    configurable: true,
                    value: originalGeolocation
                });
            } catch (_) {}
            window.firebase = realFirebase;
            window.BARK.services.firebase = realFirebaseService;
            repo.clear();
        }
    }, profileName);
}

for (const profile of [
    {
        name: 'installed-ios-pwa',
        browserType: webkit,
        options: devices['iPhone 15 Pro'],
        ios: true
    },
    {
        name: 'installed-android-pwa',
        browserType: chromium,
        options: ANDROID_PWA,
        ios: false
    }
]) {
    test(`${profile.name} fails closed on unsafe storage and preserves another device visit`, async () => {
        const { browser, context, page } = await openInstalledPwa(
            profile.browserType,
            profile.options,
            profile.ios
        );
        try {
            const result = await exerciseIntegrityGuards(page, profile.name);
            expect(result.standalone).toBe(true);
            expect(result.storageGuard).toEqual({
                result: { success: false, error: 'LOCAL_SAFETY_STORAGE_UNAVAILABLE' },
                localVisit: false,
                pending: false,
                attemptedWrites: 0
            });
            expect(result.transactionGuard.callbackCount).toBe(2);
            expect(result.transactionGuard.finalIds).toEqual([
                'baseline',
                `${profile.name}-local`,
                `${profile.name}-remote`
            ].sort());
            expect(result.transactionGuard.localIds).toEqual(result.transactionGuard.finalIds);
        } finally {
            await context.close();
            await browser.close();
        }
    });
}
