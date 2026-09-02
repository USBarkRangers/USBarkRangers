const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(root, '01-code/app/index.html'), 'utf8');
const configSource = fs.readFileSync(path.join(root, '01-code/app/modules/barkConfig.js'), 'utf8');
const authSource = fs.readFileSync(path.join(root, '01-code/app/services/authService.v141.js'), 'utf8');

test('App Check SDK and Enterprise site key are present in the hosted client', () => {
    assert.match(indexSource, /firebase-app-check-compat\.js/);
    assert.match(configSource, /provider:\s*'recaptcha-enterprise'/);
    assert.match(configSource, /siteKey:\s*'6Lci8pYtAAAAANxu0Lr_O27Ax70Pybqk86kF52Oj'/);
    assert.match(configSource, /tokenAutoRefresh:\s*true/);
});

test('App Check activates immediately after Firebase and before other services', () => {
    const initializeIndex = authSource.indexOf('firebase.initializeApp(getEffectiveFirebaseConfig())');
    const appCheckIndex = authSource.indexOf('initializeFirebaseAppCheck();', initializeIndex);
    const persistenceIndex = authSource.indexOf('await ensureLocalAuthPersistence();', initializeIndex);

    assert.ok(initializeIndex >= 0);
    assert.ok(appCheckIndex > initializeIndex);
    assert.ok(persistenceIndex > appCheckIndex);
    assert.match(authSource, /ReCaptchaEnterpriseProvider/);
    assert.match(authSource, /FIREBASE_APPCHECK_DEBUG_TOKEN = true/);
});
