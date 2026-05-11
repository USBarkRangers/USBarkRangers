const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createClassList() {
    const classes = new Set();
    return {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        toggle(name, force) {
            if (force === true) {
                classes.add(name);
                return true;
            }
            if (force === false) {
                classes.delete(name);
                return false;
            }
            if (classes.has(name)) {
                classes.delete(name);
                return false;
            }
            classes.add(name);
            return true;
        },
        contains: name => classes.has(name)
    };
}

function createElement(id) {
    const listeners = new Map();
    return {
        id,
        value: '',
        textContent: '',
        hidden: false,
        dataset: {},
        style: {},
        attributes: {},
        classList: createClassList(),
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(handler);
        },
        setAttribute(name, value) {
            this.attributes[name] = String(value);
        },
        getAttribute(name) {
            return this.attributes[name];
        },
        focus() {
            this.focused = true;
        },
        scrollIntoView() {
            this.scrolled = true;
        },
        async dispatch(type) {
            const event = {
                target: this,
                preventDefault() {
                    event.defaultPrevented = true;
                },
                defaultPrevented: false
            };
            for (const handler of listeners.get(type) || []) {
                await handler(event);
            }
            return event;
        }
    };
}

function createDocument(ids) {
    const elements = new Map(ids.map(id => [id, createElement(id)]));
    return {
        readyState: 'complete',
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, createElement(id));
            return elements.get(id);
        },
        querySelector() {
            return null;
        },
        addEventListener() {},
        element(id) {
            return elements.get(id);
        }
    };
}

