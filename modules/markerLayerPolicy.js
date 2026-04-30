/**
 * markerLayerPolicy.js - Single source of truth for marker layer/performance mode.
 */
window.BARK = window.BARK || {};

function getMarkerLayerPolicy(zoom) {
    const currentZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : (window.map ? window.map.getZoom() : 0);
    const premiumExplodesAtZoom = window.premiumClusteringEnabled && currentZoom >= 7;
    const canCluster = window.clusteringEnabled && !window.forcePlainMarkers && !premiumExplodesAtZoom;

    return {
        layerType: canCluster ? 'cluster' : 'plain',
        freezeDuringZoom: Boolean(window.stopResizing),
        cullPlainMarkers: Boolean(window.viewportCulling || window.forcePlainMarkers || window.lowGfxEnabled || window.ultraLowEnabled),
        useReducedVisualsDuringMotion: Boolean(window.simplifyPinsWhileMoving || window.stopResizing || window.lowGfxEnabled || window.ultraLowEnabled),
        limitZoomOut: Boolean(window.limitZoomOut || window.lowGfxEnabled || window.ultraLowEnabled),
        minZoom: (window.limitZoomOut || window.lowGfxEnabled || window.ultraLowEnabled) ? 5 : null
    };
}

window.BARK.getMarkerLayerPolicy = getMarkerLayerPolicy;
