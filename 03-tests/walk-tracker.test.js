const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');

const MILES_PER_METER = 1 / 1609.344;

function createElement() {
    return {
        style: {},
        className: '',
        textContent: '',
        innerHTML: '',
        onclick: null,
        listeners: {},
        addEventListener(type, handler) { this.listeners[type] = handler; },
        appendChild(node) { return node; }
    };
}

const DEFAULT_FIX_GAP_MS = 60000;
const WALKING_MPS = 1.34;   // ~3mph, the pace the fixtures walk at

/**
 * Enough of a browser to run the tracker headless: no Leaflet and no window.map,
 * so the route overlay no-ops and only the distance math is under test. Timers are
 * inert on purpose — the live signal tick would otherwise hold the test runner open.
 *
 * The clock is ours, because the tracker judges a step by the speed it implies.
 * Fixtures that fired every position in the same millisecond would look like
 * teleports, which is exactly what the tracker is supposed to reject.
 */
function createHarness(options = {}) {
    const storage = options.storage || new Map();
    let clock = options.startClock || 1700000000000;
    const alerts = [];
    const prompts = Array.isArray(options.prompts) ? [...options.prompts] : [];
    const confirms = Array.isArray(options.confirms) ? [...options.confirms] : [];
    const elements = new Map();
    ['training-action-btn', 'cancel-training-btn', 'training-desc', 'live-walk-banner', 'floating-distance',
        'live-walk-banner-distance', 'live-walk-banner-map'].forEach(id => elements.set(id, createElement()));

    let watchCallbacks = null;
    let nextWatchId = 1;
    let walkedMeters = 0;

    const document = {
        hidden: false,
        listeners: {},
        createElement,
        getElementById(id) { return elements.get(id) || null; },
        querySelector() { return null; },
        addEventListener(type, handler) { this.listeners[type] = handler; },
        removeEventListener(type) { delete this.listeners[type]; },
        body: { appendChild(node) { return node; } }
    };

    const windowObj = {
        BARK: {},
        listeners: {},
        addEventListener(type, handler) { this.listeners[type] = handler; },
        removeEventListener(type) { delete this.listeners[type]; },
        localStorage: {
            getItem(key) { return storage.has(key) ? storage.get(key) : null; },
            setItem(key, value) { storage.set(key, String(value)); },
            removeItem(key) { storage.delete(key); }
        }
    };

    const context = {
        console,
        document,
        window: windowObj,
        navigator: {
            geolocation: {
                watchPosition(onFix, onError) {
                    watchCallbacks = { onFix, onError };
                    return nextWatchId++;
                },
                clearWatch() { watchCallbacks = null; }
            }
        },
        alert(message) { alerts.push(String(message)); },
        prompt() { return prompts.length ? prompts.shift() : null; },
        confirm() { return confirms.length ? confirms.shift() : true; },
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        Date: { now: () => clock }
    };
    context.window.window = context.window;

    ['utils/geoUtils.js', 'modules/walkTracker.js'].forEach(relative => {
        vm.runInNewContext(
            fs.readFileSync(path.join(repoRoot, '01-code', 'app', relative), 'utf8'),
            context,
            { filename: relative }
        );
    });

    const bark = context.window.BARK;
    const tracker = bark.walkTracker;

    return {
        bark,
        tracker,
        document,
        window: windowObj,
        storage,
        alerts,
        element(id) { return elements.get(id); },
        now() { return clock; },
        advance(ms) { clock += ms; },
        /** Feed the tracker a position the way the OS would, a minute of walking later. */
        fix(lat, lng, accuracy = 5, gapMs = DEFAULT_FIX_GAP_MS) {
            if (!watchCallbacks) throw new Error('nothing is watching for positions');
            clock += gapMs;
            watchCallbacks.onFix({ coords: { latitude: lat, longitude: lng, accuracy } });
        },
        /** Walk `meters` further north at a believable pace and report the fix. */
        step(meters, accuracy = 5) {
            walkedMeters += meters;
            clock += Math.round((Math.abs(meters) / WALKING_MPS) * 1000);
            watchCallbacks.onFix({
                coords: { latitude: north(START_LAT, walkedMeters), longitude: START_LNG, accuracy }
            });
        },
        walkedMeters() { return walkedMeters; },
        isWatching() { return watchCallbacks !== null; },
        setHidden(hidden) {
            document.hidden = hidden;
            if (typeof document.listeners.visibilitychange === 'function') document.listeners.visibilitychange();
        },
        storedSession() {
            const raw = storage.get('bark.walk.activeSession');
            return raw ? JSON.parse(raw) : null;
        },
        settle() { return new Promise(resolve => setImmediate(resolve)); }
    };
}

