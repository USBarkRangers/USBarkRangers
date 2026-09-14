'use strict';

const { createHash } = require('node:crypto');
const validate = require('../shared/validation');
const { NativeError } = require('../shared/errors');

const { ACCEPTANCE_WINDOW_MS, RECEIPT_RETENTION_MS } = require('../shared/syncPolicy');
const MAX_COMMAND_BYTES = 400_000;

function parseEnvelope(input) {
    validate.object(input, ['version', 'operationID', 'createdAtMs', 'kind', 'expectedRevision', 'payload']);
    if (input.version !== 1) throw new NativeError('unsupported-contract', 'Update the app before sending this command.');
    if (typeof input.operationID !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.operationID)) {
        throw new NativeError('invalid', 'Invalid operation identity.');
    }
    validate.integer(input.createdAtMs);
    validate.integer(input.expectedRevision);
    validate.text(input.kind, { min: 1, max: 48 });
    const canonical = validate.canonicalJSON(input);
    if (Buffer.byteLength(canonical, 'utf8') > MAX_COMMAND_BYTES) throw new NativeError('invalid', 'Command is too large.');
    return { command: input, fingerprint: createHash('sha256').update(canonical).digest('hex') };
}

function requireFreshIntent(command, nowMs) {
    if (command.createdAtMs > nowMs + 5 * 60 * 1000) throw new NativeError('invalid', 'Command time is in the future.');
    if (command.createdAtMs < nowMs - ACCEPTANCE_WINDOW_MS) {
        throw new NativeError('intent-expired', 'Retain the draft and reconcile before resubmitting.');
    }
}

function receiptID(uid, operationID) {
    return createHash('sha256').update(`${Buffer.byteLength(uid, 'utf8')}:${uid}${operationID}`).digest('hex');
}

module.exports = { parseEnvelope, requireFreshIntent, receiptID, ACCEPTANCE_WINDOW_MS, RECEIPT_RETENTION_MS, MAX_COMMAND_BYTES };
