/**
 * MarkerLayerManager.js - Owns UUID-keyed Leaflet marker lifecycle.
 */
window.BARK = window.BARK || {};

function getParkRepo() {
    return window.BARK.repos && window.BARK.repos.ParkRepo;
}

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

class MarkerLayerManager {
    constructor({ map, plainLayer, clusterLayer }) {
        this.map = map;
        this.plainLayer = plainLayer;
        this.clusterLayer = clusterLayer;
        this.markers = new Map();
    }

    getDataFingerprint(parkData) {
        return [
            parkData.id,
            parkData.name,
            parkData.state,
            parkData.cost,
            parkData.swagType,
            parkData.info,
            parkData.website,
            parkData.pics,
            parkData.video,
            parkData.lat,
            parkData.lng,
            parkData.parkCategory,
            parkData.category,
            parkData._cachedNormalizedName
        ].join('\u001f');
    }

    getVisitedState(parkData) {
        if (typeof window.BARK.isParkVisited === 'function') return window.BARK.isParkVisited(parkData);
        const vaultRepo = getVaultRepo();
        if (vaultRepo && typeof vaultRepo.hasVisit === 'function') return vaultRepo.hasVisit(parkData);
        return false;
    }

    getTargetLayerType() {
        const zoom = this.map ? this.map.getZoom() : 0;
        if (window.BARK.getMarkerLayerPolicy) return window.BARK.getMarkerLayerPolicy(zoom).layerType;
        const forceNoClustering = window.premiumClusteringEnabled && zoom >= 7;
        return (window.clusteringEnabled && !forceNoClustering) ? 'cluster' : 'plain';
    }

    bindMarkerEvents(marker) {
        if (marker._barkEventsBound) return;
        marker._barkEventsBound = true;

        marker.on('remove', function () {
            if (this._icon) {
                this._icon.classList.remove('active-pin');
                this._icon.classList.remove('visited-pin');
                this._icon.classList.remove('visited-marker');
                this._icon.classList.remove('unvisited-marker');
                this._icon.classList.remove('marker-filter-hidden');
            }
        });

        marker.on('add', () => {
            this.applyMarkerStyle(marker);
            if (marker._icon) {
                if (window.BARK.activePinMarker === marker) marker._icon.classList.add('active-pin');
                marker._icon.classList.toggle('marker-filter-hidden', marker._barkIsVisible === false);
            }
        });

        marker.on('click', () => {
            this.renderMarkerPanel(marker);
        });
    }

    renderMarkerPanel(marker, options = {}) {
        if (typeof window.BARK.renderMarkerClickPanel !== 'function') return;

        window.BARK.renderMarkerClickPanel({
            marker,
            syncUserProgress: window.BARK.services && window.BARK.services.firebase && window.BARK.services.firebase.syncUserProgress,
            slidePanel: document.getElementById('slide-panel'),
            titleEl: document.getElementById('panel-title'),
            infoSection: document.getElementById('panel-info-section'),
            infoEl: document.getElementById('panel-info'),
            websitesContainer: document.getElementById('websites-container'),
            picsEl: document.getElementById('panel-pics'),
            videoEl: document.getElementById('panel-video'),
            refreshOnly: options.refreshOnly === true
        });
    }

    isInTripStop(parkData) {
        const tripLayer = window.BARK.tripLayer;
        if (!parkData || !parkData.id || !tripLayer || typeof tripLayer.getStopParkIds !== 'function') return false;
        const ids = tripLayer.getStopParkIds();
        return Boolean(ids && ids.has(parkData.id));
    }

    applyMarkerStyle(marker) {
        if (!marker || !marker._parkData || !marker._icon) return;

        const isVisited = this.getVisitedState(marker._parkData);
        const style = MapMarkerConfig.getPinStyle(marker._parkData, isVisited);
        marker._icon.classList.toggle('cat-national', style.categoryClass === 'cat-national');
        marker._icon.classList.toggle('cat-state', style.categoryClass === 'cat-state');
        marker._icon.classList.toggle('visited-pin', Boolean(isVisited));
        marker._icon.classList.toggle('visited-marker', Boolean(isVisited));
        marker._icon.classList.toggle('unvisited-marker', !isVisited);
        // park-pin--in-trip hides the inner pin shape so the trip overlay badge
        // is the only visible marker at trip-stop locations. Re-applied on every
        // cluster `add` event (via bindMarkerEvents), so cluster rebuilds cannot
        // strip the class.
        marker._icon.classList.toggle('park-pin--in-trip', this.isInTripStop(marker._parkData));
        marker._icon.style.setProperty('--pin-color', style.pinColor);
        marker._icon.style.setProperty('--ring-color', style.ringColor);
        marker._icon.style.setProperty('--pin-shadow-color', style.pinShadowColor);
    }