/** Seeds the one-time screen-lock notice as already shown. */
function seenNotice(storage = new Map()) {
    storage.set('bark.walk.screenLockNoticeSeen', '1');
    return storage;
}

/** Metres north of a starting latitude, near enough for test fixtures. */
function north(lat, meters) {
    return lat + (meters / 111320);
}

const START_LAT = 27.9;
const START_LNG = -82.7;

async function startWalk(harness) {
    await harness.tracker.start();
    return harness;
}

test('distance accumulates along the route rather than start-to-finish displacement', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);

    // Out 300m and back to the start: displacement is zero, the walk is 600m.
    harness.fix(START_LAT, START_LNG);
    harness.fix(north(START_LAT, 150), START_LNG);
    harness.fix(north(START_LAT, 300), START_LNG);
    harness.fix(north(START_LAT, 150), START_LNG);
    harness.fix(START_LAT, START_LNG);

    assert.ok(Math.abs(harness.tracker.totalMiles - 600 * MILES_PER_METER) < 0.005,
        `expected ~0.37mi, got ${harness.tracker.totalMiles}`);
});

test('fixes worse than the accuracy ceiling are ignored', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG, 5);
    harness.fix(north(START_LAT, 200), START_LNG, 120);

    assert.equal(harness.tracker.totalMiles, 0);
});

test('the minimum step scales with the reported accuracy', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);

    // 8m of movement counts on a tight fix and is treated as noise on a loose one.
    harness.fix(START_LAT, START_LNG, 4);
    harness.fix(north(START_LAT, 8), START_LNG, 4);
    const tight = harness.tracker.totalMiles;
    assert.ok(tight > 0, 'a clean 8m step should count');

    harness.fix(north(START_LAT, 16), START_LNG, 40);
    assert.equal(harness.tracker.totalMiles, tight, 'the same step on a 40m fix is noise');
});

test('a teleport re-anchors instead of banking miles', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.fix(north(START_LAT, 30), START_LNG);
    const walked = harness.tracker.totalMiles;

    harness.fix(north(START_LAT, 20030), START_LNG);   // 20km in the same instant
    assert.equal(harness.tracker.totalMiles, walked, 'the jump must not count');

    harness.fix(north(START_LAT, 20060), START_LNG);   // walking on from the new anchor
    assert.ok(harness.tracker.totalMiles > walked, 'tracking continues from where we landed');
});

test('positions that arrive while the page is hidden still count', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.setHidden(true);
    harness.fix(north(START_LAT, 100), START_LNG);
    harness.fix(north(START_LAT, 200), START_LNG);

    assert.ok(Math.abs(harness.tracker.totalMiles - 200 * MILES_PER_METER) < 0.002,
        'a platform that keeps feeding us positions in the background should be believed');
});

