const https = require('https');
const fs = require('fs');

// Only fetch the two named trails we need - NOT every path in the area
const query = '[out:json];(way["name"="Highline Trail"](48.69,-113.82,48.78,-113.70);way["name"="Granite Park Trail"](48.69,-113.82,48.78,-113.70););out geom;';
const url = 'https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(query);

console.log("Fetching Highline + Granite Park Trail from OSM...");

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        const json = JSON.parse(data);
        const ways = json.elements.filter(e => e.type === 'way');
        console.log("Found " + ways.length + " ways.");

        // Convert to GeoJSON MultiLineString
        const multiCoords = ways.map(w => w.geometry.map(p => [p.lon, p.lat]));

        const geojson = {
            type: "FeatureCollection",
            features: [{
                type: "Feature",
                geometry: { type: "MultiLineString", coordinates: multiCoords },
                properties: { name: "Highline Trail" }
            }]
        };

        fs.writeFileSync('raw_trails/highline_trail.geojson', JSON.stringify(geojson));
        console.log("Saved " + multiCoords.length + " segments.");
        ways.forEach((w, i) => {
            console.log("  Seg " + i + ": " + w.tags.name + " (" + w.geometry.length + " nodes)");
        });
    });
}).on('error', (e) => console.error(e));
