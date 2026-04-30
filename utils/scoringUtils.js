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

function countVerifiedAndRegular(visitedPlaces) {
    let verifiedCount = 0;
    let regularCount = 0;

    toVisitArray(visitedPlaces).forEach(p => {
        if (p.verified) verifiedCount++;
        else regularCount++;
    });

    return { verifiedCount, regularCount };
}

function calculateVisitScore(visitedPlaces, walkPoints) {
    const counts = countVerifiedAndRegular(visitedPlaces);

    return {
        verifiedCount: counts.verifiedCount,
        regularCount: counts.regularCount,
        totalScore: (counts.verifiedCount * 2) + counts.regularCount + window.BARK.sanitizeWalkPoints(walkPoints)
    };
}

window.BARK.countVerifiedAndRegular = countVerifiedAndRegular;
window.BARK.calculateVisitScore = calculateVisitScore;
