'use strict';

const { invalid } = require('./errors');

function object(value, allowed, required = allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid('Expected an object.');
    if (Object.keys(value).some(key => !allowed.includes(key))
        || required.some(key => !Object.hasOwn(value, key))) invalid('Unexpected or missing fields.');
    return value;
}

function text(value, { min = 0, max = 1000, trim = false } = {}) {
    if (typeof value !== 'string' || !value.isWellFormed() || value.length < min || value.length > max
        || (trim && value !== value.trim())) invalid('Invalid text.');
    return value;
}

function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < min || value > max) invalid('Invalid integer.');
    return value;
}

function identifier(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_:-]{0,127}$/.test(value)) invalid('Invalid identifier.');
    return value;
}

function choice(value, allowed) {
    if (!allowed.includes(value)) invalid('Unsupported value.');
    return value;
}

function canonicalJSON(value, depth = 0) {
    if (depth > 16) invalid('Object nesting exceeds the limit.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) invalid('Invalid number.');
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) return `[${value.map(item => canonicalJSON(item, depth + 1)).join(',')}]`;
    if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key], depth + 1)}`).join(',')}}`;
    }
    invalid('Unsupported data type.');
}

module.exports = { object, text, integer, identifier, choice, canonicalJSON };
