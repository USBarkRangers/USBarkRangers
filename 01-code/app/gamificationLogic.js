// Earned achievements live as a map on the user document (`achievements`), which
// the app already subscribes to, instead of a per-achievement subcollection that
// cost one read per earned badge on every session. `achievementsSchema` marks a
// user document whose map has been backfilled and is safe to read on its own.
const ACHIEVEMENT_SCHEMA_VERSION = 2;

class GamificationEngine {
    constructor(config = {}) {
        this.eastCoastStates = ['ME', 'NH', 'MA', 'RI', 'CT', 'NY', 'NJ', 'DE', 'MD', 'VA', 'NC', 'SC', 'GA', 'FL'];
        this.westCoastStates = ['WA', 'OR', 'CA'];
        this.stateCanonicalCounts = config.stateCanonicalCounts || {};
        this.parkSiteKeyById = new Map();
        this.totalSystemParks = Number.isFinite(Number(config.totalSystemParks)) ? Number(config.totalSystemParks) : 0;
        this.totalRawParkRows = 0;
        this.statesMetadata = {
            'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
            'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'FL': 'Florida', 'GA': 'Georgia',
            'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa',
            'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
            'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi', 'MO': 'Missouri',
            'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada', 'NH': 'New Hampshire', 'NJ': 'New Jersey',
            'NM': 'New Mexico', 'NY': 'New York', 'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio',
            'OK': 'Oklahoma', 'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
            'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont',
            'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming'
        };
        this.achievementsCache = null; // 🛑 Initialize memory cache
        this._sessionTimestamps = {};  // 🛡️ Session-level timestamp cache: once a badge is unlocked, its timestamp never changes

        // Earned achievements handed over from the user document snapshot.
        this._userDocAchievements = null;
        this._userDocSchema = 0;
        this._primedUserId = null;
        this._legacyVerified = false;

        // Legacy subcollection support. While older clients are still live they
        // only write the subcollection, so we must keep reading and writing it or
        // an achievement they earn would look "new" here and lose its date. Set
        // this false once every shipped client writes the map. Rollout phases:
        // 04-docs/plans/achievement-storage-migration.md
        this.legacySubcollectionEnabled = config.legacySubcollectionEnabled !== false;
    }

    // 🧹 Clear per-user caches on logout / account switch so one user's earned
    // achievements and timestamps can't leak into the next session. The engine
    // is a singleton (window.gamificationEngine), so without this a second user
    // signing in without a page reload would inherit the first user's vault.
    resetSession() {
        this.achievementsCache = null;
        this._sessionTimestamps = {};
        this._userDocAchievements = null;
        this._userDocSchema = 0;
        this._primedUserId = null;
        this._legacyVerified = false;
    }

    // Accepts earned achievements straight off the user document snapshot that
    // authService already subscribes to. This is the whole point of the
    // migration: the data arrives for free instead of costing one read per
    // earned badge. Safe to call on every snapshot.
    primeAchievementsFromUserDoc(userId, data) {
        if (!userId || !data || typeof data !== 'object') return;

        // A different user on the same singleton means the old cache is invalid.
        if (this._primedUserId && this._primedUserId !== userId) this.resetSession();
        this._primedUserId = userId;

        const stored = data.achievements;
        this._userDocAchievements = (stored && typeof stored === 'object') ? stored : {};
        this._userDocSchema = Number(data.achievementsSchema) || 0;
    }

    // Firestore Timestamps, Dates and raw epoch numbers all show up here
    // depending on whether a value came from the server, a pending local write
    // or our own cache. Normalise to milliseconds; 0 means "unknown".
    _toMillis(value) {
        if (!value) return 0;
        if (typeof value.toDate === 'function') {
            const parsed = value.toDate();
            return parsed ? parsed.getTime() : 0;
        }
        if (value instanceof Date) return value.getTime();
        const numeric = Number(value);
        return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    }

    // Between two records for the same achievement, keep the earlier earned date
    // and the stronger tier. Order-independent, so it does not matter whether the
    // map or the legacy subcollection is seen first.
    _mergeEarnedRecord(a, b) {
        if (!a) return b;
        if (!b) return a;
        const aMs = this._toMillis(a.dateEarned);
        const bMs = this._toMillis(b.dateEarned);
        const earlier = (aMs && bMs) ? (aMs <= bMs ? a : b) : (aMs ? a : b);
        const tier = (a.tier === 'verified' || b.tier === 'verified') ? 'verified' : (earlier.tier || a.tier || b.tier);
        return { tier, dateEarned: earlier.dateEarned };
    }

