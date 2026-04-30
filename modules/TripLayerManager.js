/**
 * TripLayerManager.js — Owns trip route visuals on a dedicated, never-clustered,
 * never-culled Leaflet layer group. Decouples trip badges/lines/bookends from
 * the park-marker lifecycle so cluster recalculation, viewport culling, and
 * zoom transitions cannot destroy them.
 *
 * Ownership boundary:
 *   - TripLayerManager owns trip overlay Leaflet objects only.
 *   - It NEVER touches park marker DOM.
 *   - MarkerLayerManager reads getStopParkIds() and owns the park-pin--in-trip
 *     class. tripPlannerCore is the orchestrator: it calls sync() then hands
 *     the returned { added, removed } diff to markerManager.refreshTripStopClasses().
 *
 * Public API (window.BARK.tripLayer):
 *   init({ map })            — idempotent; creates the layer group on the map
 *   sync(tripDays, bookends) — diff-based; returns { added: Set, removed: Set }
 *                              of park IDs that gained / lost trip-stop status
 *   clear()                  — remove every overlay element; returns the diff
 *   getStopParkIds()         — Set<string> of park IDs currently in the active
 *                              trip. Treat as read-only; do not mutate.
 *   setDayLinesVisible(bool) — hide/show only the dashed day lines (used while
 *                              the generated driving route is on the map).
 *
 * Performance settings (lowGfxEnabled / ultraLowEnabled / removeShadows /
 * reducePinMotion / simplifyPinsWhileMoving / stopResizing) are honored via
 * body-class CSS chains already managed by mapEngine — no extra wiring here.
 *
 * Future product direction:
 *   Keep this layer intentionally small. Trip popups should remain lightweight
 *   action menus only: remove stop, open park details, or eventually open a
 *   richer "Trip Place / My Visit" card. Do not put notes editors, photo
 *   uploaders, review forms, or thumbnail grids directly inside Leaflet
 *   markers/popups. Those features belong in the slide-panel/card layer so
 *   they can load lazily, virtualize media, and avoid slowing down panning,
 *   zooming, and marker clustering.
 *
 * Future refactor warning:
 *   Custom towns and geocoded trip stops are not official BARK places. This
 *   overlay may display them, but it should not promote them into `allPoints`
 *   or `parkLookup`. A future card controller should accept a normalized
 *   place reference such as:
 *     { kind: 'official', placeId, tripStopId? }
 *     { kind: 'tripPlace', customPlaceId, tripStopId }
 *   and decide which card sections to render outside the map layer.
 */
window.BARK = window.BARK || {};

