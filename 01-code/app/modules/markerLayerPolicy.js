/**
 * markerLayerPolicy.js - Single source of truth for marker layer/performance mode.
 */
const BARK_GLOBAL = window;
BARK_GLOBAL.BARK = BARK_GLOBAL.BARK || {};

function getRenderContext(zoom) {
    const mapRef = BARK_GLOBAL.map;
    const currentZoom = Number.isFinite(Number(zoom)) ? Number(zoom) : (mapRef ? mapRef.getZoom() : 0);

    return Object.freeze({
        zoom: currentZoom,
        clusteringEnabled: Boolean(BARK_GLOBAL.clusteringEnabled),
        premiumClusteringEnabled: Boolean(BARK_GLOBAL.premiumClusteringEnabled),
        forcePlainMarkers: Boolean(BARK_GLOBAL.forcePlainMarkers),
        stopResizing: Boolean(BARK_GLOBAL.stopResizing),
        viewportCulling: Boolean(BARK_GLOBAL.viewportCulling),
        lowGfxEnabled: Boolean(BARK_GLOBAL.lowGfxEnabled),
        ultraLowEnabled: Boolean(BARK_GLOBAL.ultraLowEnabled),
        simplifyPinsWhileMoving: Boolean(BARK_GLOBAL.simplifyPinsWhileMoving),
        limitZoomOut: Boolean(BARK_GLOBAL.limitZoomOut)
    });
}

function getMarkerLayerPolicy(zoom) {
    const context = getRenderContext(zoom);
    const performanceReduced = context.lowGfxEnabled || context.ultraLowEnabled;
    const premiumExplodesAtZoom = context.premiumClusteringEnabled && context.zoom >= 7;
    const canCluster = context.clusteringEnabled && !context.forcePlainMarkers && !premiumExplodesAtZoom;
    const shouldLimitZoomOut = context.limitZoomOut || performanceReduced;

    return {
        layerType: canCluster ? 'cluster' : 'plain',
        freezeDuringZoom: context.stopResizing,
        cullPlainMarkers: context.viewportCulling || context.forcePlainMarkers || performanceReduced,
        useReducedVisualsDuringMotion: context.simplifyPinsWhileMoving || context.stopResizing || performanceReduced,
        limitZoomOut: shouldLimitZoomOut,
        minZoom: shouldLimitZoomOut ? 5 : null
    };
}

BARK_GLOBAL.BARK.getRenderContext = getRenderContext;
BARK_GLOBAL.BARK.getMarkerLayerPolicy = getMarkerLayerPolicy;