    // Returns { <achievementId>: { tier, dateEarned } } for everything already
    // earned, cached for the session. Costs zero reads once the user document map
    // is authoritative; falls back to the legacy subcollection otherwise.
    async _loadEarnedAchievements(achievementsRef) {
        if (this.achievementsCache) return this.achievementsCache;

        const fromUserDoc = this._userDocAchievements || {};
        const mapIsBackfilled = this._userDocSchema >= ACHIEVEMENT_SCHEMA_VERSION;

        // Fast path: the map has been backfilled, so trust it and read nothing.
        // The legacy subcollection can still hold a badge an older client wrote,
        // but that only changes the outcome if this session is about to record a
        // badge the map has never seen. _verifyAgainstLegacy handles that case
        // lazily, so a steady-state session costs zero achievement reads.
        if (mapIsBackfilled) {
            this.achievementsCache = { ...fromUserDoc };
            this._legacyVerified = !this.legacySubcollectionEnabled;
            return this.achievementsCache;
        }

        // Unmigrated user: pay for the legacy read one last time, then backfill.
        const merged = { ...fromUserDoc };
        try {
            const snap = await achievementsRef.get();
            snap.forEach(doc => {
                merged[doc.id] = this._mergeEarnedRecord(merged[doc.id], doc.data());
            });
        } catch (error) {
            // A failed legacy read must not wipe what the user document already
            // told us; fall back to the map rather than treating badges as new.
            console.warn('[gamification] legacy achievement read failed; using user document map.', error);
        }

        this._legacyVerified = true;
        this.achievementsCache = merged;
        return merged;
    }

    // Confirms an apparently-new badge against the legacy subcollection before we
    // stamp it with today's date. Older clients write only the subcollection, so
    // without this a badge they recorded would look brand new here and lose its
    // original earned date. Runs at most once per session, and only when a badge
    // is unlocked that the user document map has never seen.
    async _verifyAgainstLegacy(achievementsRef) {
        if (this._legacyVerified) return this.achievementsCache;
        this._legacyVerified = true;

        try {
            const snap = await achievementsRef.get();
            snap.forEach(doc => {
                this.achievementsCache[doc.id] = this._mergeEarnedRecord(this.achievementsCache[doc.id], doc.data());
            });
        } catch (error) {
            console.warn('[gamification] legacy achievement verification failed; treating map as complete.', error);
        }

        return this.achievementsCache;
    }

    // 🛡️ Returns a stable per-session timestamp for a given badge ID.
    // Once a badge gets a timestamp, it keeps it for the rest of the session.
    _getStableTimestamp(badgeId) {
        if (!this._sessionTimestamps[badgeId]) {
            this._sessionTimestamps[badgeId] = Date.now();
        }
        return this._sessionTimestamps[badgeId];
    }

    // Bulletproof lookup: Translates "Florida" -> "FL"
    getNormalizedStateCode(stateStr) {
        let st = String(stateStr || '').trim().toUpperCase().replace(/\s+/g, ' ');
        const aliases = {
            'MISSIPPI': 'MS',
            'D.C.': 'DC',
            'D.C': 'DC',
            'DC': 'DC',
            'DISTRICT OF COLUMBIA': 'DC',
            'WASHINGTON DC': 'DC',
            'WASHINGTON D.C.': 'DC'
        };
        if (aliases[st]) st = aliases[st];
        if (this.statesMetadata[st]) return st; 
        for (let code in this.statesMetadata) {
            if (this.statesMetadata[code].toUpperCase() === st) return code;
        }
        return null; 
    }

    getStateFragments(stateStr) {
        const stateText = String(stateStr || '').trim();
        if (!stateText) return [];

        return stateText
            .replace(/\bWashington\s*,\s*D\.?C\.?\b/gi, 'District of Columbia')
            .split(/[,/]/)
            .map(s => s.trim())
            .filter(Boolean);
    }

    getNormalizedStateCodes(stateStr) {
        return this.getStateFragments(stateStr)
            .map(s => this.getNormalizedStateCode(s))
            .filter(Boolean);
    }

    getNormalizedSiteName(value) {
        return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
    }

