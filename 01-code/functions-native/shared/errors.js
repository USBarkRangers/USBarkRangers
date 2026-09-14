'use strict';

class NativeError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'NativeError';
        this.code = code;
        this.details = { contractVersion: 1, reason: code, ...details };
    }
}

function invalid(message) { throw new NativeError('invalid', message); }

module.exports = { NativeError, invalid };
