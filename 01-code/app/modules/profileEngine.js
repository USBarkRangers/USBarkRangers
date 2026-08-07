/**
 * profileEngine.js — the Profile screen: visit helpers, banner, stats, manage portal.
 *
 * WHAT THIS OWNS
 *   1. Visit helpers  — counting visits/states off VaultRepo. Shared with other modules.
 *   2. Manage portal  — the edit-your-visits UI.
 *   3. evaluateAchievements() — the profile refresh: asks gamificationLogic what the
 *      user has earned, updates the banner (title/score/progress), renders the vault,
 *      then triggers the leaderboard sync.
 *   4. Stats UI and the rank-up celebration.
 *
 * WHAT IT DOES NOT OWN
 *   The leaderboard. That is entirely modules/leaderboardEngine.js.
 *   Deciding which badges are earned. That is gamificationLogic.js.
 *
 * COLLABORATORS
 *   window.gamificationEngine        — decides earned badges (the "brain")
 *   window.BARK.getCurrentLeaderboardRank / syncScoreToLeaderboard — leaderboardEngine.js
 *
 * Cross-file calls go through window.BARK so load order cannot break them.
 */
window.BARK = window.BARK || {};

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function getProfileVisitedPlacesArray(source) {
    if (Array.isArray(source)) return source.slice();
    if (source instanceof Map) return Array.from(source.values());
    if (source && typeof source.values === 'function') return Array.from(source.values());

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.getVisits === 'function') {
        return vaultRepo.getVisits().slice();
    }

    return [];
}

function getProfileVisitedPlacesCount() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.size === 'function') return vaultRepo.size();
    return getProfileVisitedPlacesArray().length;
}

function hasProfileVisitedPlace(placeOrId) {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function') {
        return vaultRepo.hasVisit(placeOrId);
    }

    return false;
}

function hasProfileVerifiedVisit(visitedPlacesArray) {
    return getProfileVisitedPlacesArray(visitedPlacesArray).some(place => place && place.verified);
}

function getProfileVisitProgress(visitedPlacesArray) {
    const visits = getProfileVisitedPlacesArray(visitedPlacesArray);
    if (!window.gamificationEngine || typeof window.gamificationEngine.getVisitProgressMaps !== 'function') {
        return null;
    }

    try {
        return window.gamificationEngine.getVisitProgressMaps(visits);
    } catch (error) {
        console.warn('[profileEngine] Unique visit progress unavailable; using fallback counters.', error);
        return null;
    }
}

function getProfileTotalVisitedCount(visitedPlacesArray, scoreSummary = null) {
    const parsedScoreCount = Number(scoreSummary && scoreSummary.totalVisitedCount);
    if (Number.isFinite(parsedScoreCount)) return parsedScoreCount;

    const progress = getProfileVisitProgress(visitedPlacesArray);
    const parsedProgressCount = Number(progress && progress.totalVisitedSites);
    if (Number.isFinite(parsedProgressCount)) return parsedProgressCount;

    return getProfileVisitedPlacesArray(visitedPlacesArray).length;
}

function getProfileStateCount(visitedPlacesArray) {
    const progress = getProfileVisitProgress(visitedPlacesArray);
    if (progress && progress.stateVisitsTotalMap) {
        return Object.keys(progress.stateVisitsTotalMap).length;
    }

    const statesSet = new Set();
    const visits = getProfileVisitedPlacesArray(visitedPlacesArray);
    visits.forEach(visit => {
        const parkRepo = getParkRepo();
        const mapPoint = visit && visit.id && parkRepo && typeof parkRepo.getById === 'function'
            ? parkRepo.getById(visit.id)
            : null;
        const stateText = (mapPoint && mapPoint.state) || (visit && visit.state);
        const codes = window.gamificationEngine && typeof window.gamificationEngine.getNormalizedStateCodes === 'function'
            ? window.gamificationEngine.getNormalizedStateCodes(stateText)
            : String(stateText || '').split(/[,/]/).map(s => s.trim().toUpperCase()).filter(Boolean);

        codes.forEach(code => statesSet.add(code));
    });

    return statesSet.size;
}

