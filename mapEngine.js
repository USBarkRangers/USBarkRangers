/**
 * mapEngine.js — Leaflet Map Init, Tile Layers, Controls, Zoom Handlers
 * Owns window.map, markerLayer, markerClusterGroup, and the Bubble Mode teardown/rebuild.
 * Loaded THIRD in the boot sequence.
 */
window.BARK = window.BARK || {};

// ====== LOADER DISMISSAL — MODULE SCOPE ======
// Defined here, outside initMap(), so it is always available even if initMap() throws
// (e.g. Leaflet CDN failure). authService.js calls this after Firebase auth resolves.
window.dismissBarkLoader = function () {
    const loader = document.getElementById('bark-loader');
    if (loader && loader.style.opacity !== '0') {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 600);
    }
};

// Safety fallback: if Firebase auth never resolves, dismiss after 8s unconditionally.
setTimeout(() => window.dismissBarkLoader(), 8000);

// ====== BATCH CSS CLASS APPLICATION ======
/**
 * 🏭 Batch-apply body CSS classes from window state — one DOM write, no layout thrash.
 */
function applyGlobalStyles() {
    const addClasses = [];
    const removeClasses = [];

    if (window.reducePinMotion) addClasses.push('reduce-pin-motion');
    else removeClasses.push('reduce-pin-motion');

    if (window.removeShadows) addClasses.push('remove-shadows');
    else removeClasses.push('remove-shadows');

    if (window.stopResizing) addClasses.push('stop-resizing');
    else removeClasses.push('stop-resizing');

    if (window.simplifyPinsWhileMoving) addClasses.push('simplify-pins-while-moving');
    else removeClasses.push('simplify-pins-while-moving');

    if (window.viewportCulling) addClasses.push('viewport-culling');
    else removeClasses.push('viewport-culling');

    if (window.ultraLowEnabled) addClasses.push('ultra-low');
    else removeClasses.push('ultra-low');

    if (window.lowGfxEnabled) addClasses.push('low-graphics');
    else removeClasses.push('low-graphics');

    // Single batch DOM write
    if (addClasses.length) document.body.classList.add(...addClasses);
    if (removeClasses.length) document.body.classList.remove(...removeClasses);
}

window.BARK.applyGlobalStyles = applyGlobalStyles;

// ====== MAP INITIALIZATION ======
window.BARK.initMap = function initMap() {
if (window.map && window.BARK.markerLayer && window.BARK.markerClusterGroup) return window.map;

// Apply initial styles
applyGlobalStyles();

let mapSaveTimeout;
const LOWER_48_MIN_ZOOM = 4;

const mapOptions = window.ultraLowEnabled ? {
    preferCanvas: true,
    updateWhenIdle: true,
    updateWhenZooming: false,
    markerZoomAnimation: false,
    zoomAnimation: false,
    fadeAnimation: false,
    inertia: false,
    zoomControl: false,
    minZoom: LOWER_48_MIN_ZOOM,
    zoomSnap: 0.5,
    worldCopyJump: true,
    bounceAtZoomLimits: false,
    renderer: L.canvas({ padding: 0.5 })
} : {
    zoomControl: false,
    minZoom: LOWER_48_MIN_ZOOM,
    worldCopyJump: true,
    bounceAtZoomLimits: false,
    renderer: L.canvas({ padding: 0.5 }),
    preferCanvas: true,
    zoomSnap: 0.5,
    zoomDelta: 1,
    wheelDebounceTime: 40,
    wheelPxPerZoomLevel: 120,
    doubleClickZoom: false,
    touchZoom: !window.disablePinchZoom,
    dragging: !window.lockMapPanning,
    markerZoomAnimation: true
};

window.map = L.map('map', mapOptions);
const defaultMinZoom = window.map.options.minZoom ?? 0;

function refreshMarkerClusters() {
    const clusterLayer = window.BARK && window.BARK.markerClusterGroup;
    if (!clusterLayer || typeof clusterLayer.refreshClusters !== 'function') return;
    if (!window.map || !window.map.hasLayer(clusterLayer)) return;
    clusterLayer.refreshClusters();
}

window.BARK.refreshMarkerClusters = refreshMarkerClusters;

function getActiveMapPolicy() {
    return window.BARK.getMarkerLayerPolicy
        ? window.BARK.getMarkerLayerPolicy(window.map.getZoom())
        : { limitZoomOut: false, minZoom: null };
}

function getActiveMinZoom() {
    const policy = getActiveMapPolicy();
    const policyMinZoom = policy.minZoom === null ? defaultMinZoom : policy.minZoom;
    return Math.max(LOWER_48_MIN_ZOOM, policyMinZoom);
}

window.BARK.applyMapPerformancePolicy = function applyMapPerformancePolicy() {
    if (!window.map) return;
    const nextMinZoom = getActiveMinZoom();

    window.map.options.bounceAtZoomLimits = false;
    window.map.setMinZoom(nextMinZoom);
    if (window.map.getZoom() < nextMinZoom) {
        window.map.setView(window.map.getCenter(), nextMinZoom, { animate: false });
    }
    if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
        window.BARK.invalidateMarkerVisibility();
    }
    refreshMarkerClusters();
};
window.BARK.applyMapPerformancePolicy();

