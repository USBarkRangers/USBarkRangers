'use strict';

const { HttpsError } = require('firebase-functions/v2/https');
const { NativeError } = require('../shared/errors');
const { MAX_COMMAND_BYTES } = require('../commands/envelope');
const { accountID } = require('../commands/access');

const IOS_APP_ID = '1:360077919845:ios:cd94b1ea6899f95da6e88c';
const HTTP_CODES = Object.freeze({
    invalid: 'invalid-argument', 'unsupported-contract': 'failed-precondition',
    unauthenticated: 'unauthenticated', forbidden: 'permission-denied',
    'premium-required': 'permission-denied', 'account-deleting': 'failed-precondition',
    'account-unavailable': 'failed-precondition', 'intent-expired': 'failed-precondition',
    'operation-reused': 'already-exists', 'rate-limited': 'resource-exhausted', unavailable: 'unavailable',
    'activity-reused': 'already-exists', 'overlapping-activity': 'failed-precondition',
    'incomplete-expedition': 'failed-precondition',
});

// The SDK verifies bearer tokens and App Check before this adapter; never accept uid in data.
// Keep handler input bounded before canonicalization or transaction reads. Callable JSON has
// a small transport wrapper around the strictly bounded logical command.
function verifiedAccount(request, runtime) {
    const auth = request.auth;
    if (!auth || auth.token?.aud !== runtime.projectID
        || auth.token.iss !== `https://securetoken.google.com/${runtime.projectID}`
        || auth.token.firebase?.sign_in_provider === 'anonymous') {
        throw new NativeError('unauthenticated', 'Sign in to a Bark account.');
    }
    if (!runtime.emulator && request.app?.appId !== IOS_APP_ID) {
        throw new NativeError('forbidden', 'Use the registered Bark Ranger iOS app.');
    }
    if (!Buffer.isBuffer(request.rawRequest?.rawBody)
        || request.rawRequest.rawBody.length > MAX_COMMAND_BYTES + 1024) {
        throw new NativeError('invalid', 'Command is too large or malformed.');
    }
    return accountID(auth.uid);
}

function createCommandCallable({ runtime, execute, reportFailure }) {
    return async request => {
        try {
            const uid = verifiedAccount(request, runtime);
            return await execute(uid, request.data);
        } catch (error) {
            if (error instanceof NativeError && Object.hasOwn(HTTP_CODES, error.code)) {
                throw new HttpsError(HTTP_CODES[error.code], error.message, error.details);
            }
            // Do not log request content, auth tokens, profile data or arbitrary SDK errors.
            reportFailure?.({ event: 'native-command-failed', reason: 'internal' });
            throw new HttpsError('unavailable', 'Retry this saved operation shortly.',
                { contractVersion: 1, reason: 'unavailable' });
        }
    };
}

module.exports = { createCommandCallable, verifiedAccount, IOS_APP_ID };
