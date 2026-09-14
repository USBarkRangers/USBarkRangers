'use strict';

const { createEntityChangesReader, parseChanges } = require('./entityChanges');
// One day of safety before the 90-day tombstone TTL. Old cursors rebootstrap only
// reconstructible cache; pending commands and local drafts are never part of that cache.
const HORIZON_MS = 89 * 86_400_000;
const createTripChangesReader = db => createEntityChangesReader(db, { collection: 'trips', retentionDays: 89 });
module.exports = { createTripChangesReader, parseChanges, HORIZON_MS };
