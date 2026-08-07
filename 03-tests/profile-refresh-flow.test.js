/**
 * Guards the Profile refresh flow and the achievement `category` contract after the
 * profileEngine / achievementsPanel / leaderboardEngine split.
 *
 * The point of these tests is the SEAM, not the pixels: that refreshProfile drives
 * its collaborators in the right order, and that the vault filters badges on a real
 * `category` field instead of guessing from id substrings.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const APP = path.join(repoRoot, '01-code', 'app');

function createElementStub() {
    return {
        style: {}, dataset: {}, classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
        textContent: '', innerHTML: '',
        appendChild() {}, setAttribute() {}, closest() { return null; }
    };
}

// Loads the three profile modules into one sandbox in index.html order and records
// the order in which collaborators are called.
function loadProfileHarness({ achievements } = {}) {
    const callOrder = [];
    const renderedGrids = {};

    const sandbox = {
        console: { ...console, error() {}, warn() {} },
        setTimeout,
        map: { getCenter: () => ({ lat: 39.8283, lng: -98.5795 }) },
        document: {
            getElementById: () => createElementStub(),
            querySelectorAll: () => [],
            createElement: () => createElementStub()
        },
        window: {
            currentWalkPoints: 0,
            _lastKnownLeaderboardRank: null,
            _serverPayloadSettled: true,
            BARK: {
                repos: { ParkRepo: { getById: () => null, getAll: () => [] } },
                services: {},
                leaderboardRenderer: {
                    getSafeLeaderboardRank(rank) {
                        const n = Number(rank);
                        return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
                    },
                    formatLeaderboardRank: rank => (rank ? String(rank) : '--')
                },
                calculateVisitScore: () => ({ totalScore: 0, totalVisitedCount: 0, verifiedCount: 0 }),
                getUserLocationMarker: () => null,
                haversineDistance: () => 1,
                safeUpdateHTML(id, html) {
                    callOrder.push(`render:${id}`);
                    renderedGrids[id] = html;
                },
                incrementRequestCount() {}
            },
            gamificationEngine: {
                async evaluateAndStoreAchievements() {
                    callOrder.push('brain');
                    return achievements || {
                        title: 'B.A.R.K. Trainee',
                        totalScore: 0,
                        rareFeats: [], paws: [], stateBadges: [],
                        nationalProgress: { percentComplete: 0, totalVisited: 0, totalParks: 1 }
                    };
                },
                getNormalizedStateCode: code => String(code || '').trim().toUpperCase() || null
            }
        }
    };

    vm.createContext(sandbox);
    ['modules/achievementsPanel.js', 'modules/managePortal.js', 'modules/profileEngine.js', 'modules/leaderboardEngine.js']
        .forEach(rel => vm.runInContext(fs.readFileSync(path.join(APP, ...rel.split('/')), 'utf8'), sandbox));

    // Record the leaderboard sync without doing any network work.
    sandbox.window.BARK.syncScoreToLeaderboard = async () => { callOrder.push('leaderboardSync'); };

    return { sandbox, callOrder, renderedGrids };
}

function badge(overrides) {
    return {
        id: 'x', name: 'X', icon: '⭐', status: 'locked', tier: 'honor',
        criteria: '', dateEarnedTs: 0, ...overrides
    };
}

test('the three profile modules register a clean public API', () => {
    const { sandbox } = loadProfileHarness();
    const BARK = sandbox.window.BARK;

    assert.equal(typeof BARK.refreshProfile, 'function', 'profileEngine must expose refreshProfile');
    assert.equal(typeof BARK.evaluateAchievements, 'function', 'legacy alias must survive for renderEngine');
    assert.equal(BARK.evaluateAchievements, BARK.refreshProfile, 'the alias must point at the same function');
    assert.equal(typeof BARK.achievementsPanel.render, 'function', 'the vault must expose render()');
    assert.equal(typeof BARK.syncScoreToLeaderboard, 'function', 'leaderboardEngine must expose the sync');
});

test('refreshProfile drives its collaborators in order: brain, vault, then leaderboard', async () => {
    const { sandbox, callOrder } = loadProfileHarness();

    // Signed in, so the leaderboard step actually runs.
    sandbox.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };

    await sandbox.window.BARK.refreshProfile([]);

    assert.equal(callOrder[0], 'brain', 'the brain must run before anything is painted');

    const statesAt = callOrder.indexOf('render:states-grid');
    const syncAt = callOrder.indexOf('leaderboardSync');

    assert.ok(callOrder.includes('render:rare-feats-grid'), 'rare feats must render');
    assert.ok(callOrder.includes('render:paws-grid'), 'paws must render');
    assert.ok(statesAt > -1, 'states must render');
    assert.ok(syncAt > -1, 'a signed-in refresh must sync the leaderboard');

    // The leaderboard goes LAST, so the screen is fully painted before we touch the
    // network. If someone moves the sync back into the middle, this fails.
    assert.ok(syncAt > statesAt, 'leaderboard sync must run after the vault is painted');
    assert.equal(callOrder[callOrder.length - 1], 'leaderboardSync', 'sync is the final step');
});

test('a signed-out refresh paints the vault but does not touch the leaderboard', async () => {
    const { sandbox, callOrder } = loadProfileHarness();

    await sandbox.window.BARK.refreshProfile([]);

    assert.ok(callOrder.includes('render:states-grid'), 'the vault still paints when signed out');
    assert.ok(!callOrder.includes('leaderboardSync'), 'no leaderboard write without a user');
});

test('updateStatsUI runs without a ReferenceError after the module split', () => {
    // REGRESSION: renderManagePortal moved to managePortal.js but updateStatsUI kept
    // calling it by bare name. That threw ReferenceError inside the auth state
    // callback, which aborted sign-in AND stopped the leaderboard from loading.
    // Cross-file calls must go through window.BARK.
    const { sandbox } = loadProfileHarness();

    assert.doesNotThrow(
        () => sandbox.window.BARK.updateStatsUI(),
        'updateStatsUI must not reference functions that live in another file'
    );
});

test('every public profile entry point survives being called cold', () => {
    // Cheap guard against the same class of bug in the other extracted modules:
    // a bare reference to something that moved only blows up at call time.
    const { sandbox } = loadProfileHarness();
    const B = sandbox.window.BARK;

    ['updateStatsUI', 'renderManagePortal'].forEach(name => {
        assert.equal(typeof B[name], 'function', `${name} must be registered`);
        assert.doesNotThrow(() => B[name](), `${name} threw when called`);
    });
});

test('leaderboardEngine never calls back into achievements', () => {
    // The leaderboard used to call window.BARK.evaluateAchievements() whenever the
    // rank moved, making the two features mutually recursive and requiring a
    // re-entrancy flag. profileEngine now pulls the rank after the sync instead.
    const source = fs.readFileSync(path.join(APP, 'modules', 'leaderboardEngine.js'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    assert.ok(!code.includes('evaluateAchievements'),
        'leaderboardEngine must not reference the achievements entry point');
    assert.ok(!code.includes('refreshProfile'),
        'leaderboardEngine must not reference the profile refresh');
    assert.ok(!code.includes('refreshAchievements'),
        'the refreshAchievements option should be gone entirely');
});

test('a rank change after sync re-evaluates the vault exactly once', async () => {
    const { sandbox, callOrder } = loadProfileHarness();
    sandbox.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };

    // The sync discovers the user is now #1, which is what "Alpha Dog" needs.
    let rank = null;
    sandbox.window.BARK.getCurrentLeaderboardRank = () => rank;
    sandbox.window.BARK.syncScoreToLeaderboard = async () => {
        callOrder.push('leaderboardSync');
        rank = 1;
    };

    await sandbox.window.BARK.refreshProfile([]);

    const brainRuns = callOrder.filter(c => c === 'brain').length;
    assert.equal(brainRuns, 2, 'one evaluation before the sync, one after the rank moved');

    // Bounded: exactly two, never more. A recursive design would keep going.
    const vaultRenders = callOrder.filter(c => c === 'render:rare-feats-grid').length;
    assert.equal(vaultRenders, 2, 'the vault repaints once with the corrected rank');
    assert.equal(callOrder[callOrder.length - 1], 'render:states-grid', 'the repaint is the final step');
});

test('an unchanged rank does not trigger a second evaluation', async () => {
    const { sandbox, callOrder } = loadProfileHarness();
    sandbox.firebase = { auth: () => ({ currentUser: { uid: 'u1' } }) };

    sandbox.window.BARK.getCurrentLeaderboardRank = () => 5;
    sandbox.window.BARK.syncScoreToLeaderboard = async () => { callOrder.push('leaderboardSync'); };

    await sandbox.window.BARK.refreshProfile([]);

    assert.equal(callOrder.filter(c => c === 'brain').length, 1, 'no wasted second evaluation');
    assert.equal(callOrder[callOrder.length - 1], 'leaderboardSync');
});

test('the vault renders badges from the category contract, not id substrings', () => {
    const { sandbox } = loadProfileHarness();
    const panel = sandbox.window.BARK.achievementsPanel;

    // Correct categories still produce the right defaults.
    assert.equal(panel.getSubtitle(badge({ id: 'state-oh', category: 'states' })), '100% cleared!!');
    assert.equal(panel.getSubtitle(badge({ id: 'bronzePaw', category: 'paws' })), 'Verified Check-ins');

    // The discriminating cases: ids that WOULD false-match the old substring checks
    // (`id.includes('state')` / `id.includes('Paw')`) but are not those categories.
    // These must come back empty, which is only possible if category drives it.
    assert.equal(
        panel.getSubtitle(badge({ id: 'state-of-the-art-feat', category: 'rareFeats' })),
        '',
        'a rareFeats badge whose id contains "state" must not get the states subtitle'
    );
    assert.equal(
        panel.getSubtitle(badge({ id: 'PawsomeExplorer', category: 'rareFeats' })),
        '',
        'a rareFeats badge whose id contains "Paw" must not get the paws subtitle'
    );

    // And category wins even when the id points the other way entirely.
    assert.equal(
        panel.getSubtitle(badge({ id: 'noHintsHere', category: 'states' })),
        '100% cleared!!',
        'category alone decides, regardless of the id'
    );
});

test('a locked classified feat never leaks its real name into the DOM', () => {
    const { sandbox } = loadProfileHarness();
    const panel = sandbox.window.BARK.achievementsPanel;

    const html = panel.renderBadgeCard(badge({
        id: 'alphaDog', name: 'The Alpha Dog', category: 'rareFeats',
        classified: true, status: 'locked', teaser: 'Lead the pack',
        criteria: 'Reach #1 on Leaderboard'
    }));

    assert.ok(!html.includes('The Alpha Dog'), 'hidden classified must not expose its name');
    assert.ok(!html.includes('Reach #1'), 'hidden classified must not expose its criteria');
    assert.ok(html.includes('CLASSIFIED'));
    assert.ok(html.includes('Lead the pack'), 'the short teaser is the only hint shown');
    assert.ok(!html.includes('aria-label'), 'locked cards must not be focusable or announce a name');
});

test('an unlocked classified feat reveals its real name and criteria', () => {
    const { sandbox } = loadProfileHarness();
    const panel = sandbox.window.BARK.achievementsPanel;

    const html = panel.renderBadgeCard(badge({
        id: 'alphaDog', name: 'The Alpha Dog', category: 'rareFeats',
        classified: true, status: 'unlocked', tier: 'verified',
        teaser: 'Lead the pack', criteria: 'Reach #1 on Leaderboard'
    }));

    assert.ok(html.includes('The Alpha Dog'));
    assert.ok(html.includes('Reach #1 on Leaderboard'));
    assert.ok(html.includes('classified-feat'), 'keeps the classified styling hook');
});

test('states sort puts the current state first, then completed, then nearest', () => {
    const { sandbox } = loadProfileHarness();
    const panel = sandbox.window.BARK.achievementsPanel;

    const states = [
        badge({ id: 'state-ca', stateCode: 'CA', category: 'states', status: 'locked' }),
        badge({ id: 'state-tx', stateCode: 'TX', category: 'states', status: 'unlocked', dateEarnedTs: 5 }),
        badge({ id: 'state-oh', stateCode: 'OH', category: 'states', status: 'locked' })
    ];
    const distances = { CA: 900, TX: 400, OH: 10 };

    const sorted = panel.sortStateBadges(states, distances, 'OH');

    assert.equal(sorted[0].stateCode, 'OH', 'the state the user is standing in comes first');
    assert.equal(sorted[1].stateCode, 'TX', 'then completed states');
    assert.equal(sorted[2].stateCode, 'CA', 'then the rest by distance');
});
