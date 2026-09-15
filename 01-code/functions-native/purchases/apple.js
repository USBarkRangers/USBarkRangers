'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { SignedDataVerifier, AppStoreServerAPIClient, VerificationStatus } = require('@apple/app-store-server-library');
const { NativeError } = require('../shared/errors');
const policy = require('./policy');

// The pinned official library provides a transport override but no API deadline.
// Abort the actual request (not just a Promise.race) so a stalled Apple connection
// cannot retain this instance's in-flight work indefinitely.
class DeadlineAppleClient extends AppStoreServerAPIClient {
    async makeFetchRequest(path, query, method, body, headers) {
        return fetch(`${this.urlBase}${path}?${query}`, {method,body,headers,signal:AbortSignal.timeout(15_000)});
    }
}

function signedValue(value) {
    if (typeof value !== 'string' || value.length < 20 || value.length > 32_768
        || value.split('.').length !== 3) throw policy.invalidProof();
    return value;
}

function createAppleGateway({ signingKey, keyID, issuerID, clock = Date.now }) {
    const roots = ['AppleRootCA-G2.cer', 'AppleRootCA-G3.cer']
        .map(name => readFileSync(join(__dirname, 'certificates', name)));
    // Never instantiate Apple's XCODE/LOCAL_TESTING verifier: those modes deliberately
    // skip signature checks. Local testing injects a fake gateway ONLY in test code.
    const verifiers = new Map(policy.ENVIRONMENTS.map(environment => [environment,
        new SignedDataVerifier(roots, true, environment, policy.BUNDLE_ID, policy.APP_APPLE_ID)]));
    const clients = new Map();
    const client = environment => {
        if (!verifiers.has(environment)) throw policy.invalidProof();
        if (!signingKey || !keyID || !issuerID) throw new NativeError('unavailable', 'Apple purchase verification is not configured yet.');
        if (!clients.has(environment)) clients.set(environment,
            new DeadlineAppleClient(signingKey, keyID, issuerID, policy.BUNDLE_ID, environment));
        return clients.get(environment);
    };
    async function verify(method, signed) {
        signedValue(signed);
        try { return await verifiers.get('Production')[method](signed); }
        catch (error) {
            if (error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) {
                throw new NativeError('unavailable', 'Apple verification is temporarily unavailable.');
            }
            // Sandbox may omit the production-only numeric app ID. Both paths still
            // verify Apple's signature and exact bundle/environment, never a client hint.
            if (![VerificationStatus.INVALID_ENVIRONMENT, VerificationStatus.INVALID_APP_IDENTIFIER].includes(error.status)) {
                throw policy.invalidProof();
            }
        }
        try { return await verifiers.get('Sandbox')[method](signed); }
        catch (error) {
            if (error.status === VerificationStatus.RETRYABLE_VERIFICATION_FAILURE) {
                throw new NativeError('unavailable', 'Apple verification is temporarily unavailable.');
            }
            throw policy.invalidProof();
        }
    }
    async function proof(signed) {
        return policy.transaction(await verify('verifyAndDecodeTransaction', signed), clock());
    }
    async function current(reference) {
        const environment = reference.environment;
        policy.environmentKey(environment);
        const response = await client(environment).getAllSubscriptionStatuses(policy.transactionID(reference.originalID));
        if (response.bundleId !== policy.BUNDLE_ID || response.environment !== environment
            || (environment === 'Production' && response.appAppleId !== policy.APP_APPLE_ID)
            || !Array.isArray(response.data) || response.data.length > 20) throw policy.invalidProof();
        const verifier = verifiers.get(environment);
        for (const group of response.data) {
            if (!Array.isArray(group.lastTransactions) || group.lastTransactions.length > 100) throw policy.invalidProof();
            for (const item of group.lastTransactions) {
                if (item.originalTransactionId !== reference.originalID) continue;
                const [value, renewal] = await Promise.all([
                    verifier.verifyAndDecodeTransaction(signedValue(item.signedTransactionInfo)),
                    verifier.verifyAndDecodeRenewalInfo(signedValue(item.signedRenewalInfo)),
                ]);
                const state = policy.currentState(value, renewal, item.status, clock());
                if (state.originalID !== reference.originalID || state.appAccountToken !== reference.appAccountToken) {
                    throw policy.invalidProof();
                }
                return state;
            }
        }
        // Do not grant from an old receipt, or turn an unavailable status into Free.
        throw new NativeError('unavailable', 'Apple subscription status is not available yet. Try Restore again shortly.');
    }
    async function notification(signed) {
        const value = await verify('verifyAndDecodeNotification', signed);
        if (value.notificationType === 'TEST') return null;
        if (!value.data?.signedTransactionInfo) return null;
        const reference = await proof(value.data.signedTransactionInfo);
        if (reference.environment !== value.data.environment) throw policy.invalidProof();
        return reference;
    }
    return { proof, current, notification };
}
module.exports = { createAppleGateway, signedValue };