(function () {
    let tripLayerGroup = null;
    // Stable identity: stop.id when available, otherwise "lat,lng". Reusing
    // markers across reorder/recolor is the reuse-in-place guarantee.
    const badgeMarkers = new Map();   // key: stableStopKey -> marker
    const dayLines = new Map();       // key: dayIdx -> polyline
    const bookendMarkers = new Map(); // key: 'start' | 'end' -> marker
    let tripStopParkIds = new Set();
    let dayLinesVisible = true;

    function getMapRef() {
        return window.map || null;
    }

    function ensureLayerGroup() {
        if (tripLayerGroup) return tripLayerGroup;
        if (typeof L === 'undefined') {
            console.warn('[TripLayerManager] Leaflet unavailable; trip overlay disabled.');
            return null;
        }
        const mapRef = getMapRef();
        if (!mapRef) return null;
        try {
            tripLayerGroup = L.layerGroup().addTo(mapRef);
        } catch (error) {
            console.warn('[TripLayerManager] failed to create overlay layer group:', error);
            tripLayerGroup = null;
        }
        return tripLayerGroup;
    }

    function init({ map } = {}) {
        if (map) window.map = map;
        ensureLayerGroup();
    }

    function stableStopKey(stop) {
        return stop.id || `${stop.lat},${stop.lng}`;
    }

    function buildBadgeIcon(number) {
        return L.divIcon({
            className: 'trip-overlay-badge-wrapper',
            html: `<div class="trip-overlay-badge"><span class="trip-overlay-badge-face"><img src="assets/images/bark-logo.jpeg" alt="" loading="lazy" /></span><span class="trip-overlay-badge-number">${number}</span></div>`,
            iconSize: [42, 42],
            iconAnchor: [21, 21]
        });
    }

    function buildBookendIcon(role, isRoundTrip) {
        let bg, label;
        if (role === 'start') {
            bg = isRoundTrip ? '#8b5cf6' : '#22c55e';
            label = isRoundTrip ? '🔄' : 'A';
        } else {
            bg = '#ef4444';
            label = 'B';
        }
        return L.divIcon({
            className: 'trip-overlay-bookend-wrapper',
            html: `<div class="trip-overlay-bookend" style="--bookend-color:${bg};">${label}</div>`,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
    }

    function escapeHtml(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function buildTripPopupHtml(title, subtitle, options = {}) {
        const safeTitle = escapeHtml(title || 'Trip stop');
        const safeSubtitle = escapeHtml(subtitle || 'Trip stop');
        const safeStopKey = escapeHtml(options.stopKey || '');
        const detailsButton = options.hasParkDetails
            ? '<button type="button" class="trip-overlay-popup-btn trip-overlay-popup-details">Park details</button>'
            : '';

        return `
            <div class="trip-overlay-popup">
                <strong>${safeTitle}</strong>
                <span>${safeSubtitle}</span>
                <div class="trip-overlay-popup-actions">
                    ${detailsButton}
                    <button type="button" class="trip-overlay-popup-btn trip-overlay-popup-remove" data-trip-stop-key="${safeStopKey}">Remove stop</button>
                </div>
            </div>`;
    }

    function bindTripPopupActions(marker) {
        if (!marker || typeof marker.getPopup !== 'function') return;
        const popup = marker.getPopup();
        const element = popup && typeof popup.getElement === 'function' ? popup.getElement() : null;
        if (!element) return;

        const detailsBtn = element.querySelector('.trip-overlay-popup-details');
        if (detailsBtn) {
            detailsBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                forwardClickToParkPanel(marker._tripParkId);
                if (typeof marker.closePopup === 'function') marker.closePopup();
            }, { once: true });
        }

        const removeBtn = element.querySelector('.trip-overlay-popup-remove');
        if (removeBtn) {
            removeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const removeStop = window.BARK && window.BARK.removeTripStopByKey;
                if (typeof removeStop === 'function') {
                    removeStop(marker._tripStopKey || removeBtn.getAttribute('data-trip-stop-key'));
                }
            }, { once: true });
        }
    }

    function syncTripPopup(marker, title, subtitle, enabled, options = {}) {
        if (!marker || typeof marker.bindPopup !== 'function') return;
        if (!enabled) {
            if (typeof marker.unbindPopup === 'function') marker.unbindPopup();
            return;
        }

        marker.bindPopup(
            buildTripPopupHtml(title, subtitle, options),
            { autoPan: true, closeButton: true, className: 'trip-overlay-popup-shell' }
        );
        if (!marker._tripPopupActionsBound) {
            marker._tripPopupActionsBound = true;
            marker.on('popupopen', () => bindTripPopupActions(marker));
        }
    }

    function showTripPopup(marker, title, subtitle, options = {}) {
        if (!marker) return;
        syncTripPopup(marker, title, subtitle, true, options);
        if (typeof marker.openPopup === 'function') marker.openPopup();
    }

    function forwardClickToParkPanel(parkId) {
        if (!parkId) return false;
        const point = window.parkLookup ? window.parkLookup.get(parkId) : null;
        if (!point || !point.marker) return false;
        const manager = window.BARK.markerManager;
        if (manager && typeof manager.renderMarkerPanel === 'function') {
            manager.renderMarkerPanel(point.marker);
            return true;
        }
        return false;
    }

    function handleBadgeClick(marker) {
        showTripPopup(marker, marker._tripStopName, 'Trip stop', {
            stopKey: marker._tripStopKey,
            hasParkDetails: Boolean(marker._tripParkId)
        });
    }

    function handleBookendClick(marker) {
        if (forwardClickToParkPanel(marker._tripParkId)) return;
        const label = marker._tripBookendRole === 'end' ? 'Trip end' : 'Trip start';
        showTripPopup(marker, marker._tripBookendName, label);
    }

    function createBadgeMarker(stop, number, parkId, stopKey) {
        const marker = L.marker([stop.lat, stop.lng], {
            icon: buildBadgeIcon(number),
            interactive: true,
            keyboard: false,
            riseOnHover: true,
            bubblingMouseEvents: false,
            zIndexOffset: 800
        });
        marker._tripParkId = parkId || null;
        marker._tripStopKey = stopKey;
        marker._tripStopName = stop.name || 'Trip stop';
        marker._tripNumber = number;
        syncTripPopup(marker, marker._tripStopName, 'Trip stop', true, {
            stopKey,
            hasParkDetails: Boolean(parkId)
        });
        marker.on('click', () => handleBadgeClick(marker));
        return marker;
    }

    function updateBadgeMarker(marker, stop, number, parkId, stopKey) {
        const latlng = marker.getLatLng();
        if (latlng.lat !== stop.lat || latlng.lng !== stop.lng) {
            marker.setLatLng([stop.lat, stop.lng]);
        }
        if (marker._tripNumber !== number) {
            marker.setIcon(buildBadgeIcon(number));
            marker._tripNumber = number;
        }
        marker._tripParkId = parkId || null;
        marker._tripStopKey = stopKey;
        marker._tripStopName = stop.name || 'Trip stop';
        syncTripPopup(marker, marker._tripStopName, 'Trip stop', true, {
            stopKey,
            hasParkDetails: Boolean(parkId)
        });
    }

    function syncBadges(tripDays) {
        const seen = new Set();
        const nextStopParkIds = new Set();

        tripDays.forEach(day => {
            (day.stops || []).forEach((stop, stopIdx) => {
                if (!stop || typeof stop.lat !== 'number' || typeof stop.lng !== 'number') return;
                const key = stableStopKey(stop);
                // First occurrence wins if a stop somehow appears twice.
                if (seen.has(key)) return;
                seen.add(key);
                if (stop.id) nextStopParkIds.add(stop.id);

                const number = stopIdx + 1;
                const existing = badgeMarkers.get(key);
                if (existing) {
                    updateBadgeMarker(existing, stop, number, stop.id, key);
                    return;
                }

                const marker = createBadgeMarker(stop, number, stop.id, key);
                if (tripLayerGroup) tripLayerGroup.addLayer(marker);
                badgeMarkers.set(key, marker);
            });
        });

        badgeMarkers.forEach((marker, key) => {
            if (seen.has(key)) return;
            if (tripLayerGroup) tripLayerGroup.removeLayer(marker);
            badgeMarkers.delete(key);
        });

        return nextStopParkIds;
    }

    function buildDayLatLngs(tripDays, dayIdx, startLatLng, endLatLng) {
        const latlngs = [];
        const day = tripDays[dayIdx];
        if (!day) return latlngs;
        if (dayIdx === 0 && startLatLng) latlngs.push(startLatLng);
        if (dayIdx > 0) {
            const prevDay = tripDays[dayIdx - 1];
            if (prevDay && prevDay.stops && prevDay.stops.length) {
                const prevLast = prevDay.stops[prevDay.stops.length - 1];
                latlngs.push([prevLast.lat, prevLast.lng]);
            }
        }
        (day.stops || []).forEach(stop => {
            if (typeof stop.lat === 'number' && typeof stop.lng === 'number') {
                latlngs.push([stop.lat, stop.lng]);
            }
        });
        if (dayIdx === tripDays.length - 1 && endLatLng) latlngs.push(endLatLng);
        return latlngs;
    }

    function syncLines(tripDays, startLatLng, endLatLng) {
        const seen = new Set();
        tripDays.forEach((day, dayIdx) => {
            const latlngs = buildDayLatLngs(tripDays, dayIdx, startLatLng, endLatLng);
            if (latlngs.length < 2) return;
            seen.add(dayIdx);
            const color = day.color || '#475569';
            const existing = dayLines.get(dayIdx);
            if (existing) {
                existing.setLatLngs(latlngs);
                if (existing.options.color !== color) existing.setStyle({ color });
                return;
            }
            const line = L.polyline(latlngs, {
                color,
                weight: 3,
                dashArray: '5, 10',
                opacity: 0.6,
                interactive: false,
                className: 'trip-overlay-line'
            });
            if (tripLayerGroup && dayLinesVisible) tripLayerGroup.addLayer(line);
            dayLines.set(dayIdx, line);
        });

        dayLines.forEach((line, dayIdx) => {
            if (seen.has(dayIdx)) return;
            if (tripLayerGroup) tripLayerGroup.removeLayer(line);
            dayLines.delete(dayIdx);
        });
    }

    function syncBookends(bookends) {
        const start = bookends && bookends.start;
        const end = bookends && bookends.end;
        const isRoundTrip = Boolean(
            start && end &&
            typeof window.BARK.haversineDistance === 'function' &&
            window.BARK.haversineDistance(start.lat, start.lng, end.lat, end.lng) < 0.5
        );

        const want = new Map();
        if (start) {
            want.set('start', {
                latlng: [start.lat, start.lng],
                isRoundTrip,
                name: start.name || 'Trip start',
                parkId: start.id || null
            });
        }
        if (end && !isRoundTrip) {
            want.set('end', {
                latlng: [end.lat, end.lng],
                isRoundTrip,
                name: end.name || 'Trip end',
                parkId: end.id || null
            });
        }

        bookendMarkers.forEach((marker, role) => {
            if (want.has(role)) return;
            if (tripLayerGroup) tripLayerGroup.removeLayer(marker);
            bookendMarkers.delete(role);
        });

        want.forEach((spec, role) => {
            const existing = bookendMarkers.get(role);
            if (existing) {
                const latlng = existing.getLatLng();
                if (latlng.lat !== spec.latlng[0] || latlng.lng !== spec.latlng[1]) {
                    existing.setLatLng(spec.latlng);
                }
                if (existing._tripBookendRoundTrip !== spec.isRoundTrip) {
                    existing.setIcon(buildBookendIcon(role, spec.isRoundTrip));
                    existing._tripBookendRoundTrip = spec.isRoundTrip;
                }
                existing._tripBookendName = spec.name;
                existing._tripParkId = spec.parkId;
                syncTripPopup(existing, existing._tripBookendName, role === 'end' ? 'Trip end' : 'Trip start', !spec.parkId);
                return;
            }
            const marker = L.marker(spec.latlng, {
                icon: buildBookendIcon(role, spec.isRoundTrip),
                interactive: true,
                keyboard: false,
                zIndexOffset: 700
            });
            marker._tripBookendRoundTrip = spec.isRoundTrip;
            marker._tripBookendRole = role;
            marker._tripBookendName = spec.name;
            marker._tripParkId = spec.parkId;
            syncTripPopup(marker, marker._tripBookendName, role === 'end' ? 'Trip end' : 'Trip start', !spec.parkId);
            marker.on('click', () => handleBookendClick(marker));
            if (tripLayerGroup) tripLayerGroup.addLayer(marker);
            bookendMarkers.set(role, marker);
        });
    }

    function diffParkIdSets(prev, next) {
        const added = new Set();
        const removed = new Set();
        next.forEach(id => { if (!prev.has(id)) added.add(id); });
        prev.forEach(id => { if (!next.has(id)) removed.add(id); });
        return { added, removed };
    }

    function sync(tripDays, bookends) {
        const prevStopParkIds = tripStopParkIds;
        if (!ensureLayerGroup()) {
            return { added: new Set(), removed: new Set() };
        }
        const days = Array.isArray(tripDays) ? tripDays : [];
        const startLatLng = bookends && bookends.start ? [bookends.start.lat, bookends.start.lng] : null;
        const endLatLng = bookends && bookends.end ? [bookends.end.lat, bookends.end.lng] : null;
        try {
            const nextStopParkIds = syncBadges(days);
            syncLines(days, startLatLng, endLatLng);
            syncBookends(bookends);
            tripStopParkIds = nextStopParkIds;
            return diffParkIdSets(prevStopParkIds, nextStopParkIds);
        } catch (error) {
            console.error('[TripLayerManager] sync failed:', error);
            return { added: new Set(), removed: new Set() };
        }
    }

    function clear() {
        const prevStopParkIds = tripStopParkIds;
        if (tripLayerGroup) {
            badgeMarkers.forEach(marker => tripLayerGroup.removeLayer(marker));
            dayLines.forEach(line => tripLayerGroup.removeLayer(line));
            bookendMarkers.forEach(marker => tripLayerGroup.removeLayer(marker));
        }
        badgeMarkers.clear();
        dayLines.clear();
        bookendMarkers.clear();
        tripStopParkIds = new Set();
        return diffParkIdSets(prevStopParkIds, tripStopParkIds);
    }

    function getStopParkIds() {
        return tripStopParkIds;
    }

    function setDayLinesVisible(visible) {
        const next = Boolean(visible);
        if (next === dayLinesVisible) return;
        dayLinesVisible = next;
        if (!tripLayerGroup) return;
        if (next) {
            dayLines.forEach(line => {
                if (!tripLayerGroup.hasLayer(line)) tripLayerGroup.addLayer(line);
            });
        } else {
            dayLines.forEach(line => {
                if (tripLayerGroup.hasLayer(line)) tripLayerGroup.removeLayer(line);
            });
        }
    }

    window.BARK.tripLayer = { init, sync, clear, getStopParkIds, setDayLinesVisible };
    window.BARK.initTripLayer = function initTripLayer() {
        ensureLayerGroup();
    };
})();
