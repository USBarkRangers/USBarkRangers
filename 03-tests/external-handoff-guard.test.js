const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadGuard() {
    const context = { URL, window: { BARK: {} } };
    vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, '..', '01-code', 'app', 'modules', 'uiController.js'), 'utf8'),
        context,
        { filename: 'modules/uiController.js' }
    );
    return context.window.BARK.externalHandoffGuard;
}

const currentHref = 'https://usbarkrangers.github.io/USBarkRangers/index.html';

test('cross-origin websites and native-app links are external handoffs', () => {
    const guard = loadGuard();
    [
        { href: 'https://www.nps.gov/acad/index.htm', target: '' },
        { href: 'mailto:support@usbarkrangersmap.com', target: '' },
        { href: 'tel:+15555555555', target: '' },
        { href: 'sms:+15555555555', target: '' }
    ].forEach(destination => {
        assert.equal(guard.isExternalHandoffDestination({ ...destination, currentHref }), true);
    });
});

test('new-window app pages use the Safari overlay return guard', () => {
    const guard = loadGuard();
    assert.equal(guard.isExternalHandoffDestination({
        href: 'pages/privacy.html',
        target: '_blank',
        currentHref
    }), true);
});

test('ordinary internal navigation and inert links stay inside the app', () => {
    const guard = loadGuard();
    [
        { href: 'pages/privacy.html', target: '' },
        { href: '#profile', target: '' },
        { href: 'javascript:void(0)', target: '_blank' }
    ].forEach(destination => {
        assert.equal(guard.isExternalHandoffDestination({ ...destination, currentHref }), false);
    });
});
