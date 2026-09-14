'use strict';

// Counts actual returned document reads (including empty queries), and attempted
// document writes, including transaction retries. Not a Firestore billing estimate:
// aggregate index entries, network latency and security-rule reads are separate.
function meter(db, observe = () => {}) {
    const events = [];
    const record = event => { events.push(event); observe(event); };
    const originals = new WeakMap(), wrappers = new WeakMap();
    const unwrap = value => originals.get(value) ?? value;
    const read = (source, result) => {
        record({ type: 'read', path: source.path ?? 'query', count: Math.max(1, result.docs?.length ?? 1) });
        return result;
    };
    function wrap(value) {
        if (!value || typeof value !== 'object') return value;
        if (wrappers.has(value)) return wrappers.get(value);
        const proxy = new Proxy(value, { get(target, key) {
            if (key === 'runTransaction') return (work, options) => target.runTransaction(tx => work(new Proxy(tx, {
                get(transaction, method) {
                    if (method === 'get') return async ref => read(unwrap(ref), await transaction.get(unwrap(ref)));
                    if (method === 'getAll') return async (...refs) => {
                        const rows = await transaction.getAll(...refs.map(unwrap));
                        return rows.map((row, i) => read(unwrap(refs[i]), row));
                    };
                    if (['set', 'create', 'update', 'delete'].includes(method)) return (ref, ...args) => {
                        record({ type: 'write', path: ref.path, count: 1 });
                        return transaction[method](unwrap(ref), ...args);
                    };
                    return typeof transaction[method] === 'function' ? transaction[method].bind(transaction) : transaction[method];
                },
            })), options);
            if (key === 'get') return async (...args) => read(target, await target.get(...args));
            const member = target[key];
            if (typeof member !== 'function') return member;
            return (...args) => {
                const result = member.apply(target, args.map(unwrap));
                return result && typeof result.get === 'function' ? wrap(result) : result;
            };
        } });
        originals.set(proxy, value); wrappers.set(value, proxy);
        return proxy;
    }
    return { db: wrap(db), events, reset() { events.length = 0; }, totals() {
        return { reads: events.filter(e => e.type === 'read').reduce((n, e) => n + e.count, 0),
            writes: events.filter(e => e.type === 'write').reduce((n, e) => n + e.count, 0) };
    } };
}
module.exports = { meter };
