const fs = require('fs');

console.log("📂 Reading file...");
const data = JSON.parse(fs.readFileSync('raw_trails/highline_trail.geojson', 'utf8'));
const rawLines = data.features[0].geometry.coordinates;
console.log(`✅ Loaded ${rawLines.length} segments.`);

function stitch(lines) {
    if (!lines || lines.length === 0) return [];
    let stitched = [...lines[0]];
    let remaining = lines.slice(1);
    const getDist = (p1, p2) => Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2);

    console.log("🧵 Starting stitcher...");
    while (remaining.length > 0) {
        // Log every 5 segments so you can see it moving
        if (remaining.length % 5 === 0) console.log(`... ${remaining.length} segments left`);

        let bestIdx = -1, bestDist = Infinity;
        let needsReverse = false, addToEnd = true;
        const startPt = stitched[0];
        const endPt = stitched[stitched.length - 1];

        for (let i = 0; i < remaining.length; i++) {
            const seg = remaining[i];
            const dEndToStart = getDist(endPt, seg[0]);
            const dEndToEnd = getDist(endPt, seg[seg.length - 1]);
            const dStartToEnd = getDist(startPt, seg[seg.length - 1]);
            const dStartToStart = getDist(startPt, seg[0]);
            const minDist = Math.min(dEndToStart, dEndToEnd, dStartToEnd, dStartToStart);
            if (minDist < bestDist) {
                bestDist = minDist; 
                bestIdx = i;
                if (minDist === dEndToStart) { addToEnd = true; needsReverse = false; }
                else if (minDist === dEndToEnd) { addToEnd = true; needsReverse = true; }
                else if (minDist === dStartToEnd) { addToEnd = false; needsReverse = false; }
                else if (minDist === dStartToStart) { addToEnd = false; needsReverse = true; }
            }
        }
        
        let match = remaining[bestIdx];
        if (needsReverse) match = [...match].reverse();
        if (addToEnd) stitched.push(...match); else stitched.unshift(...match);
        remaining.splice(bestIdx, 1);
    }
    return stitched;
}

const stitched = stitch(rawLines);
console.log('✅ Total Stitched Nodes:', stitched.length);

const target = { lat: 48.7523, lon: -113.7888 };
let minD = Infinity; let bestI = -1;
stitched.forEach((c, i) => {
    const d = Math.pow(c[1] - target.lat, 2) + Math.pow(c[0] - target.lon, 2);
    if (d < minD) { minD = d; bestI = i; }
});

console.log('------------------------------------');
console.log('🎯 RESULT FOUND:');
console.log('Best Node Index:', bestI);
console.log('Coordinates:', stitched[bestI]);
console.log('Distance SQ:', minD.toFixed(8));
