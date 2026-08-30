const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPremiumService(options = {}) {
    const storage = options.storage || new Map();
    const context = {
        window: {
            BARK: {
                services: {}
            }
        },
        URL,
        Date,
        console,
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        }
    };
    if (options.firebaseUid !== undefined) {
        context.firebase = {
            auth() {
                return {
                    currentUser: options.firebaseUid ? { uid: options.firebaseUid } : null
                };
            }
        };
    }
    context.window.window = context.window;

    const source = fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'services', 'premiumService.js'), 'utf8');
    vm.runInNewContext(source, context, { filename: 'services/premiumService.js' });
    const service = context.window.BARK.services.premium;
    service.__testStorage = storage;
    service.__testWindow = context.window;
    return service;
}

test('premiumService does not retain signed Lemon customer portal URLs', () => {
    const premiumService = loadPremiumService();
    const portalUrl = 'https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=stored';
    const endsAt = '2027-05-09T12:00:00.000Z';

    const entitlement = premiumService.setEntitlement({
        premium: true,
        status: 'cancelled_active',
        source: 'lemon_squeezy',
        providerCustomerId: 'cus_test',
        providerSubscriptionId: 'sub_test',
        currentPeriodEnd: null,
        customerPortalUrl: portalUrl,
        endsAt
    }, {
        uid: 'paid-user',
        reason: 'test'
    });

    assert.equal(entitlement.customerPortalUrl, undefined);
    assert.equal(entitlement.endsAt, endsAt);
    assert.equal(premiumService.getEntitlement().customerPortalUrl, undefined);
});

test('premiumService ignores unsafe customer portal URLs', () => {
    const premiumService = loadPremiumService();

    const entitlement = premiumService.setEntitlement({
        premium: true,
        status: 'active',
        source: 'lemon_squeezy',
        providerSubscriptionId: 'sub_test',
        customerPortalUrl: 'javascript:alert(1)'
    }, {
        uid: 'paid-user',
        reason: 'test'
    });

    assert.equal(entitlement.customerPortalUrl, undefined);
});

test('premiumService treats paused Lemon subscriptions as active premium', () => {
    const premiumService = loadPremiumService();

    premiumService.setEntitlement({
        premium: true,
        status: 'paused',
        source: 'lemon_squeezy',
        providerSubscriptionId: 'sub_paused'
    }, {
        uid: null,
        reason: 'test'
    });

    assert.equal(premiumService.isPremium(), true);
    assert.equal(premiumService.getEntitlement().status, 'paused');
});

test('premiumService restores a recent authoritative Premium session without Firebase', () => {
    const storage = new Map();
    const onlineService = loadPremiumService({ storage, firebaseUid: 'paid-user' });
    assert.equal(onlineService.rememberAuthoritativeOfflineSession({
        premium: true,
        status: 'active',
        source: 'lemon_squeezy',
        currentPeriodEnd: Date.now() + 7 * 24 * 60 * 60 * 1000
    }, {
        uid: 'paid-user',
        displayName: 'Premium Tester',
        email: 'premium@example.com'
    }), true);

    const offlineService = loadPremiumService({ storage });
    offlineService.__testWindow._authStateResolved = false;
    const restored = offlineService.restoreOfflineSession();

    assert.equal(restored.uid, 'paid-user');
    assert.equal(restored.displayName, 'Premium Tester');
    assert.equal(offlineService.isPremium(), true);
    assert.equal(offlineService.getDebugState().offlineSessionActive, true);
});

test('premiumService refuses an expired offline Premium entitlement', () => {
    const storage = new Map();
    storage.set('bark.offlinePremiumSession.v1', JSON.stringify({
        uid: 'expired-user',
        cachedAt: Date.now(),
        entitlement: {
            premium: true,
            status: 'cancelled_active',
            source: 'lemon_squeezy',
            endsAt: Date.now() - 1000
        }
    }));

    const premiumService = loadPremiumService({ storage });
    assert.equal(premiumService.restoreOfflineSession(), null);
    assert.equal(premiumService.isPremium(), false);
    assert.equal(storage.has('bark.offlinePremiumSession.v1'), false);
});

test('authoritative free entitlement clears only the matching offline session', () => {
    const storage = new Map();
    const premiumService = loadPremiumService({ storage, firebaseUid: 'paid-user' });
    premiumService.rememberAuthoritativeOfflineSession({
        premium: true,
        status: 'active',
        source: 'lemon_squeezy'
    }, { uid: 'paid-user' });

    assert.equal(premiumService.rememberAuthoritativeOfflineSession({
        premium: false,
        status: 'free',
        source: 'none'
    }, { uid: 'paid-user' }), false);
    assert.equal(storage.has('bark.offlinePremiumSession.v1'), false);
});

test('offline Premium cache cannot unlock a different authenticated UID', () => {
    const storage = new Map();
    const originalService = loadPremiumService({ storage, firebaseUid: 'paid-user' });
    originalService.rememberAuthoritativeOfflineSession({
        premium: true,
        status: 'active',
        source: 'lemon_squeezy'
    }, { uid: 'paid-user' });

    const otherAccountService = loadPremiumService({ storage, firebaseUid: 'different-user' });
    otherAccountService.__testWindow._authStateResolved = true;
    assert.equal(otherAccountService.restoreOfflineSession().uid, 'paid-user');
    assert.equal(otherAccountService.isPremium(), false);
});