    getCoordinateKey(lat, lng) {
        const parsedLat = Number(lat);
        const parsedLng = Number(lng);
        if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLng)) return '';
        return `${parsedLat.toFixed(5)},${parsedLng.toFixed(5)}`;
    }

    getSiteIdentityKey(place) {
        if (!place || typeof place !== 'object') return '';

        const nameKey = this.getNormalizedSiteName(place.name);
        const coordinateKey = this.getCoordinateKey(place.lat, place.lng);
        if (nameKey && coordinateKey) return `${nameKey}|${coordinateKey}`;
        if (place.id) return `id:${place.id}`;
        if (nameKey) return `name:${nameKey}`;
        if (coordinateKey) return `coords:${coordinateKey}`;
        return '';
    }

    getCanonicalPointForVisit(visit) {
        const parkRepo = window.BARK && window.BARK.repos && window.BARK.repos.ParkRepo;
        if (!visit || !visit.id || !parkRepo || typeof parkRepo.getById !== 'function') return null;
        return parkRepo.getById(visit.id);
    }

    getVisitSiteIdentityKey(visit) {
        const canonicalPoint = this.getCanonicalPointForVisit(visit);
        return this.getSiteIdentityKey(canonicalPoint || visit);
    }

    getVisitStateCodes(visit) {
        const canonicalPoint = this.getCanonicalPointForVisit(visit);
        return this.getNormalizedStateCodes((canonicalPoint && canonicalPoint.state) || (visit && visit.state));
    }

    getVisitProgressMaps(visitedParksArray) {
        const totalSiteKeys = new Set();
        const verifiedSiteKeys = new Set();
        const stateVisitSets = {};
        const stateVerifiedSets = {};

        visitedParksArray.forEach((park, index) => {
            if (!park || typeof park !== 'object') return;

            const siteKey = this.getVisitSiteIdentityKey(park) || `visit:${index}`;
            totalSiteKeys.add(siteKey);
            if (park.verified) verifiedSiteKeys.add(siteKey);

            this.getVisitStateCodes(park).forEach(stClean => {
                stateVisitSets[stClean] = stateVisitSets[stClean] || new Set();
                stateVisitSets[stClean].add(siteKey);

                if (park.verified) {
                    stateVerifiedSets[stClean] = stateVerifiedSets[stClean] || new Set();
                    stateVerifiedSets[stClean].add(siteKey);
                }
            });
        });

        const toCountMap = sets => Object.keys(sets).reduce((acc, code) => {
            acc[code] = sets[code].size;
            return acc;
        }, {});

        return {
            totalVisitedSites: totalSiteKeys.size,
            verifiedVisitedSites: verifiedSiteKeys.size,
            stateVisitsTotalMap: toCountMap(stateVisitSets),
            stateVisitsVerifiedMap: toCountMap(stateVerifiedSets)
        };
    }

    // Replaces the messy logic in app.js
    updateCanonicalCountsFromPoints(points) {
        const stateSiteSets = {};
        const totalSiteKeys = new Set();
        const nextParkSiteKeyById = new Map();

        points.forEach(p => {
            const siteKey = this.getSiteIdentityKey(p);
            if (!siteKey) return;

            totalSiteKeys.add(siteKey);
            if (p.id) nextParkSiteKeyById.set(p.id, siteKey);

            this.getNormalizedStateCodes(p.state).forEach(stClean => {
                stateSiteSets[stClean] = stateSiteSets[stClean] || new Set();
                stateSiteSets[stClean].add(siteKey);
            });
        });

        const counts = {};
        Object.keys(stateSiteSets).forEach(code => {
            counts[code] = stateSiteSets[code].size;
        });

        if (window.BARK && window.BARK.debugDataRefresh === true && totalSiteKeys.size !== points.length) {
            console.info('[gamification] Collapsed duplicate physical sites for achievement totals.', {
                rawRows: points.length,
                uniqueSites: totalSiteKeys.size
            });
        }

        this.parkSiteKeyById = nextParkSiteKeyById;
        this.totalRawParkRows = points.length;
        this.stateCanonicalCounts = counts;
        this.totalSystemParks = totalSiteKeys.size;
    }

    getUniqueVisitCount(visitedParksArray) {
        return this.getVisitProgressMaps(visitedParksArray).totalVisitedSites;
    }

    getVerifiedUniqueVisitCount(visitedParksArray) {
        return this.getVisitProgressMaps(visitedParksArray).verifiedVisitedSites;
    }

    evaluate(visitedParksArray, userRank = null, walkPoints = 0) {
        const scoreSummary = window.BARK.calculateVisitScore(visitedParksArray, walkPoints);
        const visitProgress = this.getVisitProgressMaps(visitedParksArray);
        let totalScore = scoreSummary.totalScore;
        let verifiedCount = visitProgress.verifiedVisitedSites;
        let stateVisitsTotalMap = visitProgress.stateVisitsTotalMap;
        let stateVisitsVerifiedMap = visitProgress.stateVisitsVerifiedMap;

        const sortedVisits = [...visitedParksArray]
            .filter(p => p.ts)
            .sort((a, b) => a.ts - b.ts);

        const totalParks = Math.max(this.totalSystemParks || 1, 1);

        // Rare Feats now carries its classified sub-group inline: normal feats
        // first, classified feats after. One array, one renderer, one tab.
        const rareFeats = this.sortRareFeats([
            ...this.calculateRareFeats(stateVisitsTotalMap, stateVisitsVerifiedMap),
            ...this.calculateClassifiedFeats(visitedParksArray, userRank, sortedVisits, visitProgress)
        ]);

        return {
            totalScore: totalScore,
            title: this.calculateTitle(totalScore),
            paws: this.sortBadges(this.calculatePaws(visitProgress.totalVisitedSites, verifiedCount)),
            rareFeats: rareFeats,
            stateBadges: this.sortBadges(this.calculateStateBadges(stateVisitsTotalMap, stateVisitsVerifiedMap)),
            nationalProgress: {
                totalVisited: visitProgress.totalVisitedSites,
                totalParks: this.totalSystemParks || 1,
                percentComplete: Math.floor((visitProgress.totalVisitedSites / totalParks) * 100)
            }
        };
    }

    // The single place earned dates are applied to badge objects. Everything
    // else just decides what is earned; this decides what the card shows.
    _applyEarnedDates(items, earned, newlyEarnedIds) {
        for (const item of items) {
            if (item.status !== 'unlocked') {
                item.dateEarned = null;
                item.dateEarnedTs = 0;
                continue;
            }

            const record = earned[item.id];
            const storedMs = this._toMillis(record && record.dateEarned);
            const ms = storedMs || this._getStableTimestamp(item.id);

            this._sessionTimestamps[item.id] = ms;
            item.dateEarnedTs = ms;
            // Earned during this evaluation gets the celebratory label; the cache
            // already holds a real timestamp by now, so check the set, not the date.
            item.dateEarned = newlyEarnedIds.has(item.id)
                ? 'Just Now!'
                : new Date(ms).toLocaleDateString();
        }
    }

    async evaluateAndStoreAchievements(userId, visitedParksArray, userRank = null, walkPoints = 0) {
        const achievementsData = this.evaluate(visitedParksArray, userRank, walkPoints);
        if (!userId || typeof firebase === 'undefined') return achievementsData;

        const db = firebase.firestore();
        const userRef = db.collection('users').doc(userId);
        const achievementsRef = userRef.collection('achievements');
        // Classified feats now live inside rareFeats, so a single spread covers them.
        const allItems = [...achievementsData.rareFeats, ...achievementsData.paws, ...achievementsData.stateBadges];
        const newlyEarnedIds = new Set();

        try {
            let earned = await this._loadEarnedAchievements(achievementsRef);

            // Only if something is unlocked that we have never recorded do we need
            // the legacy subcollection, and then only to protect its earned date.
            // In a steady-state session this is false and no read happens at all.
            const hasUnrecordedUnlock = allItems.some(item => item.status === 'unlocked' && !earned[item.id]);
            if (hasUnrecordedUnlock) earned = await this._verifyAgainstLegacy(achievementsRef);

            const batch = db.batch();
            const mapUpdates = {};
            let hasWrites = false;

            // Existing users predate the map; backfill everything already earned
            // so this is the last session that pays for the legacy read.
            const needsBackfill = this._userDocSchema < ACHIEVEMENT_SCHEMA_VERSION;
            if (needsBackfill) {
                for (const id of Object.keys(earned)) {
                    const record = earned[id];
                    if (!record) continue;
                    // A legacy document can carry a null/pending dateEarned. Firestore
                    // rejects undefined outright, which would fail the whole batch, so
                    // fall back to a server timestamp rather than writing a hole.
                    mapUpdates[id] = {
                        tier: record.tier || 'honor',
                        dateEarned: record.dateEarned || firebase.firestore.FieldValue.serverTimestamp()
                    };
                    hasWrites = true;
                }
            }

            for (const item of allItems) {
                if (item.status !== 'unlocked') continue;

                const existing = earned[item.id];
                const isNew = !existing;
                const isUpgrade = Boolean(existing) && existing.tier === 'honor' && item.tier === 'verified';
                if (!isNew && !isUpgrade) continue;

                // Upgrades keep the original earned date; only new badges get "now".
                const dateEarned = (existing && existing.dateEarned)
                    ? existing.dateEarned
                    : firebase.firestore.FieldValue.serverTimestamp();

                mapUpdates[item.id] = { tier: item.tier, dateEarned };
                if (this.legacySubcollectionEnabled) {
                    batch.set(achievementsRef.doc(item.id), {
                        achievementId: item.id, tier: item.tier, dateEarned
                    }, { merge: true });
                }
                hasWrites = true;
                if (isNew) newlyEarnedIds.add(item.id);

                // Update the cache immediately so a re-entrant evaluate in the
                // same session cannot queue the same write twice.
                earned[item.id] = {
                    tier: item.tier,
                    dateEarned: (existing && existing.dateEarned) ? existing.dateEarned : this._getStableTimestamp(item.id)
                };
            }

            // needsBackfill on its own is enough to justify the write. A brand new
            // account has nothing earned and nothing to record, but without the
            // schema marker it would repeat the (empty) legacy read on every single
            // session forever. One write now buys permanent silence, and an empty
            // merged map cannot clobber anything.
            if (hasWrites || needsBackfill) {
                // One merged field update replaces up to 65 subcollection writes.
                batch.set(userRef, {
                    achievements: mapUpdates,
                    achievementsSchema: ACHIEVEMENT_SCHEMA_VERSION
                }, { merge: true });
                await batch.commit();
                this._userDocSchema = ACHIEVEMENT_SCHEMA_VERSION;
            }

            this._applyEarnedDates(allItems, earned, newlyEarnedIds);
        } catch (e) {
            console.error('Sync error:', e);
            this._applyEarnedDates(allItems, this.achievementsCache || {}, newlyEarnedIds);
        }

        achievementsData.paws = this.sortBadges(achievementsData.paws);
        // Keep classified feats grouped after normal feats (not plain unlocked-first).
        achievementsData.rareFeats = this.sortRareFeats(achievementsData.rareFeats);
        achievementsData.stateBadges = this.sortBadges(achievementsData.stateBadges);
        return achievementsData;
    }

    calculateTitle(score) {
        if (score >= 500) return 'Legendary Ranger';
        if (score >= 300) return 'National Treasure';
        if (score >= 200) return 'Apex Ranger';
        if (score >= 100) return 'Trail Legend';
        if (score >= 50)  return 'B.A.R.K. Master';
        if (score >= 25)  return 'Trail Blazer';
        if (score >= 10)  return 'B.A.R.K. Ranger';
        return 'B.A.R.K. Trainee';
    }

    calculatePaws(totalVisits, verifiedCount) {
        const thresholds = [
            { id: 'bronzePaw', name: 'Bronze Paw', icon: '🐾', count: 10, criteria: 'Visit 10 Parks' },
            { id: 'silverPaw', name: 'Silver Paw', icon: '🐾', count: 25, criteria: 'Visit 25 Parks' },
            { id: 'goldPaw', name: 'Gold Paw', icon: '🏆', count: 50, criteria: 'Visit 50 Parks' },
            { id: 'platinumPaw', name: 'Platinum Paw', icon: '💎', count: 100, criteria: 'Visit 100 Parks' },
            { id: 'obsidianPaw', name: 'Obsidian Paw', icon: '🖤', count: 200, criteria: 'Visit 200 Parks' }
        ];
        return thresholds.map(t => {
            let status = (totalVisits >= t.count) ? 'unlocked' : 'locked';
            let tier = (status === 'unlocked' && verifiedCount >= t.count) ? 'verified' : 'honor';
            return {
                ...t, status, tier,
                category: 'paws',
                dateEarned: status === 'unlocked' ? new Date().toLocaleDateString() : null,
                dateEarnedTs: status === 'unlocked' ? this._getStableTimestamp(t.id) : 0
            };
        });
    }

    // Unlocked first, then newest earned. Used by Paws and States.
    sortBadges(arr) {
        return arr.sort((a, b) => {
            const aU = a.status === 'unlocked' ? 1 : 0;
            const bU = b.status === 'unlocked' ? 1 : 0;
            if (aU !== bU) return bU - aU;
            return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0);
        });
    }

    // Orders the combined Rare Feats array: normal feats first, then classified.
    // Within each group, unlocked come first, then newest earned.
    sortRareFeats(arr) {
        const isUnlocked = b => (b.status === 'unlocked' ? 1 : 0);
        return arr.sort((a, b) => {
            const aClassified = a.classified ? 1 : 0;
            const bClassified = b.classified ? 1 : 0;
            if (aClassified !== bClassified) return aClassified - bClassified; // normal group first
            if (isUnlocked(a) !== isUnlocked(b)) return isUnlocked(b) - isUnlocked(a);
            return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0);
        });
    }

    calculateRareFeats(totalMap, verifiedMap) {
        const uniqueTotal = Object.keys(totalMap).length;
        const uniqueVerified = Object.keys(verifiedMap).length;
        const maxTotal = uniqueTotal > 0 ? Math.max(...Object.values(totalMap)) : 0;
        const maxVerified = uniqueVerified > 0 ? Math.max(...Object.values(verifiedMap)) : 0;
        const evalF = (tc, vc) => ({ status: tc ? 'unlocked' : 'locked', tier: vc ? 'verified' : 'honor' });
        const hasE = this.eastCoastStates.some(st => totalMap[st] > 0);
        const hasW = this.westCoastStates.some(st => totalMap[st] > 0);
        const hvE = this.eastCoastStates.some(st => verifiedMap[st] > 0);
        const hvW = this.westCoastStates.some(st => verifiedMap[st] > 0);

        // `category` is the contract the UI filters on. Never infer a badge's kind
        // from substrings of its id — 'fiftyStateClub' would false-match 'state'.
        return [
            { id: 'theExplorer', name: 'The Explorer', icon: '🗺️', ...evalF(uniqueTotal >= 5, uniqueVerified >= 5), criteria: '5 Unique States', dateEarnedTs: uniqueTotal >= 5 ? this._getStableTimestamp('theExplorer') : 0 },
            { id: 'theLocalLegend', name: 'The Local Legend', icon: '🏡', ...evalF(maxTotal >= 3, maxVerified >= 3), criteria: '3 Visits to 1 Park', dateEarnedTs: maxTotal >= 3 ? this._getStableTimestamp('theLocalLegend') : 0 },
            { id: 'coastToCoast', name: 'Coast-to-Coast', icon: '🌊', ...evalF(hasE && hasW, hvE && hvW), criteria: 'E & W Coast Visits', dateEarnedTs: (hasE && hasW) ? this._getStableTimestamp('coastToCoast') : 0 },
            { id: 'fiftyStateClub', name: '50-State Club', icon: '🦅', ...evalF(uniqueTotal >= 50, uniqueVerified >= 50), criteria: 'Visit all 50 States', dateEarnedTs: uniqueTotal >= 50 ? this._getStableTimestamp('fiftyStateClub') : 0 }
        ].map(feat => ({ ...feat, category: 'rareFeats' }));
    }

    calculateStateBadges(totalMap, verifiedMap) {
        return Object.keys(this.statesMetadata).map(code => {
            const required = this.stateCanonicalCounts[code] || 1;
            const visits = totalMap[code] || 0;
            const verified = verifiedMap[code] || 0;
            
            let percentComplete = Math.floor((visits / required) * 100);
            if (percentComplete > 100) percentComplete = 100; // Cap at 100% just in case
            
            const status = (percentComplete === 100) ? 'unlocked' : 'locked';
            const tier = (status === 'unlocked' && verified >= required) ? 'verified' : 'honor';
            const stateName = this.statesMetadata[code];
            const criteria = (status === 'unlocked') ? '100% cleared!!' : `Collect everything in ${stateName}!`;
            
            const badgeId = `state-${code.toLowerCase()}`;
            return {
                id: badgeId, name: stateName, icon: '📍', status, percentComplete, tier, criteria,
                category: 'states',
                stateCode: code,
                dateEarned: status === 'unlocked' ? new Date().toLocaleDateString() : null, 
                dateEarnedTs: status === 'unlocked' ? this._getStableTimestamp(badgeId) : 0
            };
        });
    }

    // Classified feats: hidden until earned, rendered after normal Rare Feats
    // inside the same Rare Feats tab. `classified: true` drives the hidden card
    // treatment (locked shows "[CLASSIFIED]") and the purple share styling.
    calculateClassifiedFeats(vArray, userRank, sortedVisits = [], visitProgress = {}) {
        const check = (cond, vCond) => ({ status: cond ? 'unlocked' : 'locked', tier: vCond ? 'verified' : 'honor' });
        const uniqueVisitedSites = Number.isFinite(Number(visitProgress.totalVisitedSites))
            ? Number(visitProgress.totalVisitedSites)
            : vArray.length;
        
        // Use pre-sorted visits and linear sliding window for marathoner
        let marathoner = false;
        const MS_24H = 24 * 60 * 60 * 1000;
        
        if (sortedVisits.length >= 4) {
            for (let i = 0; i <= sortedVisits.length - 4; i++) {
                if (sortedVisits[i+3].ts - sortedVisits[i].ts <= MS_24H) {
                    marathoner = true;
                    break;
                }
            }
        }

        let nightR = vArray.some(p => { let h = new Date(p.ts || 0).getHours(); return h >= 0 && h < 4; });
        let earlyB = vArray.some(p => { let h = new Date(p.ts || 0).getHours(); return h >= 4 && h < 7; });
        let loneW = vArray.some(p => { let d = new Date(p.ts || 0); return d.getMonth() === 11 && d.getDate() === 25; });
        
        // `teaser` is the ≤3-word nudge shown on the hidden card; `hint` is the
        // fuller line used when the feat is unlocked/shared.
        return [
            { id: 'alphaDog', name: 'The Alpha Dog', teaser: 'Lead the pack', hint: 'Prove you are the true leader of the pack.', icon: '🐺', ...check(userRank === 1, userRank === 1), criteria: 'Reach #1 on Leaderboard', classified: true, dateEarnedTs: userRank === 1 ? this._getStableTimestamp('alphaDog') : 0 },
            { id: 'nightRanger', name: 'The Night Ranger', teaser: 'After midnight', hint: 'The best time to explore is when everyone else is asleep.', icon: '🦉', ...check(nightR, nightR), criteria: 'Visit after Midnight', classified: true, dateEarnedTs: nightR ? this._getStableTimestamp('nightRanger') : 0 },
            { id: 'earlyBird', name: 'The Early Bird', teaser: 'Before sunrise', hint: 'The best trails belong to those who beat the sunrise.', icon: '🌅', ...check(earlyB, earlyB), criteria: 'Visit before 7 AM', classified: true, dateEarnedTs: earlyB ? this._getStableTimestamp('earlyBird') : 0 },
            { id: 'marathoner', name: 'The Marathoner', teaser: 'One big day', hint: 'Visit 4 parks in a single 24-hour window.', icon: '🏃', ...check(marathoner, marathoner), criteria: '4 Parks in 24 Hours', classified: true, dateEarnedTs: marathoner ? this._getStableTimestamp('marathoner') : 0 },
            { id: 'loneWolf', name: 'The Lone Wolf', teaser: 'The quiet day', hint: 'Explore a park on the quietest day of the year.', icon: '❄️', ...check(loneW, loneW), criteria: 'Visit on Christmas Day', classified: true, dateEarnedTs: loneW ? this._getStableTimestamp('loneWolf') : 0 },
            {
                id: 'mapConqueror',
                name: 'The Map Conqueror',
                teaser: 'The whole map',
                hint: 'Leave no stone unturned. Visit every single official site on the map.',
                icon: '🗺️',
                criteria: 'Visit 100% of Map',
                status: (uniqueVisitedSites >= (this.totalSystemParks || 1) && (this.totalSystemParks || 0) > 0) ? 'unlocked' : 'locked',
                tier: (uniqueVisitedSites >= (this.totalSystemParks || 1)) ? 'verified' : 'honor',
                classified: true,
                dateEarnedTs: (uniqueVisitedSites >= (this.totalSystemParks || 1)) ? this._getStableTimestamp('mapConqueror') : 0
            }
        // Classified feats live in the Rare Feats tab, so they share its category;
        // `classified: true` is what makes them render hidden and sort last.
        ].map(feat => ({ ...feat, category: 'rareFeats' }));
    }
}
window.GamificationEngine = GamificationEngine;
window.ACHIEVEMENT_SCHEMA_VERSION = ACHIEVEMENT_SCHEMA_VERSION;
