const fs = require('fs');
const path = require('path');

// 1. Your Master Metadata Matrix
const TRAIL_METADATA = {
    'half_dome': { name: 'Half Dome', total_miles: 16.0 },
    'angels_landing': { name: 'Angels Landing', total_miles: 5.0 },
    'zion_narrows': { name: 'Zion Narrows', total_miles: 16.0 },
    'cascade_pass': { name: 'Cascade Pass / Sahale Arm', total_miles: 12.1 },
    'highline_trail': { name: 'Highline Trail', total_miles: 11.8 },
    'harding_icefield': { name: 'Harding Icefield', total_miles: 8.2 },
    'old_rag': { name: 'Old Rag Trail', total_miles: 9.3 },
    'emerald_lake': { name: 'Emerald Lake', total_miles: 3.2 },
    'precipice_trail': { name: 'Precipice Trail', total_miles: 3.2 },
    'skyline_loop': { name: 'Skyline Trail Loop', total_miles: 5.5 },
    'grand_canyon_rim2rim': { name: 'Grand Canyon Rim to Rim', total_miles: 44.0 }
};

const rawDir = path.join(__dirname, 'raw_trails');
const outputFile = path.join(__dirname, 'trails.json');

// The True Mathematical Proximity Stitcher
function stitchMultiLineString(lines) {
    if (!lines || lines.length === 0) return [];
    if (lines.length === 1) return lines[0];

    let startIdx = 0;
    let maxLength = 0;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > maxLength) {
            maxLength = lines[i].length;
            startIdx = i;
        }
    }

    let stitched = [...lines[startIdx]];
    let remaining = lines.filter((_, idx) => idx !== startIdx);

    const getDist = (p1, p2) => Math.pow(p1[0] - p2[0], 2) + Math.pow(p1[1] - p2[1], 2);

    while (remaining.length > 0) {
        // Prevent tracing orphaned path segments miles away
        let bestIdx = -1, bestDist = 0.0005; // increased threshold for gaps in road connections
        let needsReverse = false, addToEnd = true;

        const startPt = stitched[0];
        const endPt = stitched[stitched.length - 1];

        for (let i = 0; i < remaining.length; i++) {
            const seg = remaining[i];
            const segStart = seg[0];
            const segEnd = seg[seg.length - 1];

            const dEndToStart = getDist(endPt, segStart);
            const dEndToEnd = getDist(endPt, segEnd);
            const dStartToEnd = getDist(startPt, segEnd);
            const dStartToStart = getDist(startPt, segStart);

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

        if (bestIdx === -1) {
            // No remaining segments are within the sensible jump threshold
            break;
        }

        let match = remaining[bestIdx];
        if (needsReverse) match = [...match].reverse();

        if (addToEnd) {
            stitched.push(...match);
        } else {
            stitched.unshift(...match);
        }

        remaining.splice(bestIdx, 1);
    }
    return stitched;
}

let masterTrailsDb = {};

console.log("🎒 Packing the B.A.R.K. Ranger Trail Database...");

// 2. Read the directory and process files
const files = fs.readdirSync(rawDir);