// Shared visit helpers. leaderboardEngine.js reads these through window.BARK rather
// than importing them, so neither file depends on which script tag loads first.
window.BARK.getProfileVisitedPlacesArray = getProfileVisitedPlacesArray;
window.BARK.getProfileTotalVisitedCount = getProfileTotalVisitedCount;
window.BARK.hasProfileVerifiedVisit = hasProfileVerifiedVisit;

// ====== PROFILE REFRESH ======
//
// refreshProfile() is the one entry point that repaints the Profile screen. The
// flow is deliberately linear so it can be read top to bottom:
//
//   1. gamificationLogic decides what is earned        (the brain)
//   2. updateProfileBanner paints title/score/progress (this file)
//   3. achievementsPanel paints the vault              (achievementsPanel.js)
//   4. leaderboardEngine pushes the score              (leaderboardEngine.js)
//
// Each collaborator owns one job and none of them call back into this function
// except leaderboardEngine, once, when the user's rank actually changes.

// Visits do not always carry a state. Fill it in from the park catalogue so that
// state badges and "unique states" feats evaluate correctly.
function buildVisitedArrayWithStates(visitedPlacesMap) {
    return getProfileVisitedPlacesArray(visitedPlacesMap).map(rawVisit => {
        if (!rawVisit || typeof rawVisit !== 'object') return rawVisit;

        const visit = { ...rawVisit };
        const parkRepo = getParkRepo();
        if (!visit.state && parkRepo && typeof parkRepo.getById === 'function') {
            const mapPoint = parkRepo.getById(visit.id);
            if (mapPoint && mapPoint.state) visit.state = mapPoint.state;
        }
        return visit;
    });
}

// Points at which the user's title changes. Drives the "x / y PTS" progress bar.
const TITLE_THRESHOLDS = [10, 25, 50, 100, 200, 300, 500];

// The banner across the top of the Profile screen: title, score, progress to next
// title. Also fires the rank-up celebration when the title genuinely improves.
function updateProfileBanner(achievements) {
    const titleEl = document.getElementById('current-title-label');
    const scoreEl = document.getElementById('stat-score');
    const progressFill = document.getElementById('tier-progress-fill');
    const fractionEl = document.getElementById('rank-progress-fraction');

    if (titleEl) {
        const oldTitle = window._lastKnownRank || titleEl.textContent || 'B.A.R.K. Trainee';
        const newTitle = achievements.title;
        const isAuth = typeof firebase !== 'undefined' && firebase.auth().currentUser;

        // Only celebrate once server data has settled, otherwise a cold start would
        // congratulate the user for reaching a title they already had.
        const isSecurelyHydrated = window._serverPayloadSettled;

        if (isAuth && isSecurelyHydrated && window._lastKnownRank && oldTitle !== newTitle && newTitle !== 'B.A.R.K. Trainee') {
            showRankUpCelebration(oldTitle, newTitle);
        }

        window._lastKnownRank = newTitle;
        titleEl.textContent = newTitle;
    }

    if (scoreEl) scoreEl.textContent = achievements.totalScore;

    if (!progressFill) return;

    const next = TITLE_THRESHOLDS.find(t => t > achievements.totalScore) || 500;
    const prev = TITLE_THRESHOLDS[TITLE_THRESHOLDS.indexOf(next) - 1] || 0;
    const pct = Math.min(100, ((achievements.totalScore - prev) / (next - prev)) * 100);
    progressFill.style.width = pct + '%';

    if (!fractionEl) return;

    if (achievements.totalScore >= 500) {
        fractionEl.textContent = 'MAX RANK ACHIEVED 🏆';
        progressFill.style.width = '100%';
    } else {
        fractionEl.textContent = `${achievements.totalScore} / ${next} PTS`;
    }
}

