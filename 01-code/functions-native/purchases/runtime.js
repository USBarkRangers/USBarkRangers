'use strict';

const { createAppleGateway } = require('./apple');
const { createPurchaseStore } = require('./store');
const { createPurchaseService } = require('./service');

// Secrets are read lazily inside a request, not during Firebase's deployment discovery.
function purchaseRuntime(db, credentials) {
    let service;
    return () => {
        if (!service) {
            const { privateKey: signingKey, keyID, issuerID } = JSON.parse(credentials());
            service = createPurchaseService({ store: createPurchaseStore({ db }),
                apple: createAppleGateway({ signingKey, keyID, issuerID }) });
        }
        return service;
    };
}
function notificationHandler(service, reportFailure) {
    return async (request, response) => {
        if (request.method !== 'POST') { response.status(405).end(); return; }
        if (!Buffer.isBuffer(request.rawBody) || request.rawBody.length > 65_536
            || !request.body || Object.keys(request.body).length !== 1
            || typeof request.body.signedPayload !== 'string') {
            response.status(400).end(); return;
        }
        try {
            await service().notification(request.body.signedPayload);
            response.status(200).end();
        } catch (error) {
            // No receipts, Apple identifiers, payloads or key material in logs.
            reportFailure({ event: 'native-apple-notification-failed',
                reason: error.code === 'invalid-purchase' ? 'invalid-signature-or-contract' : 'retryable' });
            response.status(error.code === 'invalid-purchase' ? 400 : 503).end();
        }
    };
}
module.exports = { purchaseRuntime, notificationHandler };
