/**
 * leaderboardEngine.js — everything the global leaderboard does.
 *
 * WHAT THIS OWNS
 *   1. Score sync    — push this user's score to the server so others can rank against it.
 *   2. Rank          — work out where this user sits, exactly, even outside the top 5.
 *   3. Paged loading — fetch the leaderboard 5 rows at a time.
 *   4. Render        — decide what rows to show; the row DOM itself is built by
 *                      renderers/leaderboardRenderer.js.
 *
 * WHAT IT DOES NOT OWN
 *   Achievements. This file knows nothing about badges and never calls into them.
 *   The "Alpha Dog" badge does depend on rank, but profileEngine pulls the rank
 *   from here after a sync rather than this file pushing to it — so the dependency
 *   runs one way only. See setCurrentLeaderboardRank().
 *
 * COLLABORATORS (all reached late-bound through window.BARK so load order can't bite)
 *   window.BARK.leaderboardRenderer  — builds a single <li> row
 *   window.BARK.getProfileVisitedPlacesArray / getProfileTotalVisitedCount /
 *   hasProfileVerifiedVisit          — visit helpers owned by profileEngine.js
 *   Cloud Function 'syncLeaderboardScore' — recomputes the score SERVER-side so a
 *                                          client cannot award itself points.
 *
 * WHY SCORING IS SERVER-SIDE
 *   The leaderboard is public and competitive. The client sends no score at all; the
 *   callable reads visitedPlaces from the user document and derives the score itself.
 *
 * SESSION STATE
 *   All session state (rank, sync fingerprint, paging cursor) is private to this
 *   file. authService clears it through the single exported resetLeaderboardState()
 *   on logout and account switch, so one user's rank can never leak into the next
 *   session. Nothing outside this file may mutate it.
 */
window.BARK = window.BARK || {};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// The rows currently on screen. Kept so a score sync can patch this user's row in
// place instead of re-querying Firestore.
let cachedLeaderboardData = [];

// Re-entrancy guard: only one sync in flight at a time. A second caller sets the
// queued flag instead of firing a duplicate callable.
let _leaderboardSyncInProgress = false;
let _leaderboardSyncQueued = false;
let _leaderboardSyncRetryTimer = null;

// Backstop against hammering the callable when a sync keeps failing: the same
// fingerprint won't be retried more often than LEADERBOARD_SYNC_RETRY_DELAY_MS.
let _lastLeaderboardSyncAttemptTime = 0;
let _lastLeaderboardSyncAttemptFingerprint = null;

const LEADERBOARD_SYNC_RETRY_DELAY_MS = 10000;
// Short retry used when we're only waiting for an in-flight visitedPlaces write to
// land. Syncing mid-write would send a score derived from a half-saved document.
const LEADERBOARD_SYNC_WRITE_RETRY_MS = 250;

let isFetchingMoreLeaderboard = false;

// --- Per-session state -------------------------------------------------------
//
// These used to be window._* globals set by name from three different files
// (leaderboardEngine, barkState, authService). That made it easy for a new reset
// path to forget one, and a forgotten reset means the NEXT user inherits the
// previous user's rank and sync state. They now live here with a single mutation
// entry point, resetLeaderboardState(), which authService calls on logout and on
// account switch.
let lastKnownRank = null;

// -1, not 0, because 0 is a legitimate score. -1 means "never synced this session",
// which is what forces the first sync to actually run.
let lastSyncedScore = -1;
let lastSyncedFingerprint = null;

// Paging cursor for "Show More". null means there is no next page.
let lastLeaderboardDoc = null;

// The first page is fetched once per session; see loadLeaderboardOnce().
let hasLoadedOnce = false;

/** Clear everything session-scoped. Called by authService on logout / account switch. */
function resetLeaderboardState() {
    lastKnownRank = null;
    lastSyncedScore = -1;
    lastSyncedFingerprint = null;
    lastLeaderboardDoc = null;
    hasLoadedOnce = false;
    cachedLeaderboardData = [];

    _leaderboardSyncInProgress = false;
    _leaderboardSyncQueued = false;
    if (_leaderboardSyncRetryTimer !== null) {
        clearTimeout(_leaderboardSyncRetryTimer);
        _leaderboardSyncRetryTimer = null;
    }
    _lastLeaderboardSyncAttemptTime = 0;
    _lastLeaderboardSyncAttemptFingerprint = null;
}