// Hand an evaluated achievements object to the vault. The panel needs location
// context only for the states distance sort.
function renderVault(achievements) {
    if (!window.BARK.achievementsPanel || typeof window.BARK.achievementsPanel.render !== 'function') return;

    const parkRepo = getParkRepo();
    window.BARK.achievementsPanel.render(achievements, {
        userLocationMarker: window.BARK.getUserLocationMarker(),
        allPoints: parkRepo ? parkRepo.getAll() : []
    });
}

/**
 * Repaint the Profile screen from the current visit data.
 * Safe to call repeatedly; renderEngine debounces the callers.
 */
async function refreshProfile(visitedPlacesMap) {
    try {
        const visitedArray = buildVisitedArrayWithStates(visitedPlacesMap);

        let userId = null;
        if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
            userId = firebase.auth().currentUser.uid;
        }

        // Rank lives in leaderboardEngine.js and feeds the "Alpha Dog" badge.
        // Reached through window.BARK so script load order cannot break it.
        const currentRank = typeof window.BARK.getCurrentLeaderboardRank === 'function'
            ? window.BARK.getCurrentLeaderboardRank()
            : null;

        // 1. What has this user earned?
        const achievements = await window.gamificationEngine.evaluateAndStoreAchievements(
            userId, visitedArray, currentRank, window.currentWalkPoints || 0
        );

        // 2. Banner.
        updateProfileBanner(achievements);

        // 3. Vault.
        renderVault(achievements);

        // 4. Leaderboard, last, so the screen is already painted before we go to the
        //    network.
        if (userId && typeof window.BARK.syncScoreToLeaderboard === 'function') {
            await window.BARK.syncScoreToLeaderboard();

            // The sync may have discovered a new rank, and "Alpha Dog" unlocks at #1,
            // so the vault we painted in step 3 can be one badge out of date.
            //
            // This is deliberately a straight-line step rather than a callback from
            // leaderboardEngine. It runs AT MOST ONCE per refresh — there is no path
            // back into refreshProfile — which is what keeps achievements and the
            // leaderboard from being mutually recursive.
            const rankAfterSync = typeof window.BARK.getCurrentLeaderboardRank === 'function'
                ? window.BARK.getCurrentLeaderboardRank()
                : null;

            if (rankAfterSync !== currentRank) {
                const rerated = await window.gamificationEngine.evaluateAndStoreAchievements(
                    userId, visitedArray, rankAfterSync, window.currentWalkPoints || 0
                );
                renderVault(rerated);
            }
        }
    } catch (error) {
        console.error('[profileEngine] Profile refresh failed; profile update skipped.', {
            visitedCount: visitedPlacesMap && typeof visitedPlacesMap.size === 'number' ? visitedPlacesMap.size : null,
            currentWalkPoints: window.currentWalkPoints || 0,
            error
        });
    }
}

// `evaluateAchievements` is the historical name used by renderEngine.js and
// leaderboardEngine.js. Kept as an alias so those call sites stay untouched.
window.BARK.refreshProfile = refreshProfile;
window.BARK.evaluateAchievements = refreshProfile;

