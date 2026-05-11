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

        const sortBadges = (arr) => {
            return arr.sort((a, b) => {
                const aU = a.status === 'unlocked' ? 1 : 0;
                const bU = b.status === 'unlocked' ? 1 : 0;
                if (aU !== bU) return bU - aU; // Unlocked at the front
                return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0); // Newest first
            });
        };

        const sortedVisits = [...visitedParksArray]
            .filter(p => p.ts)
            .sort((a, b) => a.ts - b.ts);

        const totalParks = Math.max(this.totalSystemParks || 1, 1);

        return {
            totalScore: totalScore,
            title: this.calculateTitle(totalScore),
            paws: sortBadges(this.calculatePaws(visitProgress.totalVisitedSites, verifiedCount)),
            rareFeats: sortBadges(this.calculateRareFeats(stateVisitsTotalMap, stateVisitsVerifiedMap)),
            stateBadges: sortBadges(this.calculateStateBadges(stateVisitsTotalMap, stateVisitsVerifiedMap)),
            mysteryFeats: this.calculateMysteryFeats(visitedParksArray, userRank, sortedVisits, visitProgress),
            nationalProgress: {
                totalVisited: visitProgress.totalVisitedSites,
                totalParks: this.totalSystemParks || 1,
                percentComplete: Math.floor((visitProgress.totalVisitedSites / totalParks) * 100)
            }
        };
    }

    async evaluateAndStoreAchievements(userId, visitedParksArray, userRank = null, walkPoints = 0) {
        const achievementsData = this.evaluate(visitedParksArray, userRank, walkPoints);
        if (!userId || typeof firebase === 'undefined') return achievementsData;

        const db = firebase.firestore();
        const achievementsRef = db.collection('users').doc(userId).collection('achievements');
        const allItems = [...achievementsData.rareFeats, ...achievementsData.paws, ...achievementsData.mysteryFeats, ...achievementsData.stateBadges];

        // 🛡️ Pre-compute stable timestamps for all unlocked items before any DB work
        for (const item of allItems) {
            if (item.status === 'unlocked') {
                item.dateEarnedTs = this._getStableTimestamp(item.id);
                item.dateEarned = new Date(item.dateEarnedTs).toLocaleDateString();
            }
        }

        try {
            const batch = db.batch();
            let hasChanges = false;
            
            // 🛑 PREVENT READ CASCADE: Only fetch from DB if cache is empty
            if (!this.achievementsCache) {
                const snap = await achievementsRef.get();
                this.achievementsCache = {};
                snap.forEach(doc => { this.achievementsCache[doc.id] = doc.data(); });
            }
            
            const existingCache = this.achievementsCache;
            
            for (const item of allItems) {
                if (item.status === 'unlocked') {
                    const existing = existingCache[item.id];
                    if (!existing || (existing.tier === 'honor' && item.tier === 'verified')) {
                        batch.set(achievementsRef.doc(item.id), {
                            achievementId: item.id, tier: item.tier, dateEarned: firebase.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                        hasChanges = true;
                        
                        // 🛑 Update local cache immediately to prevent re-triggering
                        this.achievementsCache[item.id] = { tier: item.tier, dateEarned: item.dateEarnedTs };
                    }
                    if (existing && existing.dateEarned) {
                        const d = existing.dateEarned.toDate ? existing.dateEarned.toDate() : new Date(existing.dateEarned);
                        item.dateEarned = d.toLocaleDateString();
                        item.dateEarnedTs = d.getTime();
                        // 🛡️ Also update session cache so it stays stable
                        this._sessionTimestamps[item.id] = item.dateEarnedTs;
                    } else if (hasChanges && (!existing || existing.tier !== item.tier)) {
                        item.dateEarned = 'Just Now!';
                        // 🛡️ Use the stable timestamp already set above
                    }
                }
            }
            if (hasChanges) await batch.commit();
        } catch (e) { console.error('Sync error:', e); }
        
        const sortB = (arr) => arr.sort((a, b) => {
            const aU = a.status === 'unlocked' ? 1 : 0;
            const bU = b.status === 'unlocked' ? 1 : 0;
            if (aU !== bU) return bU - aU;
            return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0);
        });

        achievementsData.paws = sortB(achievementsData.paws);
        achievementsData.rareFeats = sortB(achievementsData.rareFeats);
        achievementsData.stateBadges = sortB(achievementsData.stateBadges);
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
                dateEarned: status === 'unlocked' ? new Date().toLocaleDateString() : null, 
                dateEarnedTs: status === 'unlocked' ? this._getStableTimestamp(t.id) : 0 
            };
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

        return [
            { id: 'theExplorer', name: 'The Explorer', icon: '🗺️', ...evalF(uniqueTotal >= 5, uniqueVerified >= 5), criteria: '5 Unique States', dateEarnedTs: uniqueTotal >= 5 ? this._getStableTimestamp('theExplorer') : 0 },
            { id: 'theLocalLegend', name: 'The Local Legend', icon: '🏡', ...evalF(maxTotal >= 3, maxVerified >= 3), criteria: '3 Visits to 1 Park', dateEarnedTs: maxTotal >= 3 ? this._getStableTimestamp('theLocalLegend') : 0 },
            { id: 'coastToCoast', name: 'Coast-to-Coast', icon: '🌊', ...evalF(hasE && hasW, hvE && hvW), criteria: 'E & W Coast Visits', dateEarnedTs: (hasE && hasW) ? this._getStableTimestamp('coastToCoast') : 0 },
            { id: 'fiftyStateClub', name: '50-State Club', icon: '🦅', ...evalF(uniqueTotal >= 50, uniqueVerified >= 50), criteria: 'Visit all 50 States', dateEarnedTs: uniqueTotal >= 50 ? this._getStableTimestamp('fiftyStateClub') : 0 }
        ];
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
                dateEarned: status === 'unlocked' ? new Date().toLocaleDateString() : null, 
                dateEarnedTs: status === 'unlocked' ? this._getStableTimestamp(badgeId) : 0
            };
        });
    }

    calculateMysteryFeats(vArray, userRank, sortedVisits = [], visitProgress = {}) {
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
        
        return [
            { id: 'alphaDog', name: 'The Alpha Dog', hint: 'Prove you are the true leader of the pack.', icon: '🐺', ...check(userRank === 1, userRank === 1), criteria: 'Reach #1 on Leaderboard', isMystery: true, dateEarnedTs: userRank === 1 ? this._getStableTimestamp('alphaDog') : 0 },
            { id: 'nightRanger', name: 'The Night Ranger', hint: 'The best time to explore is when everyone else is asleep.', icon: '🦉', ...check(nightR, nightR), criteria: 'Visit after Midnight', isMystery: true, dateEarnedTs: nightR ? this._getStableTimestamp('nightRanger') : 0 },
            { id: 'earlyBird', name: 'The Early Bird', hint: 'The best trails belong to those who beat the sunrise.', icon: '🌅', ...check(earlyB, earlyB), criteria: 'Visit before 7 AM', isMystery: true, dateEarnedTs: earlyB ? this._getStableTimestamp('earlyBird') : 0 },
            { id: 'marathoner', name: 'The Marathoner', hint: 'Visit 4 parks in a single 24-hour window.', icon: '🏃', ...check(marathoner, marathoner), criteria: '4 Parks in 24 Hours', isMystery: true, dateEarnedTs: marathoner ? this._getStableTimestamp('marathoner') : 0 },
            { id: 'loneWolf', name: 'The Lone Wolf', hint: 'Explore a park on the quietest day of the year.', icon: '❄️', ...check(loneW, loneW), criteria: 'Visit on Christmas Day', isMystery: true, dateEarnedTs: loneW ? this._getStableTimestamp('loneWolf') : 0 },
            { 
                id: 'mapConqueror', 
                name: 'The Map Conqueror', 
                hint: 'Leave no stone unturned. Visit every single official site on the map.', 
                icon: '🗺️', 
                criteria: 'Visit 100% of Map',
                status: (uniqueVisitedSites >= (this.totalSystemParks || 1) && (this.totalSystemParks || 0) > 0) ? 'unlocked' : 'locked',
                tier: (uniqueVisitedSites >= (this.totalSystemParks || 1)) ? 'verified' : 'honor',
                isMystery: true, 
                dateEarnedTs: (uniqueVisitedSites >= (this.totalSystemParks || 1)) ? this._getStableTimestamp('mapConqueror') : 0
            }
        ];
    }
}
window.GamificationEngine = GamificationEngine;