test('experimental fallback math distinguishes walking, running, and impossible entries', () => {
    const harness = createHarness();
    const math = harness.bark.__walkTrackerInternals;
    const limits = math.fallbackLimits(10);

    assert.equal(limits.walkingMiles, 1, 'ten minutes gets a small walking grace');
    assert.equal(limits.runningMiles, 2.1, 'ten minutes supports a fast but plausible run');
    assert.equal(math.validateFallbackMiles('0.5', 10).status, 'accept');

    const oneMileRun = math.validateFallbackMiles('1', 10);
    assert.equal(oneMileRun.status, 'confirm-run');
    assert.equal(oneMileRun.claimedMph, 6);

    assert.equal(math.validateFallbackMiles('2', 10).status, 'confirm-run');
    assert.equal(math.validateFallbackMiles('2.2', 10).status, 'too-far');
    assert.equal(math.validateFallbackMiles('2 miles', 10).status, 'invalid');
    assert.equal(math.validateFallbackMiles('-1', 10).status, 'invalid');
    assert.equal(math.validateFallbackMiles('0', 10).status, 'skip');
    assert.equal(math.validateFallbackMiles(null, 10).status, 'skip');
});

test('experimental fallback math retains an absolute ceiling for long outages', () => {
    const math = createHarness().bark.__walkTrackerInternals;

    assert.equal(math.maximumFallbackMiles(12 * 60, math.MAX_RUNNING_MPH), 30);
    assert.equal(math.validateFallbackMiles('30', 12 * 60).status, 'accept');
    assert.equal(math.validateFallbackMiles('30.1', 12 * 60).status, 'too-far');
});

test('a slow walker can confirm that they ran during a ten-minute GPS gap', async () => {
    const harness = createHarness({ storage: seenNotice(), prompts: ['1'], confirms: [true] });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.fix(north(START_LAT, 100), START_LNG);
    const beforePause = harness.tracker.totalMiles;

    harness.setHidden(true);
    harness.advance(10 * 60000);
    harness.setHidden(false);

    assert.ok(Math.abs(harness.tracker.totalMiles - (beforePause + 1)) < 1e-9);
    assert.equal(harness.tracker.manualFallbackMiles, 1);
});

test('declining running pace allows a corrected walking entry', async () => {
    const harness = createHarness({ storage: seenNotice(), prompts: ['1', '0.5'], confirms: [false] });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.setHidden(true);
    harness.advance(10 * 60000);
    harness.setHidden(false);

    assert.equal(harness.tracker.manualFallbackMiles, 0.5);
    assert.equal(harness.tracker.totalMiles, 0.5);
});

test('an impossible fallback entry is rejected without changing the walk', async () => {
    const harness = createHarness({ storage: seenNotice(), prompts: ['2.2', '0'] });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.setHidden(true);
    harness.advance(10 * 60000);
    harness.setHidden(false);

    assert.equal(harness.tracker.totalMiles, 0);
    assert.equal(harness.tracker.manualFallbackMiles, 0);
    assert.ok(harness.alerts.some(message => /experimental walk\/run limit/.test(message)));
});

test('a long pause is bridged only by what the user reports, not counted twice', async () => {
    const harness = createHarness({ storage: seenNotice(), prompts: ['1.50'] });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.fix(north(START_LAT, 100), START_LNG);
    const beforePause = harness.tracker.totalMiles;

    harness.setHidden(true);
    harness.advance(40 * 60000);   // 40 minutes in a pocket
    harness.setHidden(false);

    const afterPrompt = harness.tracker.totalMiles;
    assert.ok(Math.abs(afterPrompt - (beforePause + 1.5)) < 1e-9, 'the reported miles are added once');
    assert.equal(harness.tracker.manualFallbackMiles, 1.5, 'reported miles earn no score points');

    // The first fix back is 2km from where the pause started. The old code added
    // that displacement on top of the number the user just typed.
    harness.fix(north(START_LAT, 2100), START_LNG);
    assert.equal(harness.tracker.totalMiles, afterPrompt, 'the gap is not also bridged by GPS');

    harness.fix(north(START_LAT, 2200), START_LNG);
    assert.ok(harness.tracker.totalMiles > afterPrompt, 'tracking resumes from the new anchor');
});

test('a brief hide still bridges across, without asking', async () => {
    const harness = createHarness({ storage: seenNotice(), prompts: ['9'] });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.setHidden(true);
    harness.setHidden(false);
    harness.fix(north(START_LAT, 60), START_LNG);

    assert.equal(harness.tracker.manualFallbackMiles, 0, 'twenty seconds is not worth a prompt');
    assert.ok(Math.abs(harness.tracker.totalMiles - 60 * MILES_PER_METER) < 0.002);
});