    refreshTripStopClasses(parkIds) {
        if (!parkIds) return;
        const ids = parkIds instanceof Set ? parkIds : new Set(parkIds);
        ids.forEach(parkId => {
            const marker = this.markers.get(parkId);
            if (marker && marker._icon) this.applyMarkerStyle(marker);
        });
    }

    refreshMarkerStyles(parkIds = null) {
        const ids = parkIds
            ? (parkIds instanceof Set ? parkIds : new Set(parkIds))
            : null;

        this.markers.forEach((marker, parkId) => {
            if (ids && !ids.has(parkId)) return;
            if (!marker || !marker._parkData) return;
            marker._barkVisitedState = this.getVisitedState(marker._parkData);
            if (marker._icon) this.applyMarkerStyle(marker);
        });
    }

    updateMarker(marker, parkData) {
        const currentLatLng = marker.getLatLng();
        const nextLat = Number(parkData.lat);
        const nextLng = Number(parkData.lng);

        if (
            Number.isFinite(nextLat) &&
            Number.isFinite(nextLng) &&
            (currentLatLng.lat !== nextLat || currentLatLng.lng !== nextLng)
        ) {
            marker.setLatLng([nextLat, nextLng]);
        }

        const nextFingerprint = this.getDataFingerprint(parkData);
        const nextVisitedState = this.getVisitedState(parkData);
        const dataChanged = marker._barkDataFingerprint !== nextFingerprint;
        const visitedChanged = marker._barkVisitedState !== nextVisitedState;

        if (!dataChanged && !visitedChanged) return;

        marker._parkData = parkData;
        marker._barkDataFingerprint = nextFingerprint;
        marker._barkVisitedState = nextVisitedState;
        this.applyMarkerStyle(marker);

        if (dataChanged && window.BARK.activePinMarker === marker) {
            this.renderMarkerPanel(marker, { refreshOnly: true });
        }
    }

    createMarker(parkData) {
        const isVisited = this.getVisitedState(parkData);
        const marker = MapMarkerConfig.createCustomMarker(parkData, isVisited);
        marker._layerAdded = false;
        marker._barkLayerType = null;
        marker._barkIsVisible = false;
        marker._barkDataFingerprint = this.getDataFingerprint(parkData);
        marker._barkVisitedState = isVisited;
        this.bindMarkerEvents(marker);
        return marker;
    }

    removeMarker(marker) {
        if (!marker) return;

        if (marker._barkLayerType === 'cluster') {
            this.clusterLayer.removeLayer(marker);
        } else if (marker._barkLayerType === 'plain') {
            this.plainLayer.removeLayer(marker);
        } else {
            this.clusterLayer.removeLayer(marker);
            this.plainLayer.removeLayer(marker);
        }

        marker._layerAdded = false;
        marker._barkLayerType = null;
    }

    resetLayerMembership(points) {
        if (this.clusterLayer && typeof this.clusterLayer.clearLayers === 'function') {
            this.clusterLayer.clearLayers();
        }
        if (this.plainLayer && typeof this.plainLayer.clearLayers === 'function') {
            this.plainLayer.clearLayers();
        }

        points.forEach(point => {
            if (!point || !point.marker) return;
            point.marker._layerAdded = false;
            point.marker._barkLayerType = null;
        });
    }

    clearClusterLayerInternals() {
        if (!this.clusterLayer) return;

        if (this.map && typeof this.map.hasLayer === 'function' && this.map.hasLayer(this.clusterLayer)) {
            this.map.removeLayer(this.clusterLayer);
        }

        if (typeof this.clusterLayer.clearLayers === 'function') {
            this.clusterLayer.clearLayers();
        }
    }

