/**
 * Covers leaderboardEngine's loading and paging.
 *
 * These exist because loadLeaderboard and loadMoreLeaderboard used to contain two
 * copy-pasted blocks (the doc->row mapper and the "pin me at the bottom" fallback)
 * that were refactored into shared helpers. Deduplication is exactly the kind of
 * change that silently alters behaviour, so this drives the real public API through
 * a Firestore stub rather than testing the helpers in isolation.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const APP = path.join(repoRoot, '01-code', 'app');

function elementStub() {
    const el = {
        style: {}, dataset: {}, _children: [],
        classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
        textContent: '',
        appendChild(child) { this._children.push(child); },
        setAttribute() {}, closest() { return null; }
    };

    // Real DOM: assigning innerHTML replaces the children. renderLeaderboard relies
    // on `listEl.innerHTML = ''` to clear the list before re-appending, so the stub
    // has to honour that or every render appears to stack on the previous one.
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
        get: () => html,
        set(value) { html = value; el._children.length = 0; }
    });

    return el;
}

// Firestore stub for the `leaderboard` collection. Pages are returned in order, so
// the second call to .get() is the second page.
function createLeaderboardStub(pages) {
    const stats = { queries: 0, startAfterUsed: 0 };
    let pageIndex = 0;

    function snapshotFor(rows) {
        const docs = rows.map(r => ({ id: r.uid, data: () => r }));
        return { empty: docs.length === 0, docs, forEach: cb => docs.forEach(cb) };
    }

    const query = {
        orderBy() { return query; },
        startAfter() { stats.startAfterUsed += 1; return query; },
        limit() { return query; },
        get() {
            stats.queries += 1;
            const rows = pages[pageIndex] || [];
            pageIndex += 1;
            return Promise.resolve(snapshotFor(rows));
        }
    };

    return { stats, firestore: () => ({ collection: () => query }) };
}

function loadHarness({ pages = [[]], currentUser = null, exactRank = 42 } = {}) {
    const stub = createLeaderboardStub(pages);
    const elements = new Map();

    const sandbox = {
        console: { ...console, warn() {}, error() {} },
        setTimeout,
        JSON,
        firebase: {
            firestore: stub.firestore,
            auth: () => ({ currentUser }),
            app: () => ({ options: { projectId: 'test' } })
        },
        // fetch backs fetchExactLeaderboardRankForScore (the COUNT aggregation).
        fetch: async () => ({
            json: async () => ([{ result: { aggregateFields: { rankCount: { integerValue: String(exactRank - 1) } } } }])
        }),
        document: {
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, elementStub());
                return elements.get(id);
            },
            querySelectorAll: () => [],
            createElement: () => elementStub()
        },
        window: {
            currentWalkPoints: 0,
            _lastKnownLeaderboardRank: null,
            BARK: {
                repos: {}, services: {},
                leaderboardRenderer: {
                    getSafeLeaderboardRank(rank) {
                        const n = Number(rank);
                        return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
                    },
                    formatLeaderboardRank: rank => (rank ? String(rank) : '--'),
                    createLeaderboardRow: ({ user }) => ({ __row: user.uid })
                },
                calculateVisitScore: () => ({ totalScore: 7, totalVisitedCount: 3, verifiedCount: 1 }),
                getProfileVisitedPlacesArray: () => [],
                getProfileTotalVisitedCount: () => 3,
                hasProfileVerifiedVisit: () => true,
                safeUpdateHTML() {},
                incrementRequestCount() {},
                isLaunchFlagEnabled: () => true,
                getLaunchFlagMessage: () => 'paused'
            }
        }
    };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(APP, 'modules', 'leaderboardEngine.js'), 'utf8'), sandbox);

    return { sandbox, stats: stub.stats, elements };
}

const row = (uid, points, extra = {}) => ({
    uid, displayName: `Ranger ${uid}`, totalPoints: points, totalVisited: points, hasVerified: true, ...extra
});

test('loadLeaderboard maps Firestore docs into leaderboard rows', async () => {
    const { sandbox } = loadHarness({ pages: [[row('a', 30), row('b', 20)]] });

    await sandbox.window.BARK.loadLeaderboard();

    // The rendered list is the observable effect; each row records its uid.
    const list = sandbox.document.getElementById('leaderboard-list');
    assert.equal(list._children.length, 2, 'both docs should render as rows');
    assert.deepEqual(list._children.map(c => c.__row), ['a', 'b']);
});

test('the doc mapper falls back to totalVisited when totalPoints is absent', async () => {
    // A legacy leaderboard document written before totalPoints existed.
    const legacy = { uid: 'old', displayName: '', totalVisited: 12, hasVerified: false };
    const { sandbox } = loadHarness({ pages: [[legacy]] });

    await sandbox.window.BARK.loadLeaderboard();

    const list = sandbox.document.getElementById('leaderboard-list');
    assert.equal(list._children.length, 1, 'a legacy row must still render');
});

test('a signed-in user outside the page is pinned with their exact rank', async () => {
    const { sandbox } = loadHarness({
        pages: [[row('a', 90), row('b', 80)]],
        currentUser: { uid: 'me', displayName: 'Me', getIdToken: async () => 'token' },
        exactRank: 42
    });

    await sandbox.window.BARK.loadLeaderboard();

    const list = sandbox.document.getElementById('leaderboard-list');
    const uids = list._children.map(c => c.__row);
    assert.deepEqual(uids, ['a', 'b', 'me'], 'the signed-in user is appended, pinned last');

    const rankEl = sandbox.document.getElementById('personal-rank-display');
    assert.equal(rankEl.textContent, 'Rank: 42', 'the pinned row uses the exact aggregate rank');
});

test('a signed-in user already on the page is NOT duplicated', async () => {
    const { sandbox } = loadHarness({
        pages: [[row('a', 90), row('me', 80)]],
        currentUser: { uid: 'me', displayName: 'Me', getIdToken: async () => 'token' }
    });

    await sandbox.window.BARK.loadLeaderboard();

    const uids = sandbox.document.getElementById('leaderboard-list')._children.map(c => c.__row);
    assert.deepEqual(uids, ['a', 'me']);
    assert.equal(uids.filter(u => u === 'me').length, 1, 'no duplicate personal row');
});

test('loadMoreLeaderboard appends the next page using the paging cursor', async () => {
    const { sandbox, stats } = loadHarness({
        pages: [[row('a', 90), row('b', 80)], [row('c', 70), row('d', 60)]]
    });

    await sandbox.window.BARK.loadLeaderboard();
    await sandbox.window.BARK.loadMoreLeaderboard();

    assert.equal(stats.queries, 2, 'one query per page');
    assert.equal(stats.startAfterUsed, 1, 'the second page must page from the cursor');

    const uids = sandbox.document.getElementById('leaderboard-list')._children.map(c => c.__row);
    assert.deepEqual(uids, ['a', 'b', 'c', 'd'], 'pages accumulate in order');
});

test('paging does not re-add rows already on screen', async () => {
    // Overlapping pages: 'b' appears in both. The shared mapper must not duplicate it.
    const { sandbox } = loadHarness({
        pages: [[row('a', 90), row('b', 80)], [row('b', 80), row('c', 70)]]
    });

    await sandbox.window.BARK.loadLeaderboard();
    await sandbox.window.BARK.loadMoreLeaderboard();

    const uids = sandbox.document.getElementById('leaderboard-list')._children.map(c => c.__row);
    assert.deepEqual(uids, ['a', 'b', 'c'], 'the overlapping row appears once');
});

test('paging replaces the pinned personal row rather than stacking copies', async () => {
    // The user is outside both pages, so a pinned row is added on each load. Only one
    // should ever be on screen.
    const { sandbox } = loadHarness({
        pages: [[row('a', 90), row('b', 80)], [row('c', 70), row('d', 60)]],
        currentUser: { uid: 'me', displayName: 'Me', getIdToken: async () => 'token' },
        exactRank: 99
    });

    await sandbox.window.BARK.loadLeaderboard();
    await sandbox.window.BARK.loadMoreLeaderboard();

    const uids = sandbox.document.getElementById('leaderboard-list')._children.map(c => c.__row);
    assert.equal(uids.filter(u => u === 'me').length, 1, 'exactly one pinned personal row');
    assert.equal(uids[uids.length - 1], 'me', 'and it stays pinned at the bottom');
});

test('resetLeaderboardState clears everything a new user must not inherit', async () => {
    // This is the whole reason the session state moved out of window._* globals:
    // authService calls ONE function on logout/account switch, so a newly added
    // field cannot be forgotten at the call site and leak into the next session.
    const { sandbox } = loadHarness({
        pages: [[row('a', 90), row('b', 80)]],
        currentUser: { uid: 'me', displayName: 'Me', getIdToken: async () => 'token' },
        exactRank: 7
    });
    const BARK = sandbox.window.BARK;

    await BARK.loadLeaderboard();
    BARK.setCurrentLeaderboardRank(7);

    const before = BARK.getLeaderboardSyncState();
    assert.equal(before.rank, 7, 'precondition: a rank is held');
    assert.equal(before.hasMorePages, true, 'precondition: a paging cursor is held');

    BARK.resetLeaderboardState();

    const after = BARK.getLeaderboardSyncState();
    assert.equal(after.rank, null, 'rank must not survive an account switch');
    assert.equal(after.lastSyncedScore, -1, 'score resets to the "never synced" sentinel');
    assert.equal(after.lastSyncedFingerprint, null, 'fingerprint must clear so the next user resyncs');
    assert.equal(after.hasMorePages, false, 'paging cursor must clear');
    assert.equal(after.hasLoadedOnce, false, 'the next session must load the leaderboard again');
});

test('loadLeaderboardOnce fetches once per session and again after a reset', async () => {
    const { sandbox, stats } = loadHarness({ pages: [[row('a', 90)], [row('a', 90)]] });
    const BARK = sandbox.window.BARK;

    await BARK.loadLeaderboardOnce();
    await BARK.loadLeaderboardOnce();
    assert.equal(stats.queries, 1, 'the second call in the same session is a no-op');

    BARK.resetLeaderboardState();
    await BARK.loadLeaderboardOnce();
    assert.equal(stats.queries, 2, 'after a reset the next session loads again');
});

test('an empty next page clears the cursor and stops paging', async () => {
    const { sandbox, stats } = loadHarness({
        pages: [[row('a', 90)], []]
    });

    await sandbox.window.BARK.loadLeaderboard();
    await sandbox.window.BARK.loadMoreLeaderboard();

    const before = stats.queries;
    await sandbox.window.BARK.loadMoreLeaderboard();
    assert.equal(stats.queries, before, 'no further queries once the cursor is exhausted');
});