test('walk progress is persisted as it goes', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.fix(north(START_LAT, 400), START_LNG);

    const record = harness.storedSession();
    assert.ok(record, 'a walk in progress must survive the page being killed');
    assert.equal(record.status, 'active');
    assert.ok(Math.abs(record.totalMiles - harness.tracker.totalMiles) < 1e-9);
    assert.equal(record.segments.length, 1);
});

test('accurate stationary fixes persist a fresh recovery clock', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);

    harness.fix(START_LAT, START_LNG);
    harness.fix(north(START_LAT, 1), START_LNG, 5, 6000);

    assert.equal(harness.storedSession().lastFixAt, harness.now());
    assert.equal(harness.tracker.totalMiles, 0, 'the heartbeat is persisted without inventing movement');
});

test('a reloaded app offers the interrupted walk back and resumes it', async () => {
    const first = createHarness({ storage: seenNotice() });
    await startWalk(first);
    first.step(0);
    first.step(400);
    first.step(400);
    const tracked = first.tracker.totalMiles;
    assert.ok(tracked > 0.05);

    // Same device storage, fresh page: what iOS does to a suspended PWA.
    const reloaded = createHarness({ storage: first.storage, startClock: first.now(), confirms: [true] });
    reloaded.bark.initWalkTracker();
    await reloaded.settle();

    assert.ok(Math.abs(reloaded.tracker.totalMiles - tracked) < 1e-9, 'the miles come back');
    assert.ok(reloaded.isWatching(), 'and tracking picks up again');

    // The first fix after the reload re-anchors; we cannot know where they went.
    reloaded.fix(north(START_LAT, 5000), START_LNG);
    assert.ok(Math.abs(reloaded.tracker.totalMiles - tracked) < 1e-9);
});

test('a reloaded app validates and restores miles covered while it was closed', async () => {
    const first = createHarness({ storage: seenNotice() });
    await startWalk(first);
    first.step(0);
    first.step(400);
    first.step(400);
    const tracked = first.tracker.totalMiles;

    const reloaded = createHarness({
        storage: first.storage,
        startClock: first.now() + (10 * 60000),
        prompts: ['1'],
        confirms: [true, true]
    });
    reloaded.bark.initWalkTracker();
    await reloaded.settle();

    assert.ok(Math.abs(reloaded.tracker.totalMiles - (tracked + 1)) < 1e-9);
    assert.equal(reloaded.tracker.manualFallbackMiles, 1, 'closed-app recovery miles remain non-scoring');
    assert.ok(reloaded.storedSession().gapHandledThroughAt > reloaded.storedSession().lastFixAt);

    reloaded.fix(north(START_LAT, 5000), START_LNG);
    assert.ok(Math.abs(reloaded.tracker.totalMiles - (tracked + 1)) < 1e-9,
        'the first GPS fix after reopening re-anchors instead of bridging the gap again');
});

test('declining to resume offers to save the miles already tracked', async () => {
    const first = createHarness({ storage: seenNotice() });
    await startWalk(first);
    first.step(0);
    first.step(400);
    first.step(400);
    const tracked = first.tracker.totalMiles;

    const logged = [];
    const reloaded = createHarness({ storage: first.storage, startClock: first.now(), confirms: [false, true] });
    reloaded.bark.processMileageAddition = async (miles, type, opts) => {
        logged.push({ miles, type, opts });
        return true;
    };
    reloaded.bark.initWalkTracker();
    await reloaded.settle();

    assert.equal(logged.length, 1);
    assert.equal(logged[0].type, 'GPS Active Track');
    assert.ok(Math.abs(logged[0].miles - tracked) < 1e-9);
    assert.equal(reloaded.storedSession(), null, 'a saved walk is cleared from the device');
});