// 🎯 MAP MEMORY INJECTION
function setInitialMapView(defaultLat, defaultLng) {
    const savedLat = localStorage.getItem('mapLat');
    const savedLng = localStorage.getItem('mapLng');
    const savedZoom = localStorage.getItem('mapZoom') || 7;

    if (window.rememberMapPosition && savedLat && savedLng) {
        console.log("📍 Restoring last known map position...");
        map.setView([parseFloat(savedLat), parseFloat(savedLng)], parseInt(savedZoom), { animate: false });
        return true;
    } else {
        console.log("📍 Starting at default/current location...");
        const startZoom = window.startNationalView ? 4 : 7;
        map.setView([defaultLat, defaultLng], startZoom, { animate: false });
        return false;
    }
}

// Initial view set to US center as a placeholder during load
setInitialMapView(39.8283, -98.5795);

// 🎯 CUSTOM DOUBLE CLICK ZOOM ENGINE
map.on('dblclick', (e) => {
    if (window.disableDoubleTap) return;
    map.setZoomAround(e.containerPoint, map.getZoom() + 1);
});

map.getContainer().addEventListener('wheel', (event) => {
    if (event.deltaY <= 0) return;
    const minZoom = getActiveMinZoom();
    if (map.getZoom() > minZoom + 0.001) return;

    event.preventDefault();
    event.stopPropagation();
}, { passive: false, capture: true });

// 🚀 MAP POSITION SAVER
map.on('moveend', () => {
    window.BARK._isMoving = false;
    document.body.classList.remove('map-is-moving');

    clearTimeout(mapSaveTimeout);
    mapSaveTimeout = setTimeout(() => {
        const center = map.getCenter();
        localStorage.setItem('mapLat', center.lat.toFixed(6));
        localStorage.setItem('mapLng', center.lng.toFixed(6));
        localStorage.setItem('mapZoom', map.getZoom());
    }, 500);

    // 🚀 VIEWPORT CULLING DYNAMIC RENDER (Throttled to prevent flash)
    const markerPolicy = window.BARK.getMarkerLayerPolicy
        ? window.BARK.getMarkerLayerPolicy(map.getZoom())
        : { layerType: 'plain', cullPlainMarkers: window.viewportCulling };
    if (markerPolicy.layerType === 'plain' && markerPolicy.cullPlainMarkers) {
        if (!window._cullingTimeout) {
            window._cullingTimeout = setTimeout(() => {
                window._cullingTimeout = null;
                window.syncState();
            }, 300);
        }
    }
});

map.on('movestart', () => {
    window.BARK._isMoving = true;
    if (window.BARK.getMarkerLayerPolicy && window.BARK.getMarkerLayerPolicy(map.getZoom()).useReducedVisualsDuringMotion) {
        document.body.classList.add('map-is-moving');
    }
});