    moveMarkersToLayer(points, targetLayerType, options = {}) {
        if (options.forceReset === true) {
            this.resetLayerMembership(points);
        }

        const markersToAdd = [];
        const policy = window.BARK.getMarkerLayerPolicy
            ? window.BARK.getMarkerLayerPolicy(this.map ? this.map.getZoom() : 0)
            : { cullPlainMarkers: false };

        const clusterMarkersToRemove = [];

        points.forEach(point => {
            const marker = point.marker;
            if (!marker) return;

            const shouldRemove = marker._barkIsVisible === false &&
                targetLayerType === 'plain' &&
                policy.cullPlainMarkers;

            if (shouldRemove) {
                if (marker._layerAdded) {
                    if (marker._barkLayerType === 'cluster') {
                        clusterMarkersToRemove.push(marker);
                        marker._layerAdded = false;
                        marker._barkLayerType = null;
                    } else {
                        this.removeMarker(marker);
                    }
                }
                return;
            }

            if (marker._layerAdded && marker._barkLayerType === targetLayerType) return;

            if (marker._layerAdded) {
                if (marker._barkLayerType === 'cluster') {
                    clusterMarkersToRemove.push(marker);
                    marker._layerAdded = false;
                    marker._barkLayerType = null;
                } else {
                    this.removeMarker(marker);
                }
            }

            marker._layerAdded = true;
            marker._barkLayerType = targetLayerType;
            markersToAdd.push(marker);
        });

        if (clusterMarkersToRemove.length > 0 && targetLayerType !== 'plain') {
            this.clusterLayer.removeLayers(clusterMarkersToRemove);
        }

        if (targetLayerType === 'cluster') {
            if (!this.map.hasLayer(this.clusterLayer)) this.map.addLayer(this.clusterLayer);
            if (markersToAdd.length) this.clusterLayer.addLayers(markersToAdd);
            if (typeof this.clusterLayer.refreshClusters === 'function') {
                this.clusterLayer.refreshClusters();
            }
            if (this.map.hasLayer(this.plainLayer)) this.map.removeLayer(this.plainLayer);
        } else {
            if (clusterMarkersToRemove.length > 0) {
                this.clusterLayer.removeLayers(clusterMarkersToRemove);
            }
            this.clearClusterLayerInternals();
            markersToAdd.forEach(marker => this.plainLayer.addLayer(marker));
            if (!this.map.hasLayer(this.plainLayer)) this.map.addLayer(this.plainLayer);
        }

        window.BARK._lastLayerType = targetLayerType;
    }

    applyVisibility(points = (getParkRepo() ? getParkRepo().getAll() : []), options = {}) {
        this.moveMarkersToLayer(points, this.getTargetLayerType(), options);
    }

    sync(points = (getParkRepo() ? getParkRepo().getAll() : []), options = {}) {
        const incomingIds = new Set();
        const shouldApplyLayers = options.applyLayers !== false;
        const targetLayerType = shouldApplyLayers ? this.getTargetLayerType() : null;
        const slidePanel = document.getElementById('slide-panel');

        points.forEach(point => {
            if (!point || !point.id) return;

            incomingIds.add(point.id);
            let marker = this.markers.get(point.id);

            if (!marker) {
                marker = this.createMarker(point);
                this.markers.set(point.id, marker);
            } else {
                this.updateMarker(marker, point);
            }

            point.marker = marker;
            const parkRepo = getParkRepo();
            if (parkRepo && typeof parkRepo.setMarkerBackedPark === 'function') parkRepo.setMarkerBackedPark(point);
        });

        this.markers.forEach((marker, id) => {
            if (incomingIds.has(id)) return;

            this.removeMarker(marker);
            this.markers.delete(id);
            const parkRepo = getParkRepo();
            if (parkRepo && typeof parkRepo.removePark === 'function') parkRepo.removePark(id);

            if (window.BARK.activePinMarker === marker) {
                window.BARK.activePinMarker = null;
                if (slidePanel) slidePanel.classList.remove('open');
            }
        });

        const parkRepo = getParkRepo();
        if (parkRepo && typeof parkRepo.pruneToIds === 'function') parkRepo.pruneToIds(incomingIds);

        if (shouldApplyLayers) {
            this.moveMarkersToLayer(points, targetLayerType);
        }

        return {
            markerCount: this.markers.size,
            layerType: shouldApplyLayers ? targetLayerType : this.getTargetLayerType()
        };
    }
}

window.BARK.MarkerLayerManager = MarkerLayerManager;
window.MarkerLayerManager = MarkerLayerManager;
