/**
 * scoringUtils.js - Single authoritative visit score formulas.
 * Keep outputs identical to the pre-extraction formulas.
 */
window.BARK = window.BARK || {};

function toVisitArray(visitedPlaces) {
    if (!visitedPlaces) return [];
    if (visitedPlaces instanceof Map) return Array.from(visitedPlaces.values());
    if (Array.isArray(visitedPlaces)) return visitedPlaces;
    return Array.from(visitedPlaces);
}

function getUniqueVisitProgress(visitedPlaces) {
    const engine = window.gamificationEngine;
    if (!engine || typeof engine.getVisitProgressMaps !== 'function') return null;

    try {
        const progress = engine.getVisitProgressMaps(visitedPlaces);
        const totalVisitedSites = Number(progress && progress.totalVisitedSites);
        const verifiedVisitedSites = Number(progress && progress.verifiedVisitedSites);
        if (!Number.isFinite(totalVisitedSites) || !Number.isFinite(verifiedVisitedSites)) return null;

        return {
            totalVisitedSites,
            verifiedVisitedSites
        };
    } catch (error) {
        console.warn('[scoringUtils] Falling back to raw visit scoring.', error);
        return null;
    }
}

function countVerifiedAndRegular(visitedPlaces) {
    const visits = toVisitArray(visitedPlaces);
    const uniqueProgress = getUniqueVisitProgress(visits);
    if (uniqueProgress) {
        const verifiedCount = uniqueProgress.verifiedVisitedSites;
        const totalVisitedCount = uniqueProgress.totalVisitedSites;
        return {
            verifiedCount,
            regularCount: Math.max(totalVisitedCount - verifiedCount, 0),
            totalVisitedCount
        };
    }

    let verifiedCount = 0;
    let regularCount = 0;

    visits.forEach(p => {
        if (p.verified) verifiedCount++;
        else regularCount++;
    });

    return { verifiedCount, regularCount, totalVisitedCount: verifiedCount + regularCount };
}

function calculateVisitScore(visitedPlaces, walkPoints) {
    const counts = countVerifiedAndRegular(visitedPlaces);
    const sanitizedWalkPoints = window.BARK.sanitizeWalkPoints(walkPoints);

    return {
        verifiedCount: counts.verifiedCount,
        regularCount: counts.regularCount,
        totalVisitedCount: counts.totalVisitedCount,
        walkPoints: sanitizedWalkPoints,
        totalScore: counts.totalVisitedCount + counts.verifiedCount + sanitizedWalkPoints
    };
}

window.BARK.countVerifiedAndRegular = countVerifiedAndRegular;
window.BARK.calculateVisitScore = calculateVisitScore;