function getEffectiveMarkerLayerTypeForZoom(zoom) {
    if (window.BARK.getMarkerLayerPolicy) return window.BARK.getMarkerLayerPolicy(zoom).layerType;
    const forceNoClustering = window.premiumClusteringEnabled && zoom >= 7;
    return (window.clusteringEnabled && !forceNoClustering) ? 'cluster' : 'plain';
}

// 🧊 TRACKPAD ZOOM DEBOUNCER + Bubble Mode migration gate
let trackpadZoomTimeout = null;
let zoomSyncTimeout = null;
let lastZoomLayerType = getEffectiveMarkerLayerTypeForZoom(map.getZoom());
let zoomLayerChangePending = false;
let zoomFloorGuardCenter = null;
let zoomFloorGuardZoom = null;

map.on('zoomstart', () => {
    window.BARK._isZooming = true;
    const minZoom = getActiveMinZoom();
    zoomFloorGuardZoom = map.getZoom();
    zoomFloorGuardCenter = zoomFloorGuardZoom <= minZoom + 0.001 ? map.getCenter() : null;

    if (window.BARK.getMarkerLayerPolicy && window.BARK.getMarkerLayerPolicy(map.getZoom()).useReducedVisualsDuringMotion) {
        document.body.classList.add('map-is-moving');
    }
    if (window.stopResizing) {
        document.body.classList.add('map-is-zooming');
    }
});

map.on('zoomend', () => {
    const minZoom = getActiveMinZoom();
    if (zoomFloorGuardCenter && zoomFloorGuardZoom <= minZoom + 0.001 && map.getZoom() <= minZoom + 0.001) {
        const currentCenter = map.getCenter();
        if (currentCenter.distanceTo(zoomFloorGuardCenter) > 1) {
            map.setView(zoomFloorGuardCenter, minZoom, { animate: false });
        }
    }
    zoomFloorGuardCenter = null;
    zoomFloorGuardZoom = null;

    const nextLayerType = getEffectiveMarkerLayerTypeForZoom(map.getZoom());
    const layerTypeChanged = nextLayerType !== lastZoomLayerType;
    lastZoomLayerType = nextLayerType;
    zoomLayerChangePending = zoomLayerChangePending || layerTypeChanged;

    clearTimeout(zoomSyncTimeout);
    zoomSyncTimeout = setTimeout(() => {
        window.BARK._isZooming = false;
        refreshMarkerClusters();
        if (zoomLayerChangePending || window.BARK._pendingMarkerSync) {
            zoomLayerChangePending = false;
            window.BARK._pendingMarkerSync = false;
            if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
                window.BARK.invalidateMarkerVisibility();
            }
            window.syncState();
        }
    }, 150);

    if (window.stopResizing) {
        clearTimeout(trackpadZoomTimeout);
        trackpadZoomTimeout = setTimeout(() => {
            document.body.classList.remove('map-is-zooming');
            document.body.classList.remove('map-is-moving');
        }, 150);
    } else {
        clearTimeout(trackpadZoomTimeout);
        trackpadZoomTimeout = setTimeout(() => {
            document.body.classList.remove('map-is-moving');
        }, 150);
    }
});

L.control.zoom({
    position: 'bottomleft'
}).addTo(map);

// ====== MAP STYLE / TILE LAYERS ======
const mapStyleSelect = document.getElementById('map-style-select');
const savedMapStyle = localStorage.getItem('barkMapStyle') || 'default';

let currentTileLayer;
const loadLayer = (style) => {
    if (currentTileLayer) map.removeLayer(currentTileLayer);
    if (style === 'terrain') {
        currentTileLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)', maxZoom: 17 }).addTo(map);
    } else if (style === 'satellite') {
        currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community', maxZoom: 18 }).addTo(map);
    } else if (style === 'streets') {
        currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012', maxZoom: 18 }).addTo(map);
    } else {
        currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
    }
};

// Load saved layer on boot
loadLayer(savedMapStyle);

if (mapStyleSelect) {
    mapStyleSelect.value = savedMapStyle;
    mapStyleSelect.addEventListener('change', (e) => {
        const style = e.target.value;
        localStorage.setItem('barkMapStyle', style);
        loadLayer(style);
    });
}
window.BARK.loadLayer = loadLayer;