function loadAuthAccountUi(overrides = {}) {
    const ids = [
        'account-auth-message',
        'account-status-card',
        'account-display-name',
        'account-display-email',
        'account-display-uid',
        'account-display-provider',
        'account-display-premium',
        'account-email-verification-panel',
        'account-email-verification-eyebrow',
        'account-email-verification-title',
        'account-email-verification-copy',
        'account-resend-verification-btn',
        'account-refresh-verification-btn',
        'account-billing-panel',
        'account-billing-eyebrow',
        'account-billing-title',
        'account-billing-copy',
        'account-manage-subscription-btn',
        'account-signin-form',
        'account-create-form',
        'account-reset-form',
        'account-signin-email',
        'account-signin-password',
        'account-create-username',
        'account-create-email',
        'account-create-password',
        'account-reset-email',
        'account-mode-signin',
        'account-mode-create',
        'account-mode-reset',
        'account-forgot-password-btn',
        'account-inline-create-btn',
        'account-signout-btn',
        'account-switch-btn',
        'account-gate-close-btn',
        'account-gate-primary-btn',
        'account-gate-secondary-btn',
        'account-gate-overlay',
        'login-container',
        'google-login-btn',
        'user-profile-name'
    ];
    const document = createDocument(ids);
    const writes = [];
    const createCalls = [];
    const signInCalls = [];
    const updateProfileCalls = [];
    const verificationEmails = [];
    const reloadCalls = [];
    const tokenRefreshCalls = [];
    const portalCalls = [];
    const alertCalls = [];
    const user = {
        uid: 'uid-123',
        email: '',
        displayName: '',
        emailVerified: overrides.emailVerified === true,
        providerData: overrides.providerData || [{ providerId: 'password' }],
        async updateProfile(profile) {
            updateProfileCalls.push({ ...profile });
            Object.assign(user, profile);
        },
        async sendEmailVerification() {
            verificationEmails.push({ uid: user.uid, email: user.email });
            if (overrides.sendVerificationError) throw overrides.sendVerificationError;
        },
        async reload() {
            reloadCalls.push({ uid: user.uid });
            if (Object.prototype.hasOwnProperty.call(overrides, 'reloadEmailVerified')) {
                user.emailVerified = overrides.reloadEmailVerified === true;
            }
        },
        async getIdToken(forceRefresh) {
            tokenRefreshCalls.push({ uid: user.uid, forceRefresh });
            return 'test-id-token';
        }
    };
    const auth = {
        currentUser: null,
        async createUserWithEmailAndPassword(email, password) {
            createCalls.push({ email, password });
            if (overrides.createError) throw overrides.createError;
            user.email = email;
            auth.currentUser = user;
            return { user };
        },
        async signInWithEmailAndPassword(email, password) {
            signInCalls.push({ email, password });
            user.email = email;
            auth.currentUser = user;
            return { user };
        },
        async sendPasswordResetEmail() {},
        async signOut() {
            auth.currentUser = null;
        },
        onAuthStateChanged() {}
    };
    const firestore = function firestore() {
        return {
            collection(collectionName) {
                return {
                    doc(docId) {
                        return {
                            async set(payload, options) {
                                writes.push({ collectionName, docId, payload, options });
                            }
                        };
                    }
                };
            }
        };
    };
    firestore.FieldValue = {
        serverTimestamp() {
            return '__server_timestamp__';
        }
    };
    const locationAssignCalls = [];
    const premiumEntitlement = overrides.premiumEntitlement || {
        premium: false,
        status: 'free',
        source: 'none',
        providerCustomerId: null,
        providerSubscriptionId: null
    };
    const premiumService = overrides.premiumService || {
        getEntitlement: () => ({ ...premiumEntitlement }),
        isPremium: () => Boolean(overrides.premiumActive),
        subscribe: () => {}
    };
    const hasCustomerPortalMock = Object.prototype.hasOwnProperty.call(overrides, 'customerPortalUrl') ||
        Object.prototype.hasOwnProperty.call(overrides, 'customerPortalData') ||
        Boolean(overrides.customerPortalError);

    const context = {
        window: {
            BARK: {
                services: {
                    premium: premiumService
                },
                incrementRequestCount() {}
            },
            location: {
                href: 'https://outswarming.github.io/bark-ranger-map/',
                assign(url) {
                    locationAssignCalls.push(url);
                }
            },
            alert(message) {
                alertCalls.push(message);
            }
        },
        document,
        firebase: {
            apps: [{}],
            auth: () => auth,
            firestore,
            functions: hasCustomerPortalMock ? () => ({
                httpsCallable(name) {
                    return async (payload) => {
                        portalCalls.push({ name, payload });
                        if (name !== 'getCustomerPortalUrl') throw new Error(`Unexpected callable ${name}`);
                        if (overrides.customerPortalError) throw overrides.customerPortalError;
                        const data = Object.prototype.hasOwnProperty.call(overrides, 'customerPortalData')
                            ? overrides.customerPortalData
                            : {
                                url: overrides.customerPortalUrl,
                                customerPortalUrl: overrides.customerPortalUrl,
                                entitlement: overrides.customerPortalEntitlement || null
                            };
                        return {
                            data
                        };
                    };
                }
            }) : undefined
        },
        console: {
            ...console,
            error() {},
            log() {},
            warn() {}
        },
        URL,
        setTimeout: (callback) => callback(),
        Date
    };
    context.window.window = context.window;

    const source = fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'services', 'authAccountUi.js'), 'utf8');
    vm.runInNewContext(source, context, { filename: 'services/authAccountUi.js' });

    return {
        window: context.window,
        document,
        auth,
        user,
        createCalls,
        signInCalls,
        updateProfileCalls,
        verificationEmails,
        reloadCalls,
        tokenRefreshCalls,
        portalCalls,
        alertCalls,
        locationAssignCalls,
        writes,
        element: id => document.element(id)
    };
}

test('email account creation requires and saves a username', async () => {
    const harness = loadAuthAccountUi();

    harness.element('account-create-username').value = '  Trail   Boss  ';
    harness.element('account-create-email').value = 'new@example.com';
    harness.element('account-create-password').value = 'password123';

    await harness.element('account-create-form').dispatch('submit');

    assert.deepEqual(harness.createCalls, [{ email: 'new@example.com', password: 'password123' }]);
    assert.deepEqual(harness.updateProfileCalls, [{ displayName: 'Trail Boss' }]);
    assert.equal(harness.auth.currentUser.displayName, 'Trail Boss');
    assert.equal(harness.element('account-display-name').textContent, 'Trail Boss');
    assert.equal(harness.element('user-profile-name').textContent, 'Trail Boss');
    assert.equal(harness.element('account-auth-message').dataset.tone, 'success');

    assert.ok(harness.writes.length >= 1);
    assert.equal(harness.writes[0].collectionName, 'users');
    assert.equal(harness.writes[0].docId, 'uid-123');
    assert.equal(harness.writes[0].options.merge, true);
    assert.equal(harness.writes[0].payload.displayName, 'Trail Boss');
    assert.equal(harness.writes[0].payload.username, 'Trail Boss');
    assert.equal(harness.writes[0].payload.email, 'new@example.com');
});

