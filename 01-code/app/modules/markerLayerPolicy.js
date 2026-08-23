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

function isAppleTouchWebKit() {
    const navigatorRef = BARK_GLOBAL.navigator || {};
    const userAgent = String(navigatorRef.userAgent || '');
    const platform = String(navigatorRef.platform || '');
    const maxTouchPoints = Number(navigatorRef.maxTouchPoints || 0);
    const isClassicIos = /iPad|iPhone|iPod/i.test(userAgent);
    const isDesktopModeIpad = platform === 'MacIntel' && maxTouchPoints > 1;

    return /AppleWebKit/i.test(userAgent) && (isClassicIos || isDesktopModeIpad);
}

/**
 * Leaflet normally positions each HTML marker with translate3d(). On iOS that
 * can promote hundreds of image-and-shadow pins into separate compositor
 * surfaces. The visible DOM and CSS stay identical, but WebKit can eventually
 * spend tens of seconds reclaiming/rebuilding those surfaces while the JS
 * watchdog continues to run.
 *
 * Disabling Leaflet's 3-D capability flag before L.map() is created makes it
 * use left/top positioning for markers instead. The marker pane still moves as
 * one unit, so pin artwork, hit targets, panels, and route behavior are intact.
 */
function applyIosLeafletCompositorPolicy(leaflet = BARK_GLOBAL.L) {
    if (!isAppleTouchWebKit() || !leaflet || !leaflet.Browser) return false;

    leaflet.Browser.any3d = false;
    return true;
}

BARK_GLOBAL.BARK.getRenderContext = getRenderContext;
BARK_GLOBAL.BARK.getMarkerLayerPolicy = getMarkerLayerPolicy;
BARK_GLOBAL.BARK.isAppleTouchWebKit = isAppleTouchWebKit;
BARK_GLOBAL.BARK.applyIosLeafletCompositorPolicy = applyIosLeafletCompositorPolicy;