files.forEach(file => {
    if (!file.endsWith('.geojson')) return;

    const trailId = file.replace('.geojson', '');

    if (!TRAIL_METADATA[trailId]) {
        console.warn(`⚠️ Warning: ${trailId} is not in your master metadata. Skipping.`);
        return;
    }

    try {
        const rawData = fs.readFileSync(path.join(rawDir, file), 'utf8');
        const geojson = JSON.parse(rawData);

        let coordinates = [];

        // AllTrails GeoJSONs usually hide the coordinates deep in a FeatureCollection
        if (geojson.type === "FeatureCollection") {
            const feature = geojson.features.find(f => f.geometry.type === "LineString" || f.geometry.type === "MultiLineString");
            if (feature) {
                // Global safety threshold (0.00001 squared degrees is ~100m)
                const MAX_JUMP_SQ = 0.00001;

                if (feature.geometry.type === "MultiLineString") {
                    let rawLines = feature.geometry.coordinates;

                    // 🌲 PRE-STITCH FILTER: Drop the Northern Highline backcountry & McDonald Creek extensions
                    // This forces the stitcher to follow the Granite Park Trail descent and stop accurately at The Loop
                    if (trailId === 'highline_trail') {
                        rawLines = rawLines.map(line => line.filter(coord =>
                            coord[1] < 48.775 && !(coord[0] < -113.78 && coord[1] < 48.754)
                        )).filter(line => line.length > 1);
                    }

                    // 🏔️ PRE-STITCH FILTER: Drop trail extensions that overshoot the loop junctions
                    // Champlain North Ridge continues north past the junction & Orange & Black Path
                    // extends east toward Schooner Head — both create straight-line artifacts
                    if (trailId === 'precipice_trail') {
                        rawLines = rawLines.filter(line => {
                            const maxLat = Math.max(...line.map(c => c[1]));
                            const maxLon = Math.max(...line.map(c => c[0]));  // lon is negative; less negative = farther east
                            if (maxLat > 44.360) return false;   // Champlain NR north tail
                            if (maxLon > -68.186) return false;  // O&B Path east tail
                            return true;
                        });
                    }

                    // 🏜️ PRE-STITCH FILTER: Drop the West Rim Trail north of Scout Lookout
                    // This forces the stitcher to only keep the segment from the Grotto, to Scout Lookout, down to AL Summit
                    if (trailId === 'angels_landing') {
                        rawLines = rawLines.map(line => line.filter(coord =>
                            coord[1] < 37.275
                        )).filter(line => line.length > 1);
                    }

                    // 🏔️ PRE-STITCH FILTER: Drop the Cascade Pass descent to Cottonwood Camp
                    // We only want the path from the trailhead up to Sahale Arm
                    if (trailId === 'cascade_pass') {
                        rawLines = rawLines.map(line => line.filter(coord =>
                            coord[1] >= 48.466 // Drops the southern trajectory toward Stehekin/Cottonwood
                        )).filter(line => line.length > 1);
                    }

                    // 🏔️ PRE-STITCH FILTER: Drop JMT east of the Half Dome Trail junction
                    // This forces the stitcher to route from Happy Isles to Half Dome Summit, dropping the remaining hundreds of miles of JMT
                    if (trailId === 'half_dome') {
                        rawLines = rawLines.map(line => line.filter(coord =>
                            coord[0] < -119.49
                        )).filter(line => line.length > 1);
                    }

                    coordinates = stitchMultiLineString(rawLines);
                } else {
                    coordinates = feature.geometry.coordinates;
                }

                // 🛑 SURGICAL CLIP: Absolute Geographic Ceiling for Angels Landing
                if (trailId === 'angels_landing') {
                    coordinates = coordinates.filter(coord => coord[1] <= 37.2753);
                }

                // 🏔️ THE UNIVERSAL TRAIL GUILLOTINE 🏔️
                const TRAIL_TERMINALS = {
                    'angels_landing': { lat: 37.269384, lon: -112.947980 },   // Summit
                    'highline_trail': { lat: 48.7547, lon: -113.8005 },      // The Loop Trailhead on GTSR
                    'cascade_pass': { lat: 48.4852, lon: -121.0460 },        // Sahale Glacier Camp
                    'half_dome': { lat: 37.7460, lon: -119.5332 },           // Half Dome Summit
                    'grand_canyon_rim2rim': { lat: 36.2170, lon: -112.0566 } // North Kaibab Trailhead
                };

                // 🧭 START ANCHORS: Force a trail to BEGIN at a specific trailhead
                const TRAIL_START_ANCHORS = {
                    'highline_trail': { lat: 48.6966, lon: -113.7182 },      // Logan's Pass Trailhead
                    'angels_landing': { lat: 37.2593, lon: -112.9515 },      // The Grotto Trailhead
                    'cascade_pass': { lat: 48.4754, lon: -121.0751 },        // Johannesburg / Cascade Pass Trailhead
                    'half_dome': { lat: 37.7328, lon: -119.5577 },           // Happy Isles Trailhead
                    'grand_canyon_rim2rim': { lat: 36.0529, lon: -112.0837 } // South Kaibab Trailhead
                };

                if (TRAIL_START_ANCHORS[trailId] && coordinates.length > 0) {
                    const anchor = TRAIL_START_ANCHORS[trailId];
                    let anchorIdx = 0;
                    let minAnchorDist = Infinity;
                    for (let i = 0; i < coordinates.length; i++) {
                        const d = Math.pow(coordinates[i][1] - anchor.lat, 2) + Math.pow(coordinates[i][0] - anchor.lon, 2);
                        if (d < minAnchorDist) {
                            minAnchorDist = d;
                            anchorIdx = i;
                        }
                    }
                    coordinates = coordinates.slice(anchorIdx);
                    console.log(`🧭 Anchored ${trailId} start at trailhead (Node ${anchorIdx}, ${coordinates.length} coords remain)`);
                }

                if (TRAIL_TERMINALS[trailId] && coordinates.length > 0) {
                    const target = TRAIL_TERMINALS[trailId];
                    let bestIndex = 0;
                    let minDist = Infinity;

                    for (let i = 0; i < coordinates.length; i++) {
                        const d = Math.pow(coordinates[i][1] - target.lat, 2) + Math.pow(coordinates[i][0] - target.lon, 2);
                        if (d < minDist) {
                            minDist = d;
                            bestIndex = i;
                        }
                    }

                    // Cut the line exactly at the target destination
                    coordinates = coordinates.slice(0, bestIndex + 1);
                    console.log(`✅ Sliced ${trailId} at its official terminus (Node ${bestIndex})`);
                }

                // ✂️ SPAGHETTI LOOP REMOVAL ✂️
                // If the trail crosses itself, snip out the redundant loop (must run AFTER terminal slice)
                if (trailId !== 'skyline_loop' && trailId !== 'precipice_trail') {
                    for (let i = 0; i < coordinates.length - 5; i++) {
                        for (let j = coordinates.length - 1; j > i + 5; j--) {
                            const dist = Math.pow(coordinates[i][0] - coordinates[j][0], 2) + Math.pow(coordinates[i][1] - coordinates[j][1], 2);
                            if (dist < 0.000000001) {
                                // Cut out everything between the intersection
                                console.log(`✂️ Snipped a ${j - i} point self-intersecting loop from ${trailId}`);
                                coordinates.splice(i + 1, j - i);
                                j = coordinates.length; // restart check for new length
                            }
                        }
                    }
                }

                // 🔄 SPECIAL LOOP ROTATION: Close the mountaintop gap for Skyline Loop
                if ((trailId === 'skyline_loop' || trailId === 'precipice_trail') && coordinates.length > 0) {
                    const paradise = trailId === 'skyline_loop' ? { lat: 46.7860, lon: -121.7350 } : { lat: 44.3495, lon: -68.1879 };
                    let bestIndex = 0;
                    let minDist = Infinity;
                    for (let i = 0; i < coordinates.length; i++) {
                        const d = Math.pow(coordinates[i][1] - paradise.lat, 2) + Math.pow(coordinates[i][0] - paradise.lon, 2);
                        if (d < minDist) {
                            minDist = d;
                            bestIndex = i;
                        }
                    }
                    if (bestIndex > 0) {
                        const p1 = coordinates.slice(bestIndex);
                        const p2 = coordinates.slice(0, bestIndex);
                        coordinates = p1.concat(p2);
                        if (trailId === 'precipice_trail') coordinates.reverse();
                        console.log(`🔄 Rotated ${trailId} to anchor exactly at trailhead (Node ${bestIndex})${trailId === 'precipice_trail' ? ' and reversed' : ''}`);
                    }
                }

                // 🪓 THE FINAL SAFETY AXE 🪓
                // Catch any remaining massive jumps, UNLESS it has a precision terminal
                if (coordinates.length > 0 && !TRAIL_TERMINALS[trailId] && trailId !== 'skyline_loop' && trailId !== 'precipice_trail' && trailId !== 'old_rag') {
                    for (let i = 1; i < coordinates.length; i++) {
                        const dSq = Math.pow(coordinates[i][1] - coordinates[i - 1][1], 2) + Math.pow(coordinates[i][0] - coordinates[i - 1][0], 2);
                        if (dSq > MAX_JUMP_SQ) {
                            console.log(`🪓 Chopped rogue segment in ${trailId} at node ${i}!`);
                            coordinates = coordinates.slice(0, i);
                            break;
                        }
                    }
                }
            }
        } else if (geojson.geometry && geojson.geometry.type === "LineString") {
            coordinates = geojson.geometry.coordinates;
        }

        if (coordinates.length === 0) {
            console.error(`❌ Failed to extract coordinates for ${trailId}`);
            return;
        }

        // 3. Construct the clean, lean object
        masterTrailsDb[trailId] = {
            type: "Feature",
            properties: TRAIL_METADATA[trailId],
            geometry: {
                type: "LineString",
                coordinates: coordinates
            }
        };

        console.log(`✅ Successfully compiled: ${TRAIL_METADATA[trailId].name} (${coordinates.length} coordinate pairs)`);

    } catch (error) {
        console.error(`❌ Error parsing ${file}:`, error.message);
    }
});

// 4. Write the final bundled matrix
fs.writeFileSync(outputFile, JSON.stringify(masterTrailsDb));
console.log(`\n🚀 Success! Wrote ${Object.keys(masterTrailsDb).length} trails to trails.json`);