/** Read-only view of the sync state. Useful for debugging and asserted by tests. */
function getLeaderboardSyncState() {
    return {
        lastSyncedScore,
        lastSyncedFingerprint,
        rank: lastKnownRank,
        hasLoadedOnce,
        hasMorePages: lastLeaderboardDoc !== null
    };
}

// ---------------------------------------------------------------------------
// Small accessors
// ---------------------------------------------------------------------------

function getLeaderboardRenderer() {
    return window.BARK && window.BARK.leaderboardRenderer;
}

function getCurrentFirebaseUser() {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;

    try {
        return firebase.auth().currentUser || null;
    } catch (error) {
        console.warn('[leaderboardEngine] Firebase auth unavailable for leaderboard sync:', error);
        return null;
    }
}

function getFunctionsForLeaderboardSync() {
    if (typeof firebase === 'undefined' || !firebase.functions) return null;

    try {
        return firebase.functions();
    } catch (error) {
        console.warn('[leaderboardEngine] Functions unavailable for leaderboard sync:', error);
        return null;
    }
}

// True while a visitedPlaces write is still in flight. Syncing now would score a
// document the server hasn't finished accepting.
function getFirebaseVisitedWriteState() {
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    return Boolean(
        firebaseService &&
        typeof firebaseService.hasVisitedPlacesWriteInFlight === 'function' &&
        firebaseService.hasVisitedPlacesWriteInFlight()
    );
}

// Visit helpers live in profileEngine.js. Reached through window.BARK so this file
// does not care which script tag loads first.
function visitedPlacesArray(source) {
    return typeof window.BARK.getProfileVisitedPlacesArray === 'function'
        ? window.BARK.getProfileVisitedPlacesArray(source)
        : [];
}

function totalVisitedCountFor(visits, scoreSummary) {
    return typeof window.BARK.getProfileTotalVisitedCount === 'function'
        ? window.BARK.getProfileTotalVisitedCount(visits, scoreSummary)
        : 0;
}

function hasVerifiedVisit(visits) {
    return typeof window.BARK.hasProfileVerifiedVisit === 'function'
        ? window.BARK.hasProfileVerifiedVisit(visits)
        : false;
}

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

function getSafeLeaderboardRankValue(rank) {
    const leaderboardRenderer = getLeaderboardRenderer();
    if (leaderboardRenderer && typeof leaderboardRenderer.getSafeLeaderboardRank === 'function') {
        return leaderboardRenderer.getSafeLeaderboardRank(rank);
    }

    const parsed = Number(rank);
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return Math.trunc(parsed);
}

function getCurrentLeaderboardRank() {
    return getSafeLeaderboardRankValue(lastKnownRank);
}

/**
 * Record where this user currently sits. Pure state, no side effects.
 *
 * This used to call back into window.BARK.evaluateAchievements() whenever the rank
 * moved, because the "Alpha Dog" badge unlocks at rank #1. That made achievements
 * and the leaderboard mutually dependent — achievements called the sync, the sync
 * called achievements — and it needed a re-entrancy flag to stay convergent.
 *
 * That callback is gone. profileEngine.refreshProfile() now compares the rank
 * before and after the sync and re-evaluates once, in a straight line, if it moved.
 * The leaderboard no longer knows achievements exist.
 */
function setCurrentLeaderboardRank(rank) {
    lastKnownRank = getSafeLeaderboardRankValue(rank);
    return lastKnownRank;
}

function parseLeaderboardRankCount(countData) {
    const rawCount = countData &&
        countData[0] &&
        countData[0].result &&
        countData[0].result.aggregateFields &&
        countData[0].result.aggregateFields.rankCount &&
        countData[0].result.aggregateFields.rankCount.integerValue;
    const parsedCount = Number.parseInt(rawCount, 10);
    if (!Number.isFinite(parsedCount) || parsedCount < 0) return null;
    return parsedCount;
}

