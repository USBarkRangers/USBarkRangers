/**
 * MapMarkerConfig.js
 * Exposes a generator function for creating Leaflet divIcons that adopt the premium 3D CSS.
 */

class MapMarkerConfig {
    /**
     * Generates a Leaflet L.marker with appropriate HTML structure and classes for CSS binding.
     * @param {Object} parkData - Data payload for the park (needs lat, lng, and parkCategory)
     * @param {Boolean} isVisited - True if the user has visited this park
     * @returns {L.marker} The constructed Leaflet marker instance
     */
    static createCustomMarker(parkData, isVisited) {
        // Decide which base JPEG to use depending on category
        const isNational = (parkData.parkCategory === 'National');
        const iconUrl = isNational ? 'bark-logo.jpeg' : 'bark-tag.jpeg';

        // Always create markers in neutral state — visited styling is applied dynamically
        // by updateMarkers() via the 'visited-pin' class to prevent recycling bugs
        const stateClass = 'unvisited-marker';
        const catClass = isNational ? 'cat-national' : 'cat-state';

        // Create the DivIcon HTML string
        // The wrapper handles the geometry (50% border radius) and the premium halo (via padding+box-shadow)
        // The img scales to fill the circle identically.
        const markerHtml = `
            <div class="enamel-pin-wrapper">
                <img src="${iconUrl}" alt="Park Pin" loading="lazy" />
            </div>
        `;

        // Initialize Leaflet divIcon
        const divIcon = L.divIcon({
            className: `custom-bark-marker ${stateClass} ${catClass}`,
            html: markerHtml,
            iconSize: [36, 36], // Increased slightly to account for the padding ring
            iconAnchor: [18, 18], // Center it smoothly
            popupAnchor: [0, -18]
        });

        // Initialize and return the L.marker
        const marker = L.marker([parkData.lat, parkData.lng], { icon: divIcon });

        // Keep parkData securely bound for UI handlers downstream
        marker._parkData = parkData;

        return marker;
    }
}

// Export for usage
if (typeof window !== 'undefined') {
    window.MapMarkerConfig = MapMarkerConfig;
}
