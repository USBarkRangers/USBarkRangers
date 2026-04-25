const https = require('https');
const fs = require('fs');
const path = require('path');

const TRAIL_METADATA = {
    'half_dome': 'Half Dome Trail|John Muir Trail|Mist Trail',
    'angels_landing': "Angels Landing Trail|West Rim Trail",
    'zion_narrows': 'Riverside Walk|The Narrows Day Hike Section',
    'cascade_pass': 'Cascade Pass Trail|Sahale Arm Trail',
    'highline_trail': 'Highline Trail|Granite Park Trail',
    'harding_icefield': 'Harding Icefield Trail',
    'old_rag': 'Ridge Trail|Saddle Trail|Weakley Hollow Fire Road',
    'grand_canyon_rim2rim': 'North Kaibab Trail|South Kaibab Trail|River Trail',
    'emerald_lake': 'Emerald Lake Trail',
    'precipice_trail': 'Precipice Trail|Champlain North Ridge Trail|Orange & Black Path',
    'skyline_loop': 'Skyline Trail'
};

const BBOXES = {
    'half_dome': [37.7, -119.6, 37.8, -119.5],
    'angels_landing': [37.2, -113.0, 37.3, -112.9],
    'zion_narrows': [37.2, -113.0, 37.4, -112.9],
    'cascade_pass': [48.4, -121.1, 48.5, -120.9],
    'highline_trail': [48.7, -113.8, 48.8, -113.7],
    'harding_icefield': [60.1, -149.7, 60.2, -149.5],
    'grand_canyon_rim2rim': [36.0, -112.2, 36.3, -111.9],
    'old_rag': [38.5, -78.4, 38.6, -78.3],
    'emerald_lake': [40.3, -105.7, 40.4, -105.6],
    'precipice_trail': [44.3, -68.2, 44.4, -68.1],
    'skyline_loop': [46.7, -121.8, 46.8, -121.7]
};

async function fetchOverpass(trailId, trailName) {
    const bbox = BBOXES[trailId];
    const query = `
        [out:json];
        way["name"~"${trailName}"](${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]});
        out geom;
    `;

    const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function run() {
    const rawDir = path.join(__dirname, 'raw_trails');
    for (const [id, name] of Object.entries(TRAIL_METADATA)) {
        console.log(`Fetching ${name}...`);
        try {
            const data = await fetchOverpass(id, name);
            if (data.elements && data.elements.length > 0) {
                // Combine all ways into a single GeoJSON MultiLineString
                const coords = [];
                for (const element of data.elements) {
                    if (element.geometry) {
                        const line = element.geometry.map(p => [p.lon, p.lat]);
                        coords.push(line);
                    }
                }
                const geojson = {
                    type: "FeatureCollection",
                    features: [{
                        type: "Feature",
                        geometry: { type: "MultiLineString", coordinates: coords },
                        properties: { name: name }
                    }]
                };
                fs.writeFileSync(path.join(rawDir, id + '.geojson'), JSON.stringify(geojson));
                console.log(` -> Saved ${id}.geojson`);
            } else {
                console.log(` -> No data found for ${name}`);
            }
        } catch (e) {
            console.error(` -> Failed: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 1500)); // Respect API limits
    }
}

run();
