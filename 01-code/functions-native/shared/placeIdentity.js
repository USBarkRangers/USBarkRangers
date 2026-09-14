'use strict';

const { createHash } = require('node:crypto');
const { object, text } = require('./validation');
const { invalid } = require('./errors');

function component(value) {
    text(value, { min: 1, max: 1024 });
    if (Buffer.byteLength(value, 'utf8') > 1024 || /\p{Cc}/u.test(value)) invalid('Invalid place identity.');
    return value;
}

// Matches BarkDomain.PlaceIdentity: UTF-8 byte lengths, exact case and SHA-256 lowercase hex.
function storageID(identity) {
    object(identity, ['kind', 'id', 'provider'], ['kind', 'id']);
    let parts;
    if (identity.kind === 'official') {
        if (Object.hasOwn(identity, 'provider')) invalid('Official identity has no provider.');
        parts = ['official', component(identity.id)];
    } else if (identity.kind === 'provider') {
        parts = ['provider', component(identity.provider), component(identity.id)];
    } else if (identity.kind === 'custom') {
        if (Object.hasOwn(identity, 'provider')) invalid('Custom identity has no provider.');
        parts = ['custom', component(identity.id)];
    } else invalid('Unknown place identity.');
    return createHash('sha256').update(parts.map(value => `${Buffer.byteLength(value, 'utf8')}:${value}`).join('')).digest('hex');
}

// J1: saved-library membership is independent; creating a trip reference never publishes/stars a pin.
module.exports = { storageID };
