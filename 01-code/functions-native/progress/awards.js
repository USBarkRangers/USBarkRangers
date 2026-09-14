'use strict';

const definitions = require('./definitions.json');
const knownStates = new Set(definitions.map(item => item.state).filter(Boolean));
const east = ['ME', 'NH', 'MA', 'RI', 'CT', 'NY', 'NJ', 'DE', 'MD', 'VA', 'NC', 'SC', 'GA', 'FL'];
const west = ['WA', 'OR', 'CA'];

function evaluateAwards(progress, catalog, { visit, marathon = false, first = false, nowMs }) {
    const states = Object.keys(progress.states).filter(key => knownStates.has(key));
    const verifiedStates = Object.keys(progress.verifiedStates).filter(key => knownStates.has(key));
    const parts = visit && !visit.deleted ? Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: visit.timeZone, hourCycle: 'h23', hour: 'numeric', month: 'numeric', day: 'numeric',
    }).formatToParts(visit.happenedAtMs).map(part => [part.type, Number(part.value)])) : null;
    const changes = [];
    for (const item of definitions) {
        let earned = false, verified = false;
        switch (item.rule) {
        case 'visits': earned = progress.sites >= item.target; verified = progress.verifiedSites >= item.target; break;
        case 'states': earned = states.length >= item.target; verified = verifiedStates.length >= item.target; break;
        case 'stateVisits':
            earned = states.some(key => progress.states[key] >= item.target);
            verified = verifiedStates.some(key => progress.verifiedStates[key] >= item.target); break;
        case 'coasts':
            earned = east.some(key => states.includes(key)) && west.some(key => states.includes(key));
            verified = east.some(key => verifiedStates.includes(key)) && west.some(key => verifiedStates.includes(key)); break;
        case 'state': {
            const target = Math.max(1, catalog.stateTotals[item.state] || 0);
            earned = (progress.states[item.state] || 0) >= target;
            verified = (progress.verifiedStates[item.state] || 0) >= target; break;
        }
        case 'complete': earned = catalog.siteCount > 0 && progress.sites >= catalog.siteCount; verified = earned; break;
        case 'rank': earned = first; verified = earned; break;
        case 'marathon': earned = marathon; verified = earned; break;
        case 'night': earned = parts !== null && parts.hour < 4; verified = earned; break;
        case 'early': earned = parts !== null && parts.hour >= 4 && parts.hour < 7; verified = earned; break;
        case 'christmas': earned = parts !== null && parts.month === 12 && parts.day === 25; verified = earned; break;
        }
        const old = progress.awards[item.id];
        if (!earned || old?.tier === 'verified' || (old && !verified)) continue;
        const award = { tier: verified ? 'verified' : 'honor', earnedAtMs: old?.earnedAtMs ?? nowMs };
        progress.awards[item.id] = award;
        changes.push({ id: item.id, name: item.name, ruleVersion: 1, ...award });
    }
    return changes;
}

module.exports = { evaluateAwards };
