'use strict';

const { Timestamp } = require('firebase-admin/firestore');
const v = require('../shared/validation');

function serverTime(value) { return { seconds: value.seconds, nanoseconds: value.nanoseconds }; }
function timestamp(value) {
    v.object(value, ['seconds', 'nanoseconds']);
    v.integer(value.seconds, -62_135_596_800, 253_402_300_799);
    v.integer(value.nanoseconds, 0, 999_999_999);
    return new Timestamp(value.seconds, value.nanoseconds);
}
function encode(value) {
    if (value instanceof Timestamp) return serverTime(value);
    if (Array.isArray(value)) return value.map(encode);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
    return value;
}
module.exports = { serverTime, timestamp, encode };