// Exact rank for a user who isn't in the loaded top N.
//
// Counts how many leaderboard entries score higher, then adds 1. Uses Firestore's
// runAggregationQuery COUNT over the REST API rather than the SDK, because a COUNT
// aggregation bills ONE read no matter how many rows match, where fetching the rows
// to count them would bill one read per row. That is the whole reason for the raw
// fetch here; the compat SDK on this page has no aggregation support.
async function fetchExactLeaderboardRankForScore(localScore, context = 'leaderboard') {
    const user = getCurrentFirebaseUser();
    if (!user || typeof firebase === 'undefined' || !firebase.app || typeof fetch !== 'function') return null;

    try {
        const projectId = firebase.app().options.projectId;
        const idToken = await user.getIdToken();
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runAggregationQuery`;
        const scoreValue = Number.isInteger(localScore)
            ? { integerValue: localScore }
            : { doubleValue: localScore };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                structuredAggregationQuery: {
                    structuredQuery: {
                        from: [{ collectionId: 'leaderboard' }],
                        where: {
                            fieldFilter: {
                                field: { fieldPath: 'totalPoints' },
                                op: 'GREATER_THAN',
                                value: scoreValue
                            }
                        }
                    },
                    aggregations: [{ alias: 'rankCount', count: {} }]
                }
            })
        });

        const countData = await response.json();
        const countMatched = parseLeaderboardRankCount(countData);
        return countMatched !== null ? countMatched + 1 : null;
    } catch (error) {
        console.warn(`[leaderboardEngine] aggregate rank lookup failed (${context}).`, error);
        return null;
    }
}

// ---------------------------------------------------------------------------
// Score sync
// ---------------------------------------------------------------------------

// Identity of a score. If this hasn't changed there is nothing to tell the server,
// so the whole sync can be skipped.
function getLeaderboardSyncFingerprint(totalScore, totalVisitedCount, hasVerified) {
    const score = Number.isFinite(Number(totalScore)) ? Number(totalScore) : 0;
    const visited = Number.isFinite(Number(totalVisitedCount)) ? Number(totalVisitedCount) : 0;
    return JSON.stringify({
        totalPoints: score,
        totalVisited: visited,
        hasVerified: hasVerified === true
    });
}

function scheduleQueuedLeaderboardSync(delayMs = 0) {
    if (!_leaderboardSyncQueued) return;
    if (_leaderboardSyncRetryTimer !== null) return;

    _leaderboardSyncRetryTimer = setTimeout(() => {
        _leaderboardSyncRetryTimer = null;
        if (!_leaderboardSyncQueued) return;
        _leaderboardSyncQueued = false;
        syncScoreToLeaderboard();
    }, delayMs);
}

/**
 * Push this user's score to the public leaderboard, then refresh their rank.
 * Safe to call often — it returns early unless something actually changed.
 */
async function syncScoreToLeaderboard() {
    const now = Date.now();

    const user = getCurrentFirebaseUser();
    if (!user) return;

    const visitedPlaces = visitedPlacesArray();
    const scoreSummary = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints);
    const totalScore = scoreSummary.totalScore;
    const totalVisitedCount = totalVisitedCountFor(visitedPlaces, scoreSummary);
    const hasVerified = hasVerifiedVisit(visitedPlaces);
    const localFingerprint = getLeaderboardSyncFingerprint(totalScore, totalVisitedCount, hasVerified);

    // Nothing changed since the last successful sync.
    if (localFingerprint === lastSyncedFingerprint) return;

    // Already syncing — queue one follow-up rather than running two at once.
    if (_leaderboardSyncInProgress) {
        _leaderboardSyncQueued = true;
        scheduleQueuedLeaderboardSync(LEADERBOARD_SYNC_WRITE_RETRY_MS);
        return;
    }

    // A visitedPlaces write is still landing; scoring now would read a half-saved doc.
    if (getFirebaseVisitedWriteState()) {
        _leaderboardSyncQueued = true;
        scheduleQueuedLeaderboardSync(LEADERBOARD_SYNC_WRITE_RETRY_MS);
        return;
    }

    // This exact score was already attempted very recently and didn't stick. Back off
    // instead of hammering the callable.
    if (
        _lastLeaderboardSyncAttemptFingerprint === localFingerprint &&
        now - _lastLeaderboardSyncAttemptTime < LEADERBOARD_SYNC_RETRY_DELAY_MS
    ) {
        return;
    }

    _leaderboardSyncInProgress = true;
    _lastLeaderboardSyncAttemptTime = now;
    _lastLeaderboardSyncAttemptFingerprint = localFingerprint;
    try {
        const functionsService = getFunctionsForLeaderboardSync();
        if (!functionsService || typeof functionsService.httpsCallable !== 'function') return;

        if (typeof window.BARK.incrementRequestCount === 'function') {
            window.BARK.incrementRequestCount();
        }

        // The callable derives the score server-side; we send no score of our own.
        const syncLeaderboardScore = functionsService.httpsCallable('syncLeaderboardScore');
        const response = await syncLeaderboardScore({ requestedAt: now });
        const synced = response && response.data ? response.data : {};
        const syncedScore = Number(synced.totalPoints);
        const syncedVisited = Number(synced.totalVisited);

        // Trust the server's numbers; fall back to local ones only if it sent none.
        const leaderboardScore = Number.isFinite(syncedScore) ? syncedScore : totalScore;
        const leaderboardVisitedCount = Number.isFinite(syncedVisited) ? syncedVisited : totalVisitedCount;
        const leaderboardHasVerified = synced.hasVerified === undefined ? hasVerified : !!synced.hasVerified;

        // Fingerprint the SERVER's answer, so the next call compares like with like.
        lastSyncedScore = leaderboardScore;
        lastSyncedFingerprint = getLeaderboardSyncFingerprint(
            leaderboardScore,
            leaderboardVisitedCount,
            leaderboardHasVerified
        );

        const exactRank = await fetchExactLeaderboardRankForScore(leaderboardScore, 'score-sync');
        setCurrentLeaderboardRank(exactRank);

        // Patch this user's row in place rather than re-querying the collection.
        if (cachedLeaderboardData.length > 0) {
            const me = cachedLeaderboardData.find(u => u.uid === user.uid);
            if (me) {
                me.totalPoints = leaderboardScore;
                me.totalVisited = leaderboardVisitedCount;
                me.hasVerified = leaderboardHasVerified;
                if (me.isPersonalFallback) me.exactRank = exactRank;
            } else {
                const fallback = buildPersonalLeaderboardFallback(user, visitedPlaces, leaderboardScore, exactRank);
                fallback.totalVisited = leaderboardVisitedCount;
                fallback.hasVerified = leaderboardHasVerified;
                cachedLeaderboardData.push(fallback);
            }
            cachedLeaderboardData.sort((a, b) => b.totalPoints - a.totalPoints);
            renderLeaderboard(cachedLeaderboardData);
        }
    } catch (error) {
        console.warn('[leaderboardEngine] Server leaderboard sync failed; local profile rendering will continue.', error);
        const rateLimitUi = window.BARK && window.BARK.rateLimitUi;
        if (rateLimitUi && typeof rateLimitUi.showRateLimitWarning === 'function') {
            rateLimitUi.showRateLimitWarning(error);
        }
    } finally {
        _leaderboardSyncInProgress = false;
        scheduleQueuedLeaderboardSync();
    }
}

// ---------------------------------------------------------------------------
// Loading and rendering
// ---------------------------------------------------------------------------

// Shape of one leaderboard row, from a Firestore doc. Defined once so loadLeaderboard
// and loadMoreLeaderboard cannot drift apart.
function toLeaderboardRow(doc) {
    const d = doc.data();
    return {
        uid: doc.id,
        displayName: d.displayName || 'Bark Ranger',
        totalPoints: d.totalPoints !== undefined ? d.totalPoints : (d.totalVisited || 0),
        totalVisited: d.totalVisited || 0,
        hasVerified: !!d.hasVerified
    };
}

// A stand-in row for the signed-in user when they're outside the loaded page, so the
// leaderboard can still pin them at the bottom with their true rank.
function buildPersonalLeaderboardFallback(user, visitedPlaces, localScore, exactRank = null) {
    const visits = visitedPlacesArray(visitedPlaces);
    const scoreSummary = window.BARK.calculateVisitScore(visits, window.currentWalkPoints);
    return {
        uid: user.uid,
        displayName: user.displayName || 'Bark Ranger',
        totalPoints: localScore,
        totalVisited: totalVisitedCountFor(visits, scoreSummary),
        hasVerified: hasVerifiedVisit(visits),
        isPersonalFallback: true,
        exactRank: getLeaderboardRenderer().getSafeLeaderboardRank(exactRank)
    };
}

// If the signed-in user isn't already in `rows`, look up their exact rank and append
// a pinned fallback row. Shared by both load paths.
async function appendPersonalFallbackIfMissing(rows, context) {
    const user = getCurrentFirebaseUser();
    if (!user || rows.find(u => u.uid === user.uid)) return rows;

    const visitedPlaces = visitedPlacesArray();
    const localScore = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints).totalScore;
    const exactRank = await fetchExactLeaderboardRankForScore(localScore, context);

    rows.push(buildPersonalLeaderboardFallback(user, visitedPlaces, localScore, exactRank));
    return rows;
}

function leaderboardQuery() {
    return firebase.firestore().collection('leaderboard').orderBy('totalPoints', 'desc');
}

function renderLeaderboard(topUsers) {
    if (topUsers) cachedLeaderboardData = topUsers;
    const data = cachedLeaderboardData;

    const listEl = document.getElementById('leaderboard-list');
    const rankEl = document.getElementById('personal-rank-display');
    const controlsEl = document.getElementById('leaderboard-controls');
    if (!listEl || !rankEl || !controlsEl) return;
    const leaderboardRenderer = getLeaderboardRenderer();
    if (!leaderboardRenderer) {
        console.error('[leaderboardEngine] leaderboardRenderer unavailable; leaderboard render skipped.');
        return;
    }

    listEl.innerHTML = '';
    const uid = (typeof firebase !== 'undefined' && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : null;
    let personalRank = '--';
    let personalUserObj = null;

    data.forEach((user, index) => {
        let rank = index + 1;
        if (user.isPersonalFallback) rank = leaderboardRenderer.getSafeLeaderboardRank(user.exactRank);
        if (user.uid === uid) { personalRank = rank; personalUserObj = user; }
    });

    // Rendering is where this user's rank is finally known, so it's also where the
    // achievements refresh is triggered from (only if the rank actually moved).
    if (uid) setCurrentLeaderboardRank(personalRank);

    if (rankEl) rankEl.textContent = 'Rank: ' + leaderboardRenderer.formatLeaderboardRank(personalRank);

    data.forEach((user, index) => {
        if (user.isPersonalFallback) return;
        const rank = index + 1;
        listEl.appendChild(leaderboardRenderer.createLeaderboardRow({
            user,
            rank,
            currentUid: uid,
            previousUser: data[rank - 2]
        }));
    });

    // The signed-in user, pinned at the bottom with their real rank.
    if (personalUserObj && personalUserObj.isPersonalFallback) {
        const exactRank = leaderboardRenderer.getSafeLeaderboardRank(personalUserObj.exactRank);
        listEl.appendChild(leaderboardRenderer.createLeaderboardRow({
            user: personalUserObj,
            rank: exactRank,
            currentUid: uid,
            isPinnedSelf: true,
            previousUser: data[exactRank - 2]
        }));
    }

    if (data.length === 0) {
        window.BARK.safeUpdateHTML('leaderboard-list', '<li style="color: #888; font-style: italic; text-align: center; padding: 10px 0;">No leaderboard data yet.</li>');
    }

    controlsEl.innerHTML = '';
    if (lastLeaderboardDoc) {
        if (
            window.BARK &&
            typeof window.BARK.isLaunchFlagEnabled === 'function' &&
            !window.BARK.isLaunchFlagEnabled('leaderboardDeepBrowsingEnabled')
        ) {
            const pausedNote = document.createElement('div');
            pausedNote.id = 'lb-load-more-disabled';
            pausedNote.textContent = window.BARK.getLaunchFlagMessage('leaderboardDeepBrowsingEnabled');
            pausedNote.style.cssText = 'color: #64748b; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 8px; padding: 10px; font-size: 12px; font-weight: 700; text-align: center; margin-top: 5px;';
            controlsEl.appendChild(pausedNote);
            return;
        }

        const showMoreBtn = document.createElement('button');
        showMoreBtn.id = 'lb-load-more-btn';
        showMoreBtn.textContent = 'Show More (+5)';
        showMoreBtn.style.cssText = 'width: 100%; background: rgba(0,0,0,0.05); border: 1px dashed rgba(0,0,0,0.2); border-radius: 8px; padding: 10px; font-size: 13px; cursor: pointer; color: #555; font-weight: 700; margin-top: 5px;';
        showMoreBtn.onclick = loadMoreLeaderboard;
        controlsEl.appendChild(showMoreBtn);
    }
}

/**
 * Load the first page only if this session hasn't already. authService calls this
 * when a user signs in, which can fire more than once per session.
 */
async function loadLeaderboardOnce() {
    if (hasLoadedOnce) return;
    hasLoadedOnce = true;
    return loadLeaderboard();
}

/** First page of the leaderboard. Always refetches; see loadLeaderboardOnce(). */
async function loadLeaderboard() {
    if (typeof firebase === 'undefined') return;
    try {
        window.BARK.incrementRequestCount();
        const snapshot = await leaderboardQuery().limit(5).get();

        lastLeaderboardDoc = snapshot.empty ? null : snapshot.docs[snapshot.docs.length - 1];

        const rows = [];
        snapshot.forEach(doc => rows.push(toLeaderboardRow(doc)));
        await appendPersonalFallbackIfMissing(rows, 'leaderboard-load');

        cachedLeaderboardData = rows;
        renderLeaderboard(cachedLeaderboardData);
    } catch (err) {
        console.error('[leaderboardEngine] Leaderboard load error:', err);
    }
}

/** Next page, appended to what's already on screen. */
async function loadMoreLeaderboard() {
    if (!lastLeaderboardDoc || isFetchingMoreLeaderboard) return;
    if (
        window.BARK &&
        typeof window.BARK.isLaunchFlagEnabled === 'function' &&
        !window.BARK.isLaunchFlagEnabled('leaderboardDeepBrowsingEnabled')
    ) {
        renderLeaderboard(cachedLeaderboardData);
        return;
    }
    isFetchingMoreLeaderboard = true;
    const btn = document.getElementById('lb-load-more-btn');
    if (btn) btn.textContent = 'Loading...';

    try {
        window.BARK.incrementRequestCount();
        const snapshot = await leaderboardQuery().startAfter(lastLeaderboardDoc).limit(5).get();
        if (snapshot.empty) {
            lastLeaderboardDoc = null;
            renderLeaderboard(cachedLeaderboardData);
            return;
        }
        lastLeaderboardDoc = snapshot.docs[snapshot.docs.length - 1];

        // Drop the pinned self row; the next page may contain the real one, and if it
        // doesn't, appendPersonalFallbackIfMissing puts it back below.
        cachedLeaderboardData = cachedLeaderboardData.filter(u => !u.isPersonalFallback);

        snapshot.forEach(doc => {
            if (!cachedLeaderboardData.find(u => u.uid === doc.id)) {
                cachedLeaderboardData.push(toLeaderboardRow(doc));
            }
        });

        await appendPersonalFallbackIfMissing(cachedLeaderboardData, 'leaderboard-load-more');

        renderLeaderboard(cachedLeaderboardData);
    } catch (err) {
        console.error('[leaderboardEngine] Error fetching more leaderboard:', err);
    } finally {
        isFetchingMoreLeaderboard = false;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

window.BARK.syncScoreToLeaderboard = syncScoreToLeaderboard;
window.BARK.getCurrentLeaderboardRank = getCurrentLeaderboardRank;
window.BARK.setCurrentLeaderboardRank = setCurrentLeaderboardRank;
window.BARK.loadLeaderboard = loadLeaderboard;
window.BARK.loadLeaderboardOnce = loadLeaderboardOnce;
window.BARK.loadMoreLeaderboard = loadMoreLeaderboard;
window.BARK.renderLeaderboard = renderLeaderboard;

// The ONLY way to clear leaderboard session state. authService calls this on logout
// and account switch; adding a new field above needs no change at the call sites.
window.BARK.resetLeaderboardState = resetLeaderboardState;
window.BARK.getLeaderboardSyncState = getLeaderboardSyncState;
