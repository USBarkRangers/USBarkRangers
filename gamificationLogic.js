class GamificationEngine {
    constructor(config = {}) {
        this.eastCoastStates = ['ME', 'NH', 'MA', 'RI', 'CT', 'NY', 'NJ', 'DE', 'MD', 'VA', 'NC', 'SC', 'GA', 'FL'];
        this.westCoastStates = ['WA', 'OR', 'CA'];
        this.stateCanonicalCounts = config.stateCanonicalCounts || {};
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
        let st = String(stateStr).trim().toUpperCase();
        if (this.statesMetadata[st]) return st; 
        for (let code in this.statesMetadata) {
            if (this.statesMetadata[code].toUpperCase() === st) return code;
        }
        return null; 
    }

    // Replaces the messy logic in app.js
    updateCanonicalCountsFromPoints(points) {
        const counts = {};
        points.forEach(p => {
            if (p.state) {
                const sts = String(p.state).split(/[,/]/);
                sts.forEach(s => {
                    const stClean = this.getNormalizedStateCode(s);
                    if (stClean) counts[stClean] = (counts[stClean] || 0) + 1;
                });
            }
        });
        this.stateCanonicalCounts = counts;
        this.totalSystemParks = Object.values(counts).reduce((a, b) => a + b, 0);
    }

    evaluate(visitedParksArray, userRank = null, walkPoints = 0) {
        const scoreSummary = window.BARK.calculateVisitScore(visitedParksArray, walkPoints);
        let totalScore = scoreSummary.totalScore;
        let verifiedCount = scoreSummary.verifiedCount;
        let stateVisitsTotalMap = {};
        let stateVisitsVerifiedMap = {};

        visitedParksArray.forEach(park => {
            if (park.state) {
                const stArray = String(park.state).split(/[,/]/);
                stArray.forEach(s => {
                    const stClean = this.getNormalizedStateCode(s);
                    if (stClean) {
                        stateVisitsTotalMap[stClean] = (stateVisitsTotalMap[stClean] || 0) + 1;
                        if (park.verified) stateVisitsVerifiedMap[stClean] = (stateVisitsVerifiedMap[stClean] || 0) + 1;
                    }
                });
            }
        });

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

        return {
            totalScore: totalScore,
            title: this.calculateTitle(totalScore),
            paws: sortBadges(this.calculatePaws(visitedParksArray.length, verifiedCount)),
            rareFeats: sortBadges(this.calculateRareFeats(stateVisitsTotalMap, stateVisitsVerifiedMap)),
            stateBadges: sortBadges(this.calculateStateBadges(stateVisitsTotalMap, stateVisitsVerifiedMap)),
            mysteryFeats: this.calculateMysteryFeats(visitedParksArray, userRank, sortedVisits),
            nationalProgress: { 
                totalVisited: visitedParksArray.length, 
                totalParks: this.totalSystemParks || 1, 
                percentComplete: Math.floor((visitedParksArray.length / Math.max(this.totalSystemParks || 1, 1)) * 100) 
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

    calculateMysteryFeats(vArray, userRank, sortedVisits = []) {
        const check = (cond, vCond) => ({ status: cond ? 'unlocked' : 'locked', tier: vCond ? 'verified' : 'honor' });
        
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
                status: (vArray.length >= (this.totalSystemParks || 1) && (this.totalSystemParks || 0) > 0) ? 'unlocked' : 'locked', 
                tier: (vArray.length >= (this.totalSystemParks || 1)) ? 'verified' : 'honor', 
                isMystery: true, 
                dateEarnedTs: (vArray.length >= (this.totalSystemParks || 1)) ? this._getStableTimestamp('mapConqueror') : 0 
            }
        ];
    }
}
window.GamificationEngine = GamificationEngine;