// ====== STATS UI ======
function updateStatsUI() {
    const scoreEl = document.getElementById('stat-score');
    const verifiedEl = document.getElementById('stat-verified');
    const regularEl = document.getElementById('stat-regular');
    const statesEl = document.getElementById('stat-states');
    const visitedPlaces = getProfileVisitedPlacesArray();

    if (!scoreEl || !verifiedEl || !regularEl || !statesEl) return;

    const scoreSummary = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints);
    const totalScore = scoreSummary.totalScore;
    const verifiedCount = scoreSummary.verifiedCount;
    const totalVisitedCount = getProfileTotalVisitedCount(visitedPlaces, scoreSummary);
    const stateCount = getProfileStateCount(visitedPlaces);

    scoreEl.textContent = totalScore;
    verifiedEl.textContent = verifiedCount;
    regularEl.textContent = totalVisitedCount;
    statesEl.textContent = stateCount;

    let level = 1;
    let max = 10;
    if (totalScore >= 100) { level = 4; max = totalScore; }
    else if (totalScore >= 51) { level = 3; max = 100; }
    else if (totalScore >= 11) { level = 2; max = 50; }

    const pbTitle = document.getElementById('reward-level-title');
    const pbStatus = document.getElementById('reward-level-status');
    const pbBar = document.getElementById('reward-progress-bar');
    if (pbTitle && pbStatus && pbBar) {
        if (level === 4) {
            pbTitle.textContent = "🏆 B.A.R.K. Master!";
            pbStatus.textContent = totalScore + " Pts";
            pbBar.style.width = "100%";
        } else {
            pbTitle.textContent = "Level " + level;
            pbStatus.textContent = totalScore + " / " + max + " Pts";
            const pct = Math.min(100, Math.round((totalScore / max) * 100));
            pbBar.style.width = pct + "%";
        }
    }

    renderManagePortal();
}

window.BARK.updateStatsUI = updateStatsUI;

// ====== RANK-UP CELEBRATION ======
function showRankUpCelebration(oldTitle, newTitle) {
    const overlay = document.createElement('div');
    overlay.id = 'rank-up-overlay';
    overlay.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15, 23, 42, 0.92); z-index: 99999; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: fadeInOverlay 0.3s ease-out; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);`;

    overlay.innerHTML = `
        <style>
            @keyframes fadeInOverlay { from { opacity: 0; } to { opacity: 1; } }
            @keyframes rankBounce { 0% { transform: scale(0.3); opacity: 0; } 50% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
            @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
            @keyframes confettiFall { 0% { transform: translateY(-100vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
        </style>
        <div style="text-align: center; animation: rankBounce 0.6s ease-out; max-width: 340px; padding: 0 20px;">
            <div style="font-size: 72px; margin-bottom: 16px; filter: drop-shadow(0 4px 12px rgba(245, 158, 11, 0.5));">🎖️</div>
            <div style="font-size: 12px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">RANK UP!</div>
            <div style="font-size: 14px; color: #64748b; margin-bottom: 4px; font-weight: 600; text-decoration: line-through; opacity: 0.6;">${oldTitle}</div>
            <div style="font-size: 10px; color: #f59e0b; margin-bottom: 8px;">▼</div>
            <div style="font-size: 28px; font-weight: 900; background: linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b); background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 2s linear infinite; margin-bottom: 20px; line-height: 1.3;">${newTitle}</div>
            <p style="font-size: 13px; color: #cbd5e1; line-height: 1.5; margin-bottom: 24px;">Congratulations, Ranger! Keep exploring to unlock the next rank.</p>
            <button onclick="document.getElementById('rank-up-overlay').remove()" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 14px 40px; border-radius: 12px; font-size: 14px; font-weight: 900; cursor: pointer; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);">🐾 Awesome!</button>
        </div>`;

    document.body.appendChild(overlay);

    const confettiColors = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];
    if (!window.lowGfxEnabled) {
        for (let i = 0; i < 40; i++) {
            const particle = document.createElement('div');
            const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
            const left = Math.random() * 100;
            const delay = Math.random() * 2;
            const duration = 2 + Math.random() * 3;
            const size = 6 + Math.random() * 8;
            particle.style.cssText = `position: fixed; top: -20px; left: ${left}%; width: ${size}px; height: ${size}px; background: ${color}; border-radius: ${Math.random() > 0.5 ? '50%' : '2px'}; z-index: 100000; pointer-events: none; animation: confettiFall ${duration}s ease-in ${delay}s forwards;`;
            overlay.appendChild(particle);
        }
    }

    setTimeout(() => { const el = document.getElementById('rank-up-overlay'); if (el) el.remove(); }, 8000);
}