test('a failed save keeps the walk on the device instead of dropping it', async () => {
    const harness = createHarness({ storage: seenNotice(), confirms: [false] });
    harness.bark.processMileageAddition = async () => false;

    await startWalk(harness);
    harness.step(0);
    harness.step(400);
    harness.step(400);
    await harness.tracker.stopAndSave();

    const record = harness.storedSession();
    assert.ok(record, 'the walk survives a failed write');
    assert.equal(record.status, 'pending-save');
    assert.ok(harness.alerts.some(message => /kept on this device/.test(message)));
});

test('a successful save logs the miles and clears the device copy', async () => {
    const logged = [];
    const harness = createHarness({ storage: seenNotice() });
    harness.bark.processMileageAddition = async (miles, type, opts) => {
        logged.push({ miles, type, opts });
        return true;
    };

    await startWalk(harness);
    harness.step(0);
    harness.step(600);
    harness.step(600);
    const tracked = harness.tracker.totalMiles;
    await harness.tracker.stopAndSave();

    assert.equal(logged.length, 1);
    assert.ok(Math.abs(logged[0].miles - tracked) < 1e-9);
    assert.ok(Math.abs(logged[0].opts.pointMiles - tracked) < 1e-9, 'GPS miles earn score points');
    assert.equal(harness.storedSession(), null);
    assert.equal(harness.isWatching(), false);
    assert.equal(harness.tracker.totalMiles, 0);
});

test('miles the user typed in for a pause earn no score points', async () => {
    const logged = [];
    const harness = createHarness({ storage: seenNotice(), prompts: ['2'] });
    harness.bark.processMileageAddition = async (miles, type, opts) => {
        logged.push({ miles, type, opts });
        return true;
    };

    await startWalk(harness);
    harness.step(0);
    harness.step(400);
    harness.step(400);
    const gpsMiles = harness.tracker.totalMiles;

    harness.setHidden(true);
    harness.advance(30 * 60000);
    harness.setHidden(false);
    await harness.tracker.stopAndSave();

    assert.ok(Math.abs(logged[0].miles - (gpsMiles + 2)) < 1e-9, 'all of it counts as mileage');
    assert.ok(Math.abs(logged[0].opts.pointMiles - gpsMiles) < 1e-9, 'only the GPS part scores');
});

test('the account gate is asked before the OS is', async () => {
    const harness = createHarness({ storage: seenNotice() });
    const prompted = [];
    harness.bark.expeditionGate = {
        currentUser: () => null,
        isPremiumUnlocked: () => true,
        promptAccount: (source) => prompted.push(source),
        promptPremium: () => prompted.push('premium')
    };

    await harness.tracker.start();

    assert.deepEqual(prompted, ['expedition']);
    assert.equal(harness.isWatching(), false);
});

test('the premium gate blocks a signed-in free user', async () => {
    const harness = createHarness({ storage: seenNotice() });
    const prompted = [];
    harness.bark.expeditionGate = {
        currentUser: () => ({ uid: 'free-user' }),
        isPremiumUnlocked: () => false,
        promptAccount: () => prompted.push('account'),
        promptPremium: () => prompted.push('premium')
    };

    await harness.tracker.start();

    assert.deepEqual(prompted, ['premium']);
    assert.equal(harness.isWatching(), false);
});

test('a walk belonging to a signed-out account is dropped, not inherited', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);
    harness.step(0);
    harness.step(400);
    harness.step(400);

    harness.tracker.reset();

    assert.equal(harness.tracker.totalMiles, 0);
    assert.equal(harness.isWatching(), false);
    assert.equal(harness.storedSession(), null);
});

test('the screen-lock limitation is stated before the first walk and on the idle card', async () => {
    const harness = createHarness({ confirms: [true] });
    harness.bark.initWalkTracker();

    assert.match(harness.element('training-desc').innerHTML, /keep this screen on/i);
    assert.doesNotMatch(harness.element('training-desc').innerHTML, /turnaround/i);

    await harness.tracker.start();
    assert.equal(harness.window.localStorage.getItem('bark.walk.screenLockNoticeSeen'), '1',
        'the warning is shown once, not before every walk');
});

