/**
 * MapMarkerConfig.js
 * Exposes a generator function for creating Leaflet divIcons that adopt the premium 3D CSS.
 */

class MapMarkerConfig {
    static getPinStyle(parkData, isVisited = false) {
        if (isVisited) {
            return {
                iconUrl: (parkData.parkCategory === 'National') ? 'assets/images/bark-logo.jpeg' : 'assets/images/bark-tag.jpeg',
                ringColor: '#4CAF50',
                pinColor: '#4CAF50',
                pinShadowColor: '#4CAF50',
                categoryClass: (parkData.parkCategory === 'National') ? 'cat-national' : 'cat-state'
            };
        }

        const isNational = (parkData.parkCategory === 'National');
        return {
            iconUrl: isNational ? 'assets/images/bark-logo.jpeg' : 'assets/images/bark-tag.jpeg',
            ringColor: isNational ? '#000' : '#2196F3',
            pinColor: isNational ? '#000' : '#2196F3',
            pinShadowColor: isNational ? 'rgba(0, 0, 0, 0.4)' : 'rgba(33, 150, 243, 0.4)',
            categoryClass: isNational ? 'cat-national' : 'cat-state'
        };
    }

    /**
     * Generates a Leaflet L.marker with appropriate HTML structure and classes for CSS binding.
     * @param {Object} parkData - Data payload for the park (needs lat, lng, and parkCategory)
     * @param {Boolean} isVisited - True if the user has visited this park
     * @returns {L.marker} The constructed Leaflet marker instance
     */
    static createCustomMarker(parkData, isVisited) {
        const style = MapMarkerConfig.getPinStyle(parkData, isVisited);

        const stateClass = isVisited ? 'visited-marker visited-pin' : 'unvisited-marker';
        const catClass = style.categoryClass;

        const markerHtml = `<div class="enamel-pin-wrapper"><img src="${style.iconUrl}" alt="Park Pin" loading="lazy" /></div>`;

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