test('duplicate signup email points users back to existing account paths', async () => {
    const duplicateError = new Error('email exists');
    duplicateError.code = 'auth/email-already-in-use';
    const harness = loadAuthAccountUi({ createError: duplicateError });

    harness.element('account-create-username').value = 'Trail Boss';
    harness.element('account-create-email').value = 'taken@example.com';
    harness.element('account-create-password').value = 'password123';

    await harness.element('account-create-form').dispatch('submit');

    assert.equal(harness.element('account-auth-message').dataset.tone, 'error');
    assert.match(harness.element('account-auth-message').textContent, /already has a B\.A\.R\.K\. account/);
    assert.equal(harness.element('account-signin-email').value, 'taken@example.com');
    assert.equal(harness.element('account-reset-email').value, 'taken@example.com');
    assert.equal(harness.updateProfileCalls.length, 0);
    assert.equal(harness.writes.length, 0);
});

test('lemon squeezy premium account opens a fresh customer portal URL', async () => {
    const harness = loadAuthAccountUi({
        premiumActive: true,
        customerPortalUrl: 'https://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh',
        premiumEntitlement: {
            premium: true,
            status: 'active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_test',
            providerSubscriptionId: 'sub_test',
            currentPeriodEnd: '2027-05-02T12:00:00.000Z'
        }
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'paid-user',
        email: 'paid@example.com',
        displayName: 'Paid Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();

    assert.equal(harness.element('account-billing-panel').hidden, false);
    assert.equal(harness.element('account-billing-eyebrow').textContent, 'SUBSCRIPTION');
    assert.equal(harness.element('account-billing-title').textContent, 'Active');
    assert.equal(harness.element('account-billing-copy').textContent, 'Auto-renews May 2, 2027');
    assert.equal(harness.element('account-manage-subscription-btn').textContent, 'Manage');
    assert.equal(harness.element('account-manage-subscription-btn').dataset.billingUrl, undefined);

    await harness.element('account-manage-subscription-btn').dispatch('click');
    assert.equal(harness.portalCalls.at(-1).name, 'getCustomerPortalUrl');
    assert.equal(Object.keys(harness.portalCalls.at(-1).payload).length, 0);
    assert.deepEqual(harness.locationAssignCalls, [
        'https://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh'
    ]);
    assert.deepEqual(harness.alertCalls, [
        'Billing portal URL:\nhttps://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh'
    ]);
});

test('active lemon account refresh syncs cancelled billing status from callable', async () => {
    let currentEntitlement = {
        premium: true,
        status: 'active',
        source: 'lemon_squeezy',
        providerCustomerId: 'cus_test',
        providerSubscriptionId: 'sub_cancelled_sync',
        currentPeriodEnd: '2027-05-02T12:00:00.000Z'
    };
    const setEntitlementCalls = [];
    const harness = loadAuthAccountUi({
        premiumActive: true,
        customerPortalUrl: 'https://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh',
        customerPortalEntitlement: {
            premium: true,
            status: 'cancelled_active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_test',
            providerSubscriptionId: 'sub_cancelled_sync',
            currentPeriodEnd: '2027-05-02T12:00:00.000Z'
        },
        premiumService: {
            getEntitlement: () => ({ ...currentEntitlement }),
            isPremium: () => currentEntitlement.premium === true,
            subscribe: () => {},
            setEntitlement(entitlement, options) {
                currentEntitlement = { ...entitlement };
                setEntitlementCalls.push({ entitlement, options });
            }
        }
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'paid-user',
        email: 'paid@example.com',
        displayName: 'Paid Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(harness.portalCalls.length, 1);
    assert.equal(harness.portalCalls[0].payload.syncOnly, true);
    assert.equal(setEntitlementCalls.length, 1);
    assert.equal(setEntitlementCalls[0].entitlement.status, 'cancelled_active');
    assert.equal(setEntitlementCalls[0].options.reason, 'billing-panel-sync');
});

test('cancelled lemon account refresh syncs resumed billing status from callable', async () => {
    let currentEntitlement = {
        premium: true,
        status: 'cancelled_active',
        source: 'lemon_squeezy',
        providerCustomerId: 'cus_test',
        providerSubscriptionId: 'sub_resumed_sync',
        currentPeriodEnd: '2027-05-02T12:00:00.000Z'
    };
    const setEntitlementCalls = [];
    const harness = loadAuthAccountUi({
        premiumActive: true,
        customerPortalUrl: 'https://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh',
        customerPortalEntitlement: {
            premium: true,
            status: 'active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_test',
            providerSubscriptionId: 'sub_resumed_sync',
            currentPeriodEnd: '2027-05-02T12:00:00.000Z'
        },
        premiumService: {
            getEntitlement: () => ({ ...currentEntitlement }),
            isPremium: () => currentEntitlement.premium === true,
            subscribe: () => {},
            setEntitlement(entitlement, options) {
                currentEntitlement = { ...entitlement };
                setEntitlementCalls.push({ entitlement, options });
            }
        }
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'paid-user',
        email: 'paid@example.com',
        displayName: 'Paid Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(harness.portalCalls.length, 1);
    assert.equal(harness.portalCalls[0].payload.syncOnly, true);
    assert.equal(setEntitlementCalls.length, 1);
    assert.equal(setEntitlementCalls[0].entitlement.status, 'active');
    assert.equal(setEntitlementCalls[0].options.reason, 'billing-panel-sync');
});

test('cancelled Lemon subscription shows access end date and no auto-renew', async () => {
    const harness = loadAuthAccountUi({
        premiumActive: true,
        premiumEntitlement: {
            premium: true,
            status: 'cancelled_active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_cancelled',
            providerSubscriptionId: 'sub_cancelled',
            currentPeriodEnd: '2027-05-09T12:00:00.000Z',
            customerPortalUrl: 'https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=stored',
            autoRenew: false
        },
        customerPortalUrl: 'https://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh'
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'cancelled-user',
        email: 'cancelled@example.com',
        displayName: 'Cancelled Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(harness.element('account-billing-panel').hidden, false);
    assert.equal(harness.element('account-billing-title').textContent, 'Premium cancelled');
    assert.match(harness.element('account-billing-copy').textContent, /Access ends:/);
    assert.match(harness.element('account-billing-copy').textContent, /2027/);
    assert.match(harness.element('account-billing-copy').textContent, /Auto-renew: No/);
    assert.equal(harness.element('account-manage-subscription-btn').dataset.billingUrl, undefined);
    assert.equal(harness.portalCalls.length, 1);
    assert.equal(harness.portalCalls[0].name, 'getCustomerPortalUrl');
    assert.equal(harness.portalCalls[0].payload.syncOnly, true);

    await harness.element('account-manage-subscription-btn').dispatch('click');

    assert.equal(harness.portalCalls.length, 2);
    assert.equal(harness.portalCalls[1].name, 'getCustomerPortalUrl');
    assert.deepEqual(Object.keys(harness.portalCalls[1].payload), []);
    assert.deepEqual(harness.locationAssignCalls, [
        'https://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh'
    ]);
    assert.deepEqual(harness.alertCalls, [
        'Billing portal URL:\nhttps://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh'
    ]);
});

test('manage subscription does not fall back to a stored portal URL when callable has no URL', async () => {
    const harness = loadAuthAccountUi({
        premiumActive: true,
        premiumEntitlement: {
            premium: true,
            status: 'cancelled_active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_cancelled',
            providerSubscriptionId: 'sub_cancelled',
            currentPeriodEnd: '2027-05-09T12:00:00.000Z',
            customerPortalUrl: 'https://usbarkrangers.lemonsqueezy.com/billing?expires=2099999999&signature=stored'
        },
        customerPortalData: { entitlement: null }
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'cancelled-user',
        email: 'cancelled@example.com',
        displayName: 'Cancelled Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();
    await Promise.resolve();
    await Promise.resolve();
    await harness.element('account-manage-subscription-btn').dispatch('click');

    assert.equal(harness.portalCalls.length, 2);
    assert.deepEqual(harness.locationAssignCalls, []);
    assert.deepEqual(harness.alertCalls, ['Billing portal URL:\nundefined']);
    assert.equal(
        harness.element('account-auth-message').textContent,
        'No customer portal is available for this subscription.'
    );
});

test('manage subscription rejects Lemon storefront root URL before redirect', async () => {
    const harness = loadAuthAccountUi({
        premiumActive: true,
        premiumEntitlement: {
            premium: true,
            status: 'active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_root',
            providerSubscriptionId: 'sub_root'
        },
        customerPortalUrl: 'https://usbarkrangers.lemonsqueezy.com/'
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'root-url-user',
        email: 'root@example.com',
        displayName: 'Root URL Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();
    await harness.element('account-manage-subscription-btn').dispatch('click');

    assert.deepEqual(harness.locationAssignCalls, []);
    assert.deepEqual(harness.alertCalls, ['Billing portal URL:\nhttps://usbarkrangers.lemonsqueezy.com/']);
    assert.equal(
        harness.element('account-auth-message').textContent,
        'Billing portal returned an invalid store URL. Please contact support.'
    );
});

test('manage subscription shows dashboard message for blocked Lemon test portal', async () => {
    const testPortalUrl = 'https://usbarkrangers.lemonsqueezy.com/billing?expires=2100000000&signature=fresh&store_domain=usbarkrangers.lemonsqueezy.com&test_mode=1&user=123';
    const harness = loadAuthAccountUi({
        premiumActive: true,
        premiumEntitlement: {
            premium: true,
            status: 'active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_test_mode',
            providerSubscriptionId: 'sub_test_mode'
        },
        customerPortalUrl: testPortalUrl
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'test-mode-user',
        email: 'test-mode@example.com',
        displayName: 'Test Mode Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();
    await harness.element('account-manage-subscription-btn').dispatch('click');

    assert.deepEqual(harness.locationAssignCalls, []);
    assert.deepEqual(harness.alertCalls, [`Billing portal URL:\n${testPortalUrl}`]);
    assert.equal(
        harness.element('account-auth-message').textContent,
        'Customer portal is unavailable while the Lemon Squeezy store is not activated. Manage this test subscription from the Lemon Squeezy dashboard.'
    );
});

test('manage subscription shows friendly message when no active subscription exists', async () => {
    const error = new Error('No active subscription was found for this account.');
    error.code = 'functions/failed-precondition';
    const harness = loadAuthAccountUi({
        premiumActive: true,
        premiumEntitlement: {
            premium: true,
            status: 'cancelled_active',
            source: 'lemon_squeezy',
            providerCustomerId: 'cus_missing',
            providerSubscriptionId: 'sub_missing'
        },
        customerPortalError: error
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'missing-subscription-user',
        email: 'missing@example.com',
        displayName: 'Missing Subscription Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();
    await harness.element('account-manage-subscription-btn').dispatch('click');

    assert.deepEqual(harness.locationAssignCalls, []);
    assert.equal(
        harness.element('account-auth-message').textContent,
        'No active subscription was found for this account.'
    );
});

test('expired and refunded Lemon subscriptions show inactive billing states', () => {
    for (const [status, expectedTitle, expectedCopy] of [
        ['expired', 'Premium inactive', /Premium is inactive/],
        ['refunded', 'Subscription refunded', /Premium is inactive after a refund/]
    ]) {
        const harness = loadAuthAccountUi({
            premiumActive: false,
            premiumEntitlement: {
                premium: false,
                status,
                source: 'lemon_squeezy',
                providerCustomerId: `cus_${status}`,
                providerSubscriptionId: `sub_${status}`
            }
        });
        harness.auth.currentUser = {
            ...harness.user,
            uid: `${status}-user`,
            email: `${status}@example.com`,
            displayName: `${status} Ranger`,
            providerData: [{ providerId: 'google.com' }]
        };

        harness.window.BARK.authAccountUi.refreshAccountDisplay();

        assert.equal(harness.element('account-display-premium').textContent, status === 'expired' ? 'Premium expired' : 'Premium refunded');
        assert.equal(harness.element('account-billing-panel').hidden, false);
        assert.equal(harness.element('account-billing-title').textContent, expectedTitle);
        assert.match(harness.element('account-billing-copy').textContent, expectedCopy);
    }
});

test('manual premium account shows support-managed billing instead of fake portal', () => {
    const harness = loadAuthAccountUi({
        premiumActive: true,
        premiumEntitlement: {
            premium: true,
            status: 'manual_active',
            source: 'admin_override',
            manualOverride: true
        }
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'manual-user',
        email: 'manual@example.com',
        displayName: 'Manual Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();

    assert.equal(harness.element('account-billing-panel').hidden, false);
    assert.equal(harness.element('account-billing-title').textContent, 'Managed by support');
    assert.match(harness.element('account-billing-copy').textContent, /no Lemon Squeezy subscription/);
    assert.equal(harness.element('account-manage-subscription-btn').textContent, 'Contact support');
    assert.equal(harness.element('account-manage-subscription-btn').dataset.mode, 'support');
});

test('access-code premium account hides manage billing and shows no auto-renew/payment method', () => {
    const harness = loadAuthAccountUi({
        premiumActive: true,
        premiumEntitlement: {
            premium: true,
            status: 'access_code_active',
            source: 'access_code',
            accessCodeAudience: 'admin_mod',
            expiresAt: '2027-05-09T12:00:00.000Z',
            autoRenew: false,
            paymentMethodAttached: false
        }
    });
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'access-code-user',
        email: 'access@example.com',
        displayName: 'Access Ranger',
        providerData: [{ providerId: 'google.com' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();

    assert.equal(harness.element('account-display-premium').textContent, 'Free Premium Access');
    assert.equal(harness.element('account-billing-panel').hidden, false);
    assert.equal(harness.element('account-billing-title').textContent, 'Admin/mod complimentary access');
    assert.match(harness.element('account-billing-copy').textContent, /Auto-renew: No/);
    assert.match(harness.element('account-billing-copy').textContent, /Payment method: None/);
    assert.equal(harness.element('account-manage-subscription-btn').hidden, true);
});

test('new email/password account sends verification email and shows verification sent status', async () => {
    const harness = loadAuthAccountUi();

    harness.element('account-create-username').value = 'Trail Boss';
    harness.element('account-create-email').value = 'verify@example.com';
    harness.element('account-create-password').value = 'password123';

    await harness.element('account-create-form').dispatch('submit');

    assert.deepEqual(harness.verificationEmails, [{ uid: 'uid-123', email: 'verify@example.com' }]);
    assert.equal(harness.element('account-email-verification-panel').hidden, false);
    assert.equal(harness.element('account-email-verification-title').textContent, 'Email verification sent');
    assert.match(harness.element('account-auth-message').textContent, /Email verification sent/);
});

test('unverified email/password user sees verification banner', () => {
    const harness = loadAuthAccountUi();
    harness.auth.currentUser = {
        ...harness.user,
        uid: 'unverified-user',
        email: 'unverified@example.com',
        emailVerified: false,
        providerData: [{ providerId: 'password' }]
    };

    harness.window.BARK.authAccountUi.refreshAccountDisplay();

    assert.equal(harness.element('account-email-verification-panel').hidden, false);
    assert.equal(harness.element('account-email-verification-eyebrow').textContent, 'Please verify your email');
    assert.match(harness.element('account-email-verification-copy').textContent, /Premium checkout/);
});

test('resend verification button sends once and respects cooldown', async () => {
    const harness = loadAuthAccountUi();
    Object.assign(harness.user, {
        uid: 'cooldown-user',
        email: 'cooldown@example.com',
        emailVerified: false,
        providerData: [{ providerId: 'password' }]
    });
    harness.auth.currentUser = harness.user;
    harness.window.BARK.authAccountUi.refreshAccountDisplay();

    await harness.element('account-resend-verification-btn').dispatch('click');
    await harness.element('account-resend-verification-btn').dispatch('click');

    assert.deepEqual(harness.verificationEmails, [{ uid: 'cooldown-user', email: 'cooldown@example.com' }]);
    assert.equal(harness.element('account-resend-verification-btn').disabled, true);
    assert.match(harness.element('account-resend-verification-btn').textContent, /Resend in/);
});

test('verified user hides warning after refresh status reload', async () => {
    const harness = loadAuthAccountUi({ reloadEmailVerified: true });
    Object.assign(harness.user, {
        uid: 'verified-refresh-user',
        email: 'verified@example.com',
        emailVerified: false,
        providerData: [{ providerId: 'password' }]
    });
    harness.auth.currentUser = harness.user;
    harness.window.BARK.authAccountUi.refreshAccountDisplay();
    assert.equal(harness.element('account-email-verification-panel').hidden, false);

    await harness.element('account-refresh-verification-btn').dispatch('click');

    assert.equal(harness.element('account-email-verification-panel').hidden, true);
    assert.equal(harness.reloadCalls.length, 1);
    assert.deepEqual(harness.tokenRefreshCalls, [{ uid: 'verified-refresh-user', forceRefresh: true }]);
    assert.match(harness.element('account-auth-message').textContent, /Email verified/);
});
