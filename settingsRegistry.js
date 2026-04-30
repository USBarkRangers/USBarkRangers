/**
 * settingsRegistry.js - Declarative settings schema for scalable performance controls.
 */
window.BARK = window.BARK || {};

window.BARK.SETTING_IMPACTS = Object.freeze({
    MARKER_LAYER: 'marker-layer',
    MARKER_STYLE: 'marker-style',
    MAP_BEHAVIOR: 'map-behavior',
    MAP_GESTURE: 'map-gesture',
    TRAIL_RENDER: 'trail-render'
});

window.BARK.SETTINGS_REGISTRY = Object.freeze({
    allowUncheck: {
        storageKey: 'barkAllowUncheck',
        cloudKey: 'allowUncheck',
        defaultValue: false,
        elementId: 'allow-uncheck-setting',
        impact: window.BARK.SETTING_IMPACTS.MAP_BEHAVIOR
    },
    instantNav: {
        storageKey: 'barkInstantNav',
        cloudKey: 'instantNav',
        defaultValue: false,
        elementId: 'instant-nav-toggle',
        impact: window.BARK.SETTING_IMPACTS.MAP_BEHAVIOR
    },
    stopAutoMovements: {
        storageKey: 'barkStopAutoMove',
        cloudKey: 'stopAutoMovements',
        defaultValue: false,
        elementId: 'toggle-stop-auto-move',
        impact: window.BARK.SETTING_IMPACTS.MAP_BEHAVIOR
    },
    standardClusteringEnabled: {
        storageKey: 'barkStandardClustering',
        cloudKey: 'standardClustering',
        defaultValue: false,
        elementId: 'standard-cluster-toggle',
        impact: window.BARK.SETTING_IMPACTS.MARKER_LAYER
    },
    premiumClusteringEnabled: {
        storageKey: 'barkPremiumClustering',
        cloudKey: 'premiumClustering',
        defaultValue: false,
        elementId: 'premium-cluster-toggle',
        impact: window.BARK.SETTING_IMPACTS.MARKER_LAYER
    },
    lockMapPanning: {
        storageKey: 'barkLockMapPanning',
        cloudKey: 'lockMapPanning',
        defaultValue: false,
        elementId: 'toggle-lock-map-panning',
        impact: window.BARK.SETTING_IMPACTS.MAP_GESTURE
    },
    disable1fingerZoom: {
        storageKey: 'barkDisable1Finger',
        cloudKey: 'disable1fingerZoom',
        defaultValue: false,
        elementId: 'toggle-disable-1finger',
        impact: window.BARK.SETTING_IMPACTS.MAP_GESTURE
    },
    disablePinchZoom: {
        storageKey: 'barkDisablePinchZoom',
        cloudKey: 'disablePinchZoom',
        defaultValue: false,
        elementId: 'toggle-disable-pinch',
        impact: window.BARK.SETTING_IMPACTS.MAP_GESTURE
    },
    disableDoubleTap: {
        storageKey: 'barkDisableDoubleTap',
        cloudKey: 'disableDoubleTap',
        defaultValue: false,
        elementId: 'toggle-disable-double-tap',
        impact: window.BARK.SETTING_IMPACTS.MAP_GESTURE
    },
    lowGfxEnabled: {
        storageKey: 'barkLowGfxEnabled',
        cloudKey: 'lowGfxEnabled',
        defaultValue: false,
        label: 'Low Graphics Mode',
        description: 'Master speed mode for older phones. Enables the safe performance options below.',
        elementId: 'low-gfx-toggle',
        section: 'performance',
        master: true,
        impact: window.BARK.SETTING_IMPACTS.MARKER_STYLE
    },
    removeShadows: {
        storageKey: 'barkRemoveShadows',
        cloudKey: 'removeShadows',
        defaultValue: false,
        label: 'Remove Shadows',
        description: 'Strips heavy GPU shadow filters from all pins.',
        elementId: 'toggle-remove-shadows',
        section: 'performance',
        impact: window.BARK.SETTING_IMPACTS.MARKER_STYLE
    },
    stopResizing: {
        storageKey: 'barkStopResizing',
        cloudKey: 'stopResizing',
        defaultValue: false,
        label: 'Stop Resizing',
        description: 'Freezes pin animation during zoom without disabling clustering.',
        elementId: 'toggle-stop-resizing',
        section: 'performance',
        impact: window.BARK.SETTING_IMPACTS.MARKER_STYLE
    },
    simplifyPinsWhileMoving: {
        storageKey: 'barkSimplifyPinsWhileMoving',
        cloudKey: 'simplifyPinsWhileMoving',
        defaultValue: false,
        label: 'Simplify Pins While Moving',
        description: 'Temporarily removes costly pin effects while the map is panning or zooming.',
        elementId: 'toggle-simplify-pins-moving',
        section: 'performance',
        impact: window.BARK.SETTING_IMPACTS.MARKER_STYLE
    },
    viewportCulling: {
        storageKey: 'barkViewportCulling',
        cloudKey: 'viewportCulling',
        defaultValue: false,
        label: 'Viewport Culling',
        description: 'Only attaches visible plain pins to the map layer.',
        elementId: 'toggle-viewport-culling',
        section: 'performance',
        impact: window.BARK.SETTING_IMPACTS.MARKER_LAYER
    },
    limitZoomOut: {
        storageKey: 'barkLimitZoomOut',
        cloudKey: 'limitZoomOut',
        defaultValue: false,
        label: 'Limit Zoom Out',
        description: 'Prevents extreme national zoom-out when lots of pins are visible.',
        elementId: 'toggle-limit-zoom-out',
        section: 'performance',
        impact: window.BARK.SETTING_IMPACTS.MAP_BEHAVIOR
    },
    forcePlainMarkers: {
        storageKey: 'barkForcePlainMarkers',
        cloudKey: 'forcePlainMarkers',
        defaultValue: false,
        label: 'Force Plain Pins',
        description: 'Disables bubble clustering for devices that struggle with cluster recalculation.',
        elementId: 'toggle-force-plain-markers',
        section: 'performance',
        impact: window.BARK.SETTING_IMPACTS.MARKER_LAYER
    },
    simplifyTrails: {
        storageKey: 'barkSimplifyTrails',
        cloudKey: 'simplifyTrails',
        defaultValue: false,
        label: 'Simplify Trails',
        description: 'Reduces trail detail to prevent map stuttering.',
        elementId: 'simplify-trail-toggle',
        section: 'performance',
        impact: window.BARK.SETTING_IMPACTS.TRAIL_RENDER
    }
});

window.BARK.PERFORMANCE_SETTING_KEYS = Object.freeze([
    'lowGfxEnabled',
    'removeShadows',
    'stopResizing',
    'simplifyPinsWhileMoving',
    'viewportCulling',
    'limitZoomOut',
    'forcePlainMarkers',
    'simplifyTrails'
]);

window.BARK.LOW_GRAPHICS_PRESET = Object.freeze({
    removeShadows: true,
    stopResizing: true,
    simplifyPinsWhileMoving: true,
    viewportCulling: true,
    limitZoomOut: true,
    simplifyTrails: true,
    standardClusteringEnabled: false,
    premiumClusteringEnabled: false,
    instantNav: true,
    forcePlainMarkers: false
});
