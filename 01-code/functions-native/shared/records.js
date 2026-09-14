'use strict';

const { NativeError } = require('./errors');

function revision(record) {
    if (!record) return 0;
    if (record.schemaVersion !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1) {
        throw new NativeError('unsupported-contract', 'This record requires a compatible app.');
    }
    return record.revision;
}
function nextRevision(value) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
        throw new NativeError('unsupported-contract', 'Record revision is unavailable.');
    }
    return value + 1;
}

module.exports = { revision, nextRevision };
