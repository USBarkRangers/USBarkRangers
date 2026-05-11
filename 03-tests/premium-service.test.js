const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPremiumService() {
    const context = {
        window: {
            BARK: {
                services: {}
            }
        },
        URL,
        Date,
        console
    };
    context.window.window = context.window;

    const source = fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'services', 'premiumService.js'), 'utf8');
    vm.runInNewContext(source, context, { filename: 'services/premiumService.js' });
    return context.window.BARK.services.premium;
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
