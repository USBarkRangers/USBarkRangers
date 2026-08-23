/**
 * CanvasMarkerLayer.js — draws the existing individual B.A.R.K. pins on one
 * Leaflet canvas instead of creating thousands of HTML/image trees.
 *
 * This is deliberately a renderer only. ParkRepo, L.marker objects, filtering,
 * search, visited state, and panel behavior stay owned by their existing modules.
 * The selected pin is promoted to the original DOM marker by MarkerLayerManager,
 * so its interaction and active treatment remain unchanged.
 */
window.BARK = window.BARK || {};

(function () {
    'use strict';

    const SPRITE_SIZE = 48;
    const PIN_SIZE = 32;
    const HIT_RADIUS = 22;
    const VIEWPORT_BUFFER = SPRITE_SIZE;
    const MAX_CANVAS_DPR = 2;

    class CanvasMarkerLayer extends L.Layer {
        constructor(options = {}) {
            super(options);
            this._map = null;
            this._canvas = null;
            this._context = null;
            this._points = [];
            this._drawnTargets = [];
            this._sprites = new Map();
            this._images = new Map();
            this._manager = null;
            this._activeMarker = null;
            this._frame = null;
            this._boundSchedule = () => this.requestRedraw();
            this._boundClick = event => this._handleMapClick(event);
            this._loadPinImage('assets/images/bark-logo.jpeg');
            this._loadPinImage('assets/images/bark-tag.jpeg');
        }

        setMarkerManager(manager) {
            this._manager = manager || null;
            this.requestRedraw();
        }

        setPoints(points) {
            this._points = Array.isArray(points) ? points : [];
            this.requestRedraw();
        }

        setActiveMarker(marker) {
            this._activeMarker = marker || null;
            this.requestRedraw();
        }

        getAttachedDomMarkerCount() {
            return 0;
        }

        onAdd(map) {
            this._map = map;
            this._canvas = L.DomUtil.create('canvas', 'leaflet-layer bark-canvas-marker-layer');
            this._canvas.setAttribute('aria-hidden', 'true');
            this._canvas.style.pointerEvents = 'none';
            this._canvas.style.zIndex = '1';
            this._context = this._canvas.getContext('2d', { alpha: true });

            const pane = map.getPane('markerPane');
            if (pane.firstChild) pane.insertBefore(this._canvas, pane.firstChild);
            else pane.appendChild(this._canvas);

            map.on('move zoom resize viewreset', this._boundSchedule);
            map.on('click', this._boundClick);
            this.requestRedraw();
        }

        onRemove(map) {
            map.off('move zoom resize viewreset', this._boundSchedule);
            map.off('click', this._boundClick);
            if (this._frame !== null && typeof window.cancelAnimationFrame === 'function') {
                window.cancelAnimationFrame(this._frame);
            }
            this._frame = null;
            if (this._canvas && this._canvas.parentNode) this._canvas.parentNode.removeChild(this._canvas);
            this._canvas = null;
            this._context = null;
            this._drawnTargets = [];
            this._map = null;
        }

        requestRedraw() {
            if (!this._map || !this._canvas || this._frame !== null) return;
            const schedule = typeof window.requestAnimationFrame === 'function'
                ? window.requestAnimationFrame.bind(window)
                : callback => window.setTimeout(callback, 0);
            this._frame = schedule(() => {
                this._frame = null;
                this.redrawNow();
            });
        }

        redrawNow() {
            if (!this._map || !this._canvas || !this._context) return { drawn: 0, elapsedMs: 0 };

            const started = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            const size = this._map.getSize();
            const dpr = Math.min(Number(window.devicePixelRatio) || 1, MAX_CANVAS_DPR);
            const rawWidth = Math.max(1, Math.round(size.x * dpr));
            const rawHeight = Math.max(1, Math.round(size.y * dpr));

            if (this._canvas.width !== rawWidth || this._canvas.height !== rawHeight) {
                this._canvas.width = rawWidth;
                this._canvas.height = rawHeight;
                this._canvas.style.width = `${size.x}px`;
                this._canvas.style.height = `${size.y}px`;
            }

            const origin = this._map.containerPointToLayerPoint([0, 0]);
            L.DomUtil.setPosition(this._canvas, origin);

            const context = this._context;
            context.setTransform(dpr, 0, 0, dpr, 0, 0);
            context.clearRect(0, 0, size.x, size.y);
            this._drawnTargets = [];

            for (let index = 0; index < this._points.length; index++) {
                const point = this._points[index];
                const marker = point && point.marker;
                if (!point || !marker || marker._barkIsVisible === false || marker === this._activeMarker) continue;

                const visual = this._manager && typeof this._manager.getCanvasMarkerVisualState === 'function'
                    ? this._manager.getCanvasMarkerVisualState(point)
                    : null;
                if (!visual || visual.hiddenByTrip) continue;

                const lat = Number(point.lat);
                const lng = Number(point.lng);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

                const screenPoint = this._map.latLngToContainerPoint([lat, lng]);
                if (
                    screenPoint.x < -VIEWPORT_BUFFER ||
                    screenPoint.y < -VIEWPORT_BUFFER ||
                    screenPoint.x > size.x + VIEWPORT_BUFFER ||
                    screenPoint.y > size.y + VIEWPORT_BUFFER
                ) continue;

                const sprite = this._getSprite(visual, dpr);
                if (sprite) {
                    context.drawImage(
                        sprite,
                        screenPoint.x - (SPRITE_SIZE / 2),
                        screenPoint.y - (SPRITE_SIZE / 2),
                        SPRITE_SIZE,
                        SPRITE_SIZE
                    );
                } else {
                    this._drawFallbackPin(context, screenPoint, visual);
                }

                this._drawnTargets.push({ x: screenPoint.x, y: screenPoint.y, marker });
            }

            const ended = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            const elapsedMs = ended - started;
            if (window.BARK && typeof window.BARK.perfBreadcrumb === 'function') {
                window.BARK.perfBreadcrumb(`canvas-pins:${this._drawnTargets.length}:${Math.round(elapsedMs)}ms`);
            }
            return { drawn: this._drawnTargets.length, elapsedMs };
        }

        _loadPinImage(url) {
            if (this._images.has(url) || typeof Image === 'undefined') return;
            const image = new Image();
            image.decoding = 'async';
            image.onload = () => {
                this._sprites.clear();
                this.requestRedraw();
            };
            image.onerror = () => {
                console.warn(`[CanvasMarkerLayer] pin image could not load: ${url}`);
            };
            image.src = url;
            this._images.set(url, image);
        }

        _getSprite(visual, dpr) {
            const image = this._images.get(visual.iconUrl);
            if (!image || !image.complete || !image.naturalWidth) return null;

            const spriteScale = Math.min(dpr || 1, MAX_CANVAS_DPR);
            const key = [
                visual.iconUrl,
                visual.ringColor,
                visual.shadowColor,
                visual.visited ? 'visited' : 'unvisited',
                spriteScale
            ].join('|');
            if (this._sprites.has(key)) return this._sprites.get(key);

            const sprite = document.createElement('canvas');
            sprite.width = SPRITE_SIZE * spriteScale;
            sprite.height = SPRITE_SIZE * spriteScale;
            const context = sprite.getContext('2d', { alpha: true });
            context.scale(spriteScale, spriteScale);

            const center = SPRITE_SIZE / 2;
            const imageOffset = (SPRITE_SIZE - PIN_SIZE) / 2;
            const radius = (PIN_SIZE / 2) - 1.5;

            if (!visual.visited) {
                context.save();
                context.shadowColor = visual.shadowColor;
                context.shadowBlur = 7;
                context.fillStyle = visual.ringColor;
                context.beginPath();
                context.arc(center, center, radius, 0, Math.PI * 2);
                context.fill();
                context.restore();
            }

            context.save();
            context.beginPath();
            context.arc(center, center, radius, 0, Math.PI * 2);
            context.clip();
            context.drawImage(image, imageOffset, imageOffset, PIN_SIZE, PIN_SIZE);
            context.restore();

            context.strokeStyle = visual.ringColor;
            context.lineWidth = 3;
            context.beginPath();
            context.arc(center, center, radius, 0, Math.PI * 2);
            context.stroke();

            this._sprites.set(key, sprite);
            return sprite;
        }

        _drawFallbackPin(context, point, visual) {
            context.save();
            context.fillStyle = '#ffffff';
            context.strokeStyle = visual.ringColor;
            context.lineWidth = 3;
            context.beginPath();
            context.arc(point.x, point.y, (PIN_SIZE / 2) - 1.5, 0, Math.PI * 2);
            context.fill();
            context.stroke();
            context.restore();
        }

        _handleMapClick(event) {
            if (!event || !event.containerPoint || this._drawnTargets.length === 0) return;
            if (event.originalEvent && event.originalEvent._stopped) return;
            const originalTarget = event.originalEvent && event.originalEvent.target;
            if (originalTarget && typeof originalTarget.closest === 'function' && originalTarget.closest('.leaflet-marker-icon')) return;

            const maxDistanceSquared = HIT_RADIUS * HIT_RADIUS;
            let bestTarget = null;
            let bestDistanceSquared = maxDistanceSquared;

            for (let index = this._drawnTargets.length - 1; index >= 0; index--) {
                const target = this._drawnTargets[index];
                const dx = target.x - event.containerPoint.x;
                const dy = target.y - event.containerPoint.y;
                const distanceSquared = (dx * dx) + (dy * dy);
                if (distanceSquared > bestDistanceSquared || (bestTarget && distanceSquared === bestDistanceSquared)) continue;
                bestDistanceSquared = distanceSquared;
                bestTarget = target;
            }

            if (!bestTarget || !bestTarget.marker || typeof bestTarget.marker.fire !== 'function') return;
            bestTarget.marker.fire('click', {
                latlng: bestTarget.marker.getLatLng(),
                originalEvent: event.originalEvent || null
            });
        }
    }

    window.BARK.CanvasMarkerLayer = CanvasMarkerLayer;
})();