// ====== LOCATE CONTROL ======
const LocateControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function (map) {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control custom-locate-btn');
        const button = L.DomUtil.create('a', '', container);
        button.innerHTML = '⌖';
        button.href = '#';
        button.title = 'Find My Location';
        button.setAttribute('role', 'button');

        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.on(button, 'click', function (e) {
            L.DomEvent.preventDefault(e);
            map.locate({ setView: true, maxZoom: 10 });
        });
        return container;
    }
});
map.addControl(new LocateControl());

let userLocationMarker = null;
window.BARK.getUserLocationMarker = function () { return userLocationMarker; };

map.on('locationfound', function (e) {
    if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
    }

    const pulsingIcon = L.divIcon({
        className: 'custom-location-pulse',
        html: '<div class="pulse-location-dot" style="width: 16px; height: 16px;"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });

    userLocationMarker = L.marker(e.latlng, { icon: pulsingIcon }).addTo(map);
    userLocationMarker.bindPopup('You are here!', { autoPan: false }).openPopup();

    // 🎯 RE-CALCULATE AND RE-SORT ACHIEVEMENTS NOW THAT WE HAVE ACTUAL LOCATION
    window.syncState();
});

map.on('locationerror', function (e) {
    console.warn("Could not access your location. Please check your browser permissions.");
});

// Prompt for location immediately on load
setTimeout(() => {
    const usedSaved = window.rememberMapPosition && localStorage.getItem('mapLat');
    if (!usedSaved && !window.startNationalView) {
        map.locate({ setView: true, maxZoom: 10 });
    } else {
        map.locate({ setView: false, watch: false });
    }
}, 500);

// ====== MARKER LAYERS ======
const markerLayer = L.layerGroup().addTo(map);

const markerClusterGroup = L.markerClusterGroup({
    chunkedLoading: true,
    chunkInterval: 50,
    chunkDelay: 100,
    removeOutsideVisibleBounds: true,
    disableClusteringAtZoom: 16,
    animate: false,
    animateAddingMarkers: false,
    maxClusterRadius: function (zoom) {
        if (window.premiumClusteringEnabled) return 80;
        if (window.standardClusteringEnabled) {
            if (zoom <= 3) return 120;
            if (zoom <= 5) return 100;
            if (zoom <= 8) return 80;
            return 60;
        }
        return 80;
    },
    iconCreateFunction: function (cluster) {
        const visibilityRevision = window.BARK._markerVisibilityRevision || 0;
        const childCount = cluster.getChildCount();
        const cacheKey = `${visibilityRevision}|${window.map.getZoom()}|${childCount}`;
        let visibleChildCount = cluster._barkVisibleChildCount;

        if (cluster._barkVisibleChildCountKey !== cacheKey) {
            const childMarkers = typeof cluster.getAllChildMarkers === 'function'
                ? cluster.getAllChildMarkers()
                : [];
            visibleChildCount = childMarkers.length
                ? childMarkers.reduce((count, marker) => count + (marker && marker._barkIsVisible !== false ? 1 : 0), 0)
                : childCount;
            cluster._barkVisibleChildCount = visibleChildCount;
            cluster._barkVisibleChildCountKey = cacheKey;
        }

        const hiddenClass = visibleChildCount > 0 ? '' : ' marker-filter-hidden';
        const markerHtml = `
            <div class="cluster-enamel-wrapper">
                <img src="assets/images/bark-logo.jpeg" alt="B.A.R.K. Cluster" loading="lazy" />
                <div class="cluster-count-badge">${visibleChildCount}</div>
            </div>
        `;
        return L.divIcon({
            html: markerHtml,
            className: `bark-cluster-marker${hiddenClass}`,
            iconSize: [46, 46],
            iconAnchor: [23, 23]
        });
    }
});

window.BARK.markerLayer = markerLayer;
window.BARK.markerClusterGroup = markerClusterGroup;
window.BARK.markerManager = new window.BARK.MarkerLayerManager({
    map,
    plainLayer: markerLayer,
    clusterLayer: markerClusterGroup
});

// ====== 🐛 BUBBLE MODE SAFE TEARDOWN/REBUILD ======
// Tracks which layer type markers are currently living in.
// When the layer type changes, this safely migrates all markers.
window.BARK._lastLayerType = null; // 'cluster' | 'plain' | null

window.BARK.rebuildMarkerLayer = function () {
    if (typeof window.BARK.invalidateMarkerVisibility === 'function') {
        window.BARK.invalidateMarkerVisibility();
    }
    window.BARK._forceMarkerLayerReset = true;
    window.BARK._pendingMarkerSync = true;
    refreshMarkerClusters();
};

// ====== ONE-FINGER ZOOM ENGINE (Google Maps Style) ======
if ('ontouchstart' in window) {
    const mapContainer = document.getElementById('map');
    let lastTap = 0;
    let isOneFingerZooming = false;
    let zoomStartY = 0;
    let initialZoom = 0;
    let holdTimer = null;
    let pendingDoubleTap = false;
    let zoomRAF = null;

    function resetZoomState() {
        clearTimeout(holdTimer);
        holdTimer = null;
        pendingDoubleTap = false;
        if (zoomRAF) { cancelAnimationFrame(zoomRAF); zoomRAF = null; }

        if (isOneFingerZooming) {
            isOneFingerZooming = false;
            const snappedZoom = Math.round(map.getZoom() * 2) / 2;
            map.setZoom(snappedZoom, { animate: false });
        }

        map.options.zoomSnap = 0.5;
        if (!window.lockMapPanning) map.dragging.enable();
    }

    mapContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;

        if (tapLength < 300 && tapLength > 0) {
            pendingDoubleTap = true;
            const startY = e.touches[0].clientY;

            if (!window.disable1fingerZoom) {
                holdTimer = setTimeout(() => {
                    if (pendingDoubleTap) {
                        isOneFingerZooming = true;
                        zoomStartY = startY;
                        initialZoom = map.getZoom();
                        map.dragging.disable();
                        map.options.zoomSnap = 0;
                    }
                }, 150);
            }
        }
        lastTap = currentTime;
    }, { passive: false });

    mapContainer.addEventListener('touchmove', (e) => {
        if (window.disable1fingerZoom) return;

        if (pendingDoubleTap && !isOneFingerZooming && e.touches.length === 1) {
            clearTimeout(holdTimer);
            isOneFingerZooming = true;
            zoomStartY = e.touches[0].clientY;
            initialZoom = map.getZoom();
            map.dragging.disable();
            map.options.zoomSnap = 0;
        }

        if (!isOneFingerZooming || e.touches.length !== 1) return;

        e.preventDefault();
        const currentY = e.touches[0].clientY;
        const deltaY = currentY - zoomStartY;
        const targetZoom = Math.min(19, Math.max(getActiveMinZoom(), initialZoom + deltaY / 150));

        if (!zoomRAF) {
            if (window.stopResizing) {
                zoomRAF = setTimeout(() => {
                    map.setZoom(targetZoom, { animate: false });
                    zoomRAF = null;
                }, 250);
            } else {
                zoomRAF = requestAnimationFrame(() => {
                    map.setZoom(targetZoom, { animate: false });
                    zoomRAF = null;
                });
            }
        }
    }, { passive: false });

    mapContainer.addEventListener('touchend', (e) => {
        if (pendingDoubleTap && !isOneFingerZooming) {
            if (!window.disableDoubleTap) {
                const touch = e.changedTouches ? e.changedTouches[0] : null;
                if (touch) {
                    const rect = mapContainer.getBoundingClientRect();
                    const x = touch.clientX - rect.left;
                    const y = touch.clientY - rect.top;
                    map.setZoomAround(L.point(x, y), map.getZoom() + 1);
                } else {
                    map.setZoomAround(map.getCenter(), map.getZoom() + 1);
                }
            }
        }
        resetZoomState();
    });
}

return window.map;
};
