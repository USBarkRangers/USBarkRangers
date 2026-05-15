/**
 * profileEngine.js — Gamification, Achievement Vault, Leaderboard, Stats UI
 * Loaded SEVENTH in the boot sequence.
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

// ====== MANAGE PORTAL ======
function padDatePart(value) {
    return String(value).padStart(2, '0');
}

function formatVisitDateInputValue(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return '';

    return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function renderManagePortal() {
    const listEl = document.getElementById('manage-places-list');
    const countEl = document.getElementById('manage-portal-count');
    if (!listEl || !countEl) return;

    const visitedPlaces = getProfileVisitedPlacesArray();
    countEl.textContent = visitedPlaces.length;
    if (visitedPlaces.length === 0) {
        listEl.innerHTML = '<li style="color: #888; font-style: italic; padding: 10px 0;">Get exploring!</li>';
        return;
    }

    listEl.innerHTML = '';
    const placesArray = visitedPlaces.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    placesArray.forEach(place => {
        const li = document.createElement('li');
        li.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 1px solid rgba(0,0,0,0.05);';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = place.verified ? `🐾 ${place.name}` : place.name;
        nameSpan.style.cssText = 'font-weight: 600; color: #333; flex: 1;';

        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText = 'background: #fee2e2; color: #dc2626; border: none; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800;';
        removeBtn.onclick = () => window.BARK.removeVisitedPlace(place.id);

        topRow.appendChild(nameSpan);
        topRow.appendChild(removeBtn);

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.style.cssText = 'font-size: 11px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; flex: 1;';
        if (place.ts) {
            dateInput.value = formatVisitDateInputValue(place.ts);
        }

        const updateBtn = document.createElement('button');
        updateBtn.textContent = 'Update';
        updateBtn.style.cssText = 'background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer;';
        updateBtn.onclick = async () => {
            if (dateInput.value) {
                const newTs = new Date(dateInput.value + 'T12:00:00').getTime();
                updateBtn.disabled = true;
                try {
                    await window.BARK.updateVisitDate(place.id, newTs);
                    alert(`${place.name} date updated!`);
                } catch (error) {
                    alert(`Could not update ${place.name}. Please try again.`);
                } finally {
                    updateBtn.disabled = false;
                }
            }
        };

        controls.appendChild(dateInput);
        controls.appendChild(updateBtn);

        li.appendChild(topRow);
        li.appendChild(controls);
        listEl.appendChild(li);
    });
}

window.BARK.renderManagePortal = renderManagePortal;

// ====== LEADERBOARD SYNC ======
let cachedLeaderboardData = [];
let _leaderboardSyncInProgress = false;
let _leaderboardSyncQueued = false;
let _leaderboardSyncRetryTimer = null;
let _lastLeaderboardSyncAttemptTime = 0;
let _lastLeaderboardSyncAttemptFingerprint = null;
const LEADERBOARD_SYNC_RETRY_DELAY_MS = 10000;
const LEADERBOARD_SYNC_WRITE_RETRY_MS = 250;

function getCurrentFirebaseUser() {
    if (typeof firebase === 'undefined' || !firebase.auth) return null;

    try {
        return firebase.auth().currentUser || null;
    } catch (error) {
        console.warn('[profileEngine] Firebase auth unavailable for leaderboard sync:', error);
        return null;
    }
}

function getFunctionsForLeaderboardSync() {
    if (typeof firebase === 'undefined' || !firebase.functions) return null;

    try {
        return firebase.functions();
    } catch (error) {
        console.warn('[profileEngine] Functions unavailable for leaderboard sync:', error);
        return null;
    }
}

function getFirebaseVisitedWriteState() {
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    return Boolean(
        firebaseService &&
        typeof firebaseService.hasVisitedPlacesWriteInFlight === 'function' &&
        firebaseService.hasVisitedPlacesWriteInFlight()
    );
}

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

async function syncScoreToLeaderboard() {
    const now = Date.now();

    const user = getCurrentFirebaseUser();
    if (!user) return;

    const visitedPlaces = getProfileVisitedPlacesArray();
    const scoreSummary = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints);
    const totalScore = scoreSummary.totalScore;
    const totalVisitedCount = getProfileTotalVisitedCount(visitedPlaces, scoreSummary);
    const hasVerified = hasProfileVerifiedVisit(visitedPlaces);
    const localFingerprint = getLeaderboardSyncFingerprint(totalScore, totalVisitedCount, hasVerified);

    if (localFingerprint === window._lastSyncedLeaderboardFingerprint) return;

    if (_leaderboardSyncInProgress) {
        _leaderboardSyncQueued = true;
        scheduleQueuedLeaderboardSync(LEADERBOARD_SYNC_WRITE_RETRY_MS);
        return;
    }

    if (getFirebaseVisitedWriteState()) {
        _leaderboardSyncQueued = true;
        scheduleQueuedLeaderboardSync(LEADERBOARD_SYNC_WRITE_RETRY_MS);
        return;
    }

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

        const syncLeaderboardScore = functionsService.httpsCallable('syncLeaderboardScore');
        const response = await syncLeaderboardScore({ requestedAt: now });
        const synced = response && response.data ? response.data : {};
        const syncedScore = Number(synced.totalPoints);
        const syncedVisited = Number(synced.totalVisited);
        const leaderboardScore = Number.isFinite(syncedScore) ? syncedScore : totalScore;
        const leaderboardVisitedCount = Number.isFinite(syncedVisited) ? syncedVisited : totalVisitedCount;
        const leaderboardHasVerified = synced.hasVerified === undefined ? hasVerified : !!synced.hasVerified;

        window._lastSyncedScore = leaderboardScore;
        window._lastSyncedLeaderboardFingerprint = getLeaderboardSyncFingerprint(
            leaderboardScore,
            leaderboardVisitedCount,
            leaderboardHasVerified
        );
        const exactRank = await fetchExactLeaderboardRankForScore(leaderboardScore, 'score-sync');
        setCurrentLeaderboardRank(exactRank, { refreshAchievements: true });

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
        console.warn('[profileEngine] Server leaderboard sync failed; local profile rendering will continue.', error);
    } finally {
        _leaderboardSyncInProgress = false;
        scheduleQueuedLeaderboardSync();
    }
}

window.BARK.syncScoreToLeaderboard = syncScoreToLeaderboard;

// ====== EVALUATE ACHIEVEMENTS ======
async function evaluateAchievements(visitedPlacesMap) {
    try {
    const visitedArray = getProfileVisitedPlacesArray(visitedPlacesMap).map(rawVisit => {
        if (!rawVisit || typeof rawVisit !== 'object') return rawVisit;

        const visit = { ...rawVisit };
        const parkRepo = getParkRepo();
        if (!visit.state && parkRepo && typeof parkRepo.getById === 'function') {
            const mapPoint = parkRepo.getById(visit.id);
            if (mapPoint && mapPoint.state) visit.state = mapPoint.state;
        }
        return visit;
    });
    const userLocationMarker = window.BARK.getUserLocationMarker();
    const parkRepo = getParkRepo();
    const allPoints = parkRepo ? parkRepo.getAll() : [];

    let userId = null;
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
        userId = firebase.auth().currentUser.uid;
    }

    const achievements = await window.gamificationEngine.evaluateAndStoreAchievements(userId, visitedArray, getCurrentLeaderboardRank(), window.currentWalkPoints || 0);

    // Update Banner
    const titleEl = document.getElementById('current-title-label');
    const scoreEl = document.getElementById('stat-score');
    const progressFill = document.getElementById('tier-progress-fill');
    const fractionEl = document.getElementById('rank-progress-fraction');

    if (titleEl) {
        const oldTitle = window._lastKnownRank || titleEl.textContent || 'B.A.R.K. Trainee';
        const newTitle = achievements.title;
        const isAuth = typeof firebase !== 'undefined' && firebase.auth().currentUser;
        const isSecurelyHydrated = window._serverPayloadSettled;

        if (isAuth && isSecurelyHydrated && window._lastKnownRank && oldTitle !== newTitle && newTitle !== 'B.A.R.K. Trainee') {
            showRankUpCelebration(oldTitle, newTitle);
        }

        window._lastKnownRank = newTitle;
        titleEl.textContent = newTitle;
    }
    if (scoreEl) scoreEl.textContent = achievements.totalScore;

    if (userId) await syncScoreToLeaderboard();

    if (progressFill) {
        const thresholds = [10, 25, 50, 100, 200, 300, 500];
        const next = thresholds.find(t => t > achievements.totalScore) || 500;
        const prev = thresholds[thresholds.indexOf(next) - 1] || 0;
        const pct = Math.min(100, ((achievements.totalScore - prev) / (next - prev)) * 100);
        progressFill.style.width = pct + "%";

        if (fractionEl) {
            if (achievements.totalScore >= 500) {
                fractionEl.textContent = 'MAX RANK ACHIEVED 🏆';
                progressFill.style.width = "100%";
            } else {
                fractionEl.textContent = `${achievements.totalScore} / ${next} PTS`;
            }
        }
    }

    const getSubtitle = (b) => {
        let s = b.desc || b.hint || '';
        if (!s && b.id.includes('Paw')) s = 'Verified Check-ins';
        if (!s && b.id.includes('state')) s = '100% cleared!!';
        return s;
    };

    const esc = (str) => String(str || '').replace(/'/g, "\\'");
    const escAttr = (str) => String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const getFlipSceneAttrs = (b) => {
        if (b.status !== 'unlocked') return 'class="flip-scene"';
        return `class="flip-scene is-unlocked" role="button" tabindex="0" aria-pressed="false" aria-label="Flip ${escAttr(b.name)} badge"`;
    };

    const renderStateBadge = (b) => {
        const isU = b.status === 'unlocked';
        const tCl = isU ? (b.tier === 'verified' ? 'verified-tier' : 'honor-tier') : 'locked-tier';
        const datePlaceholder = b.dateEarned || '--/--/----';
        const upgradeCta = (isU && b.tier === 'honor') ? '<div class="upgrade-pill">⭐ VERIFY TO UPGRADE</div>' : '';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', '${esc(b.tier)}', false, '${esc(sub)}')" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; color: white; font-size: 9px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">📸 SHARE</button>` : '';

        let progressHtml = '';
        if (!isU && typeof b.percentComplete !== 'undefined') {
            const pct = b.percentComplete;
            progressHtml = `
            <div class="state-progress-wrap">
                <div class="state-progress-track">
                    <div class="state-progress-fill" style="width: ${pct}%;"></div>
                </div>
                <span class="state-progress-text">${pct}%</span>
            </div>`;
        }

        return `
        <div ${getFlipSceneAttrs(b)}>
            <div class="skeuo-badge ${tCl} ${isU ? 'unlocked hover-float' : 'locked'}">
                <div class="badge-face badge-front">
                    <div class="badge-icon">${b.icon}</div>
                    <div class="badge-details">
                        <h4>${b.name}</h4>
                        <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || ''}</div>
                    </div>
                    ${progressHtml}
                </div>
                <div class="badge-face badge-back">
                    <div class="engraved-date">EST. ${datePlaceholder}</div>
                    ${upgradeCta}
                    ${shareBtnHtml}
                </div>
            </div>
        </div>`;
    };

    const renderCoin = (b) => {
        const isU = b.status === 'unlocked';
        const tCl = isU ? (b.tier === 'verified' ? 'verified-tier' : 'honor-tier') : 'locked-tier';
        const upgradeCta = (isU && b.tier === 'honor') ? '<div class="upgrade-pill">⭐ VERIFY TO UPGRADE</div>' : '';
        const datePlaceholder = b.dateEarned || '--/--/----';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', '${esc(b.tier)}', false, '${esc(sub)}')" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; color: white; font-size: 9px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">📸 SHARE</button>` : '';

        return `
        <div ${getFlipSceneAttrs(b)}>
            <div class="skeuo-badge ${tCl} ${isU ? 'unlocked hover-float' : 'locked'}">
                <div class="badge-face badge-front">
                    <div class="badge-icon">${b.icon}</div>
                    <div class="badge-details">
                        <h4>${b.name}</h4>
                        <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || ''}</div>
                    </div>
                </div>
                <div class="badge-face badge-back">
                    <div class="engraved-date">EST. ${datePlaceholder}</div>
                    ${upgradeCta}
                    ${shareBtnHtml}
                </div>
            </div>
        </div>`;
    };

    const renderDossier = (b) => {
        const isU = b.status === 'unlocked';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', 'verified', true, '${esc(sub)}')" class="mystery-share-btn" title="Share Milestone">📸</button>` : '';

        return `
        <div class="mystery-card ${isU ? 'unlocked' : 'locked'}">
            <div class="mystery-icon">${isU ? b.icon : '?'}</div>
            <div class="mystery-info">
                <div class="mystery-title">${isU ? b.name : '[CLASSIFIED]'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || b.hint || ''}</div>
            </div>
            ${shareBtnHtml}
        </div>`;
    };

    window.BARK.safeUpdateHTML('rare-feats-grid', achievements.rareFeats.map(renderCoin).join(''));
    window.BARK.safeUpdateHTML('paws-grid', achievements.paws.map(renderCoin).join(''));

    // --- STATES SORT: DISTANCE & COMPLETION ---
    const stateDistances = {};
    const refLatLng = userLocationMarker ? userLocationMarker.getLatLng() : map.getCenter();

    if (allPoints && allPoints.length > 0) {
        allPoints.forEach(p => {
            if (p.state && p.lat && p.lng) {
                const sts = String(p.state).split(/[,/]/);
                const dist = window.BARK.haversineDistance(refLatLng.lat, refLatLng.lng, parseFloat(p.lat), parseFloat(p.lng));
                sts.forEach(s => {
                    const cleanSt = window.gamificationEngine.getNormalizedStateCode(s);
                    if (cleanSt) {
                        if (stateDistances[cleanSt] === undefined || dist < stateDistances[cleanSt]) {
                            stateDistances[cleanSt] = dist;
                        }
                    }
                });
            }
        });
    }

    let minOverallDist = Infinity;
    let currentStateCode = null;
    for (const [code, dist] of Object.entries(stateDistances)) {
        if (dist < minOverallDist) { minOverallDist = dist; currentStateCode = code; }
    }

    achievements.stateBadges.sort((a, b) => {
        const aCode = a.id.replace('state-', '').toUpperCase();
        const bCode = b.id.replace('state-', '').toUpperCase();
        const aIsCurrent = aCode === currentStateCode;
        const bIsCurrent = bCode === currentStateCode;
        if (aIsCurrent && !bIsCurrent) return -1;
        if (!aIsCurrent && bIsCurrent) return 1;
        const aUnlocked = a.status === 'unlocked';
        const bUnlocked = b.status === 'unlocked';
        if (aUnlocked && !bUnlocked) return -1;
        if (!aUnlocked && bUnlocked) return 1;
        if (aUnlocked && bUnlocked) return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0);
        const aDist = stateDistances[aCode] !== undefined ? stateDistances[aCode] : Infinity;
        const bDist = stateDistances[bCode] !== undefined ? stateDistances[bCode] : Infinity;
        return aDist - bDist;
    });

    const nationalCardHtml = `
        <div class="flip-scene" style="flex: 0 0 auto; width: 140px; scroll-snap-align: center;">
            <div class="skeuo-badge" style="background: linear-gradient(135deg, #0f172a, #1e293b); border: 2px solid #3b82f6; box-shadow: 0 4px 15px rgba(59,130,246,0.3); border-radius: 16px; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px; text-align: center;">
                <div style="font-size: 28px; margin-bottom: 4px;">🇺🇸</div>
                <h4 style="color: #f1f5f9; font-size: 12px; font-weight: 900; text-transform: uppercase; margin: 0 0 8px 0;">National Map</h4>
                <div style="width: 80%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden; margin-bottom: 4px;">
                    <div style="width: ${achievements.nationalProgress.percentComplete}%; height: 100%; background: linear-gradient(90deg, #38bdf8, #3b82f6); box-shadow: 0 0 8px rgba(56,189,248,0.6);"></div>
                </div>
                <span style="color: #94a3b8; font-size: 9px; font-weight: 800;">${achievements.nationalProgress.totalVisited} / ${achievements.nationalProgress.totalParks} SITES</span>
            </div>
        </div>`;

    window.BARK.safeUpdateHTML('states-grid', nationalCardHtml + achievements.stateBadges.map(renderStateBadge).join(''));
    window.BARK.safeUpdateHTML('mystery-feats-dossier', achievements.mysteryFeats.map(renderDossier).join(''));

    document.querySelectorAll('.flip-scene.is-unlocked').forEach(scene => {
        const toggleFlip = () => {
            const isFlipped = scene.classList.toggle('is-flipped');
            scene.setAttribute('aria-pressed', isFlipped ? 'true' : 'false');
        };

        scene.onclick = (event) => {
            if (event.target.closest('button, a, input, select, textarea')) return;
            toggleFlip();
        };

        scene.onkeydown = (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            toggleFlip();
        };
    });

    // Re-bind tab listeners
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const content = document.getElementById(btn.dataset.tab + '-content');
            if (content) content.classList.add('active');
        };
    });
    } catch (error) {
        console.error('[profileEngine] Achievement evaluation/render failed; profile update skipped.', {
            visitedCount: visitedPlacesMap && typeof visitedPlacesMap.size === 'number' ? visitedPlacesMap.size : null,
            currentWalkPoints: window.currentWalkPoints || 0,
            error
        });
    }
}

window.BARK.evaluateAchievements = evaluateAchievements;

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

// ====== LEADERBOARD ======
window._lastLeaderboardDoc = null;
window._lastKnownLeaderboardRank = null;
let isFetchingMoreLeaderboard = false;
let leaderboardRankAchievementRefreshInProgress = false;

function getLeaderboardRenderer() {
    return window.BARK && window.BARK.leaderboardRenderer;
}

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
    return getSafeLeaderboardRankValue(window._lastKnownLeaderboardRank);
}

function requestAchievementRefreshForLeaderboardRank() {
    if (leaderboardRankAchievementRefreshInProgress) return;
    if (typeof window.BARK.evaluateAchievements !== 'function') return;

    if (typeof window.syncState === 'function') {
        window.syncState();
        return;
    }

    leaderboardRankAchievementRefreshInProgress = true;
    Promise.resolve(window.BARK.evaluateAchievements())
        .catch(error => console.error('[profileEngine] Leaderboard-rank achievement refresh failed:', error))
        .finally(() => {
            leaderboardRankAchievementRefreshInProgress = false;
        });
}

function setCurrentLeaderboardRank(rank, options = {}) {
    const previousRank = getCurrentLeaderboardRank();
    const nextRank = getSafeLeaderboardRankValue(rank);
    window._lastKnownLeaderboardRank = nextRank;

    if (options.refreshAchievements && previousRank !== nextRank) {
        requestAchievementRefreshForLeaderboardRank();
    }

    return nextRank;
}

window.BARK.getCurrentLeaderboardRank = getCurrentLeaderboardRank;
window.BARK.setCurrentLeaderboardRank = setCurrentLeaderboardRank;

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

async function fetchExactLeaderboardRankForScore(localScore, context = 'leaderboard') {
    const user = getCurrentFirebaseUser();
    if (!user || typeof firebase === 'undefined' || !firebase.app || typeof fetch !== 'function') return null;

    try {
        const projectId = firebase.app().options.projectId;
        const idToken = await user.getIdToken();
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runAggregationQuery`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: 'leaderboard' }], where: { fieldFilter: { field: { fieldPath: 'totalPoints' }, op: 'GREATER_THAN', value: Number.isInteger(localScore) ? { integerValue: localScore } : { doubleValue: localScore } } } }, aggregations: [{ alias: 'rankCount', count: {} }] } })
        });
        const countData = await response.json();
        const countMatched = parseLeaderboardRankCount(countData);
        return countMatched !== null ? countMatched + 1 : null;
    } catch (error) {
        console.warn(`REST API aggregate rank lookup failed (${context}).`, error);
        return null;
    }
}

function buildPersonalLeaderboardFallback(user, visitedPlaces, localScore, exactRank = null) {
    const visitedPlacesArray = getProfileVisitedPlacesArray(visitedPlaces);
    const scoreSummary = window.BARK.calculateVisitScore(visitedPlacesArray, window.currentWalkPoints);
    return {
        uid: user.uid,
        displayName: user.displayName || 'Bark Ranger',
        totalPoints: localScore,
        totalVisited: getProfileTotalVisitedCount(visitedPlacesArray, scoreSummary),
        hasVerified: hasProfileVerifiedVisit(visitedPlacesArray),
        isPersonalFallback: true,
        exactRank: getLeaderboardRenderer().getSafeLeaderboardRank(exactRank)
    };
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
        console.error('[profileEngine] leaderboardRenderer unavailable; leaderboard render skipped.');
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

    if (uid) setCurrentLeaderboardRank(personalRank, { refreshAchievements: true });

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
    if (window._lastLeaderboardDoc) {
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

async function loadLeaderboard() {
    if (typeof firebase === 'undefined') return;
    try {
        window.BARK.incrementRequestCount();
        const snapshot = await firebase.firestore().collection('leaderboard').orderBy('totalPoints', 'desc').limit(5).get();
        let topUsers = [];
        if (!snapshot.empty) window._lastLeaderboardDoc = snapshot.docs[snapshot.docs.length - 1];
        else window._lastLeaderboardDoc = null;

        snapshot.forEach(doc => {
            const d = doc.data();
            topUsers.push({ uid: doc.id, displayName: d.displayName || 'Bark Ranger', totalPoints: d.totalPoints !== undefined ? d.totalPoints : (d.totalVisited || 0), totalVisited: d.totalVisited || 0, hasVerified: !!d.hasVerified });
        });

        const user = firebase.auth().currentUser;
        if (user && !topUsers.find(u => u.uid === user.uid)) {
            const visitedPlaces = getProfileVisitedPlacesArray();
            const localScore = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints).totalScore;

            const exactRank = await fetchExactLeaderboardRankForScore(localScore, 'leaderboard-load');

            topUsers.push(buildPersonalLeaderboardFallback(user, visitedPlaces, localScore, exactRank));
        }

        cachedLeaderboardData = topUsers;
        renderLeaderboard(cachedLeaderboardData);
    } catch (err) { console.error('Leaderboard load error:', err); }
}

async function loadMoreLeaderboard() {
    if (!window._lastLeaderboardDoc || isFetchingMoreLeaderboard) return;
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
        const snapshot = await firebase.firestore().collection('leaderboard').orderBy('totalPoints', 'desc').startAfter(window._lastLeaderboardDoc).limit(5).get();
        if (snapshot.empty) { window._lastLeaderboardDoc = null; renderLeaderboard(cachedLeaderboardData); return; }
        window._lastLeaderboardDoc = snapshot.docs[snapshot.docs.length - 1];
        cachedLeaderboardData = cachedLeaderboardData.filter(u => !u.isPersonalFallback);

        snapshot.forEach(doc => {
            if (!cachedLeaderboardData.find(u => u.uid === doc.id)) {
                const d = doc.data();
                cachedLeaderboardData.push({ uid: doc.id, displayName: d.displayName || 'Bark Ranger', totalPoints: d.totalPoints !== undefined ? d.totalPoints : (d.totalVisited || 0), totalVisited: d.totalVisited || 0, hasVerified: !!d.hasVerified });
            }
        });

        const user = firebase.auth().currentUser;
        if (user && !cachedLeaderboardData.find(u => u.uid === user.uid)) {
            const visitedPlaces = getProfileVisitedPlacesArray();
            const localScore = window.BARK.calculateVisitScore(visitedPlaces, window.currentWalkPoints).totalScore;
            const exactRank = await fetchExactLeaderboardRankForScore(localScore, 'leaderboard-load-more');

            cachedLeaderboardData.push(buildPersonalLeaderboardFallback(user, visitedPlaces, localScore, exactRank));
        }

        renderLeaderboard(cachedLeaderboardData);
    } catch (err) { console.error('Error fetching more leaderboard:', err); }
    finally { isFetchingMoreLeaderboard = false; }
}

window.BARK.loadLeaderboard = loadLeaderboard;

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