test('an active walk makes the stop-and-save action explicit', async () => {
    const harness = createHarness({ storage: seenNotice() });
    harness.bark.initWalkTracker();

    assert.equal(harness.element('training-action-btn').textContent, 'Start Walk');
    await harness.tracker.start();

    assert.equal(harness.element('training-action-btn').textContent, 'Stop & Save');
    assert.equal(harness.element('cancel-training-btn').style.display, 'block');
});

test('the live card reports a signal that has gone quiet', async () => {
    const harness = createHarness({ storage: seenNotice() });
    await startWalk(harness);
    assert.match(harness.element('training-desc').innerHTML, /Acquiring GPS/);

    harness.fix(START_LAT, START_LNG);
    harness.fix(north(START_LAT, 100), START_LNG);
    assert.match(harness.element('training-desc').innerHTML, /0\.06 mi/);

    harness.advance(60000);
    harness.fix(north(START_LAT, 200), START_LNG, 200);   // rejected: too inaccurate to count
    harness.bark.__walkTrackerInternals.renderWalkCard();   // the live tick does this every few seconds
    assert.match(harness.element('training-desc').innerHTML, /Weak GPS signal/);
});

test('a second tap while the save is in flight does not log the walk twice', async () => {
    const harness = createHarness({ storage: seenNotice() });
    const calls = [];
    let finishSave;
    harness.bark.processMileageAddition = (miles, type, opts) => {
        calls.push({ miles, type, opts });
        return new Promise(resolve => { finishSave = resolve; });
    };

    await startWalk(harness);
    harness.step(0);
    harness.step(400);
    harness.step(400);

    const firstTap = harness.tracker.stopAndSave();
    const secondTap = harness.tracker.stopAndSave();   // impatient user, save still in flight
    finishSave(true);
    await Promise.all([firstTap, secondTap]);

    assert.equal(calls.length, 1);
    assert.equal(harness.storedSession(), null);
});

test('a walk recorded by another account is discarded, not offered', async () => {
    const first = createHarness({ storage: seenNotice() });
    first.bark.expeditionGate = {
        currentUser: () => ({ uid: 'user-a' }),
        isPremiumUnlocked: () => true,
        promptAccount() {}, promptPremium() {}
    };
    await startWalk(first);
    first.step(0);
    first.step(400);
    first.step(400);
    assert.equal(first.storedSession().uid, 'user-a');

    const logged = [];
    const other = createHarness({ storage: first.storage, startClock: first.now(), confirms: [true, true] });
    other.bark.expeditionGate = {
        currentUser: () => ({ uid: 'user-b' }),
        isPremiumUnlocked: () => true,
        promptAccount() {}, promptPremium() {}
    };
    other.bark.processMileageAddition = async (miles) => { logged.push(miles); return true; };
    other.bark.initWalkTracker();
    await other.settle();

    assert.deepEqual(logged, [], "user B is never offered user A's miles");
    assert.equal(other.storedSession(), null);
    assert.equal(other.tracker.totalMiles, 0);
});

test('a stored walk waits rather than being offered to nobody', async () => {
    const first = createHarness({ storage: seenNotice() });
    first.bark.expeditionGate = {
        currentUser: () => ({ uid: 'user-a' }),
        isPremiumUnlocked: () => true,
        promptAccount() {}, promptPremium() {}
    };
    await startWalk(first);
    first.step(0);
    first.step(400);
    first.step(400);
    const tracked = first.tracker.totalMiles;

    // Boot with sign-in unresolved: the walk must survive for a session that can save it.
    const signedOut = createHarness({ storage: first.storage, startClock: first.now(), confirms: [true] });
    signedOut.bark.initWalkTracker();
    await signedOut.settle();

    assert.equal(signedOut.tracker.totalMiles, 0, 'nothing is resumed');
    const kept = signedOut.storedSession();
    assert.ok(kept, 'and nothing is thrown away either');
    assert.ok(Math.abs(kept.totalMiles - tracked) < 1e-9);
});
