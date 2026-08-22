/**
 * walkTracker.js — the Live GPS Walk. Watches the user's position while they walk,
 * sums the real distance covered, draws the route on the map, and logs the result
 * as expedition mileage.
 *
 * One platform fact drives the shape of this file: **iOS gives a web app no
 * background location.** When the screen locks or the user switches apps, WebKit
 * suspends the page and `watchPosition` stops firing. There is no JS API that
 * changes that. A beta tester walked 2.17 miles by her watch and the app recorded
 * 0.35 — the first eight minutes, up to the moment the phone went in her pocket.
 *
 * So everything here is built around surviving that gap rather than pretending it
 * doesn't exist:
 *
 * 1. The session is persisted to localStorage as it goes, so a suspended PWA that
 *    gets reloaded by the OS comes back and offers to resume instead of silently
 *    starting from zero. The record also outlives a failed Firestore write, which
 *    used to drop the whole walk on the floor.
 *
 * 2. Coming back from a real gap re-anchors instead of bridging. The old code set
 *    `isBlackedOut = false` before prompting for the missed miles, so the first
 *    ping after the gap *also* added the straight-line displacement across it —
 *    the user's typed number and a phantom segment, counted twice. Now a gap long
 *    enough to prompt for starts a fresh segment worth zero, and only what the
 *    user tells us bridges it. Short gaps still bridge, because the straight line
 *    across twenty seconds is a decent estimate and asking about it would be noise.
 *
 * 3. Nothing is dropped just because the page is hidden. The old ping handler
 *    early-returned on `document.hidden`, which threw away the background updates
 *    that Android *does* deliver. Visibility is now only used to decide whether we
 *    missed enough to ask about — measured from the last fix we actually got, not
 *    from when the page was hidden.
 *
 * Distance is a running sum of accepted fixes, never start-to-turnaround
 * displacement. Fixes are filtered three ways: an accuracy ceiling, a minimum step
 * that scales with the reported accuracy (so a noisy fix has to move further before
 * it counts), and a speed sanity check that re-anchors on a teleport rather than
 * banking it as miles.
 *
 * The route is kept as an array of segments, not one flat list, so a gap is a break
 * in the drawn line rather than a straight bar across the neighborhood.
 *
 * Loaded after expeditionEngine.js, which owns mileage logging and the account and
 * premium gates this module calls through `window.BARK.expeditionGate`.
 * core/app.js calls initWalkTracker() at boot.
 */
window.BARK = window.BARK || {};

(function () {
    'use strict';

    const METERS_PER_MILE = 1609.344;

    const MAX_ACCURACY_METERS = 40;      // above this the fix is noise, not a position
    const MIN_STEP_METERS = 5;           // floor on what counts as movement
    const ACCURACY_STEP_RATIO = 0.25;    // a 40m fix must move 10m before it counts
    const MAX_PLAUSIBLE_MPH = 20;        // faster than this is a GPS jump, not a walk
    const MIN_LOGGABLE_MILES = 0.05;

    const GAP_PROMPT_MINUTES = 2;        // gap worth asking the user to fill in

    // EXPERIMENTAL BETA MATH: these broad walk/run bands are product policy, not
    // a medical or performance claim. Keep the calculation pure and tested so
    // beta feedback can tune the numbers without touching tracker lifecycle code.
    const MAX_WALKING_MPH = 5;
    const MAX_RUNNING_MPH = 12;
    const FALLBACK_DISTANCE_GRACE_MILES = 0.1;
    const MAX_FALLBACK_MILES = 30;
    const STALE_FIX_MS = 30000;          // no fix this long means the signal is gone
    const SIGNAL_TICK_MS = 5000;

    const STORAGE_KEY = 'bark.walk.activeSession';
    const SCREEN_NOTICE_KEY = 'bark.walk.screenLockNoticeSeen';
    const PERSIST_INTERVAL_MS = 5000;
    const RESUME_WINDOW_MS = 12 * 60 * 60 * 1000;
    const MAX_STORED_POINTS = 5000;      // ~8h of walking; oldest drawn points fall off first
    const SESSION_VERSION = 1;

    // ===================== geometry and units (pure) =====================

    function distanceMeters(lat1, lng1, lat2, lng2) {
        const geo = window.BARK.utils && window.BARK.utils.geo;
        if (geo && typeof geo.distanceMeters === 'function') return geo.distanceMeters(lat1, lng1, lat2, lng2);
        return 0;
    }

    function metersToMiles(meters) {
        return meters / METERS_PER_MILE;
    }

    function metersPerSecondToMph(mps) {
        return mps * 2.2369362920544;
    }

    /**
     * Whether a fix that far from the previous one, that long after it, is a walk
     * or a GPS jump. Elapsed time is floored at a second: two fixes in the same
     * millisecond a block apart are the receiver relocating us, and dividing by
     * ~zero would otherwise wave that through as infinitely fast but unmeasurable.
     */
    function isPlausibleStep(meters, elapsedMs) {
        const seconds = Math.max(Number(elapsedMs) || 0, 1000) / 1000;
        return metersPerSecondToMph(meters / seconds) <= MAX_PLAUSIBLE_MPH;
    }

    function requiredStepMeters(accuracyMeters) {
        return Math.max(MIN_STEP_METERS, accuracyMeters * ACCURACY_STEP_RATIO);
    }

    function roundMilesUpToTenth(miles) {
        return Math.ceil((miles - Number.EPSILON) * 10) / 10;
    }

    /**
     * Experimental beta allowance for distance entered after GPS was unavailable.
     * The grace absorbs display/timestamp rounding; the absolute cap prevents a
     * stale session from accepting an unbounded amount even after a long outage.
     */
    function maximumFallbackMiles(gapMinutes, maxMph) {
        const minutes = Math.max(0, Number(gapMinutes) || 0);
        const mph = Math.max(0, Number(maxMph) || 0);
        const distance = (minutes / 60) * mph + FALLBACK_DISTANCE_GRACE_MILES;
        return Math.min(MAX_FALLBACK_MILES, roundMilesUpToTenth(distance));
    }

    function fallbackLimits(gapMinutes) {
        return {
            walkingMiles: maximumFallbackMiles(gapMinutes, MAX_WALKING_MPH),
            runningMiles: maximumFallbackMiles(gapMinutes, MAX_RUNNING_MPH)
        };
    }

    /**
     * Return a decision instead of changing tracker state. Running-speed entries
     * are plausible but need an explicit confirmation; only physically unreasonable
     * entries are rejected outright.
     */
    function validateFallbackMiles(rawValue, gapMinutes) {
        if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') {
            return { status: 'skip', miles: 0 };
        }

        const miles = Number(rawValue);
        const minutes = Number(gapMinutes);
        const limits = fallbackLimits(minutes);
        if (!Number.isFinite(miles) || miles < 0 || !Number.isFinite(minutes) || minutes <= 0) {
            return { status: 'invalid', miles: 0, limits };
        }
        if (miles === 0) return { status: 'skip', miles: 0, limits };
        if (miles > limits.runningMiles) {
            return { status: 'too-far', miles, limits };
        }

        const claimedMph = miles / (minutes / 60);
        return {
            status: claimedMph > MAX_WALKING_MPH ? 'confirm-run' : 'accept',
            miles,
            claimedMph,
            limits
        };
    }

    // ===================== session persistence =====================
    //
    // Written through a throttle on the hot path and forced at every point where
    // the page might not get another turn: hide, unload, stop.

    function readStoredSession() {
        try {
            const raw = window.localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const record = JSON.parse(raw);
            if (!record || record.version !== SESSION_VERSION) return null;
            if (!Number.isFinite(record.totalMiles)) return null;
            return record;
        } catch (err) {
            console.warn('[walkTracker] could not read the stored walk:', err);
            return null;
        }
    }

    /**
     * Coordinates are rounded to ~1m on the way out. The stored route is only ever
     * redrawn, never remeasured — distance is a running total — and full precision
     * would triple the size of a blob we rewrite every few seconds.
     */
    function packSegments(segments) {
        return segments.map(segment => segment.map(point => ({
            lat: Math.round(point.lat * 1e5) / 1e5,
            lng: Math.round(point.lng * 1e5) / 1e5,
            ts: point.ts
        })));
    }

    function writeStoredSession(record) {
        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
        } catch (err) {
            console.warn('[walkTracker] could not save walk progress:', err);
        }
    }

    function clearStoredSession() {
        try {
            window.localStorage.removeItem(STORAGE_KEY);
        } catch (err) {
            console.warn('[walkTracker] could not clear the stored walk:', err);
        }
    }

    function hasSeenScreenNotice() {
        try {
            return window.localStorage.getItem(SCREEN_NOTICE_KEY) === '1';
        } catch (err) {
            return false;
        }
    }

    function markScreenNoticeSeen() {
        try {
            window.localStorage.setItem(SCREEN_NOTICE_KEY, '1');
        } catch (err) { /* private mode — show the notice again next time, no harm */ }
    }

    // ===================== access gates =====================
    //
    // expeditionEngine owns these; the walk sits behind the same account and
    // premium checks the expedition does.

    function gate() {
        return window.BARK.expeditionGate || null;
    }

    function currentUserId() {
        const g = gate();
        const user = g && typeof g.currentUser === 'function' ? g.currentUser() : null;
        return user ? user.uid : null;
    }

    function passesAccessGates() {
        const g = gate();
        if (!g) return true;
        if (typeof g.currentUser === 'function' && !g.currentUser()) {
            if (typeof g.promptAccount === 'function') g.promptAccount('expedition');
            return false;
        }
        if (typeof g.isPremiumUnlocked === 'function' && !g.isPremiumUnlocked()) {
            if (typeof g.promptPremium === 'function') g.promptPremium();
            return false;
        }
        return true;
    }

    // ===================== live route overlay =====================
    //
    // Every guard here exists so the tracker still counts miles in a context with
    // no Leaflet and no map — the node tests, and the seconds before the map boots.

    const LiveRoute = {
        layerGroup: null,
        polyline: null,
        positionMarker: null,

        available() {
            return typeof L !== 'undefined' && typeof L.polyline === 'function' && Boolean(window.map);
        },

        show() {
            if (!this.available()) return;
            if (!this.layerGroup) this.layerGroup = L.featureGroup();
            this.layerGroup.addTo(window.map);
        },

        /** A gap in tracking breaks the line rather than drawing across it. */
        beginSegment(point) {
            if (!this.available()) return;
            this.show();
            this.polyline = L.polyline([[point.lat, point.lng]], {
                color: '#10b981', weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round'
            }).addTo(this.layerGroup);
            this.markPosition(point);
        },

        extend(point) {
            if (!this.available()) return;
            if (!this.polyline) return this.beginSegment(point);
            this.polyline.addLatLng([point.lat, point.lng]);
            this.markPosition(point);
        },

        markPosition(point) {
            if (!this.available()) return;
            if (!this.positionMarker) {
                this.positionMarker = L.circleMarker([point.lat, point.lng], {
                    radius: 7, color: '#ffffff', weight: 3, fillColor: '#10b981', fillOpacity: 1
                }).addTo(this.layerGroup);
                return;
            }
            this.positionMarker.setLatLng([point.lat, point.lng]);
        },

        /** Redraw a resumed walk from its stored segments. */
        restore(segments) {
            if (!this.available()) return;
            this.clear();
            segments.forEach(segment => {
                if (!segment.length) return;
                this.beginSegment(segment[0]);
                segment.slice(1).forEach(point => this.extend(point));
            });
        },

        focus() {
            if (!this.available() || !this.layerGroup || this.layerGroup.getLayers().length === 0) return false;
            const mapNavBtn = document.querySelector('.nav-item[data-target="map-view"]');
            if (mapNavBtn) mapNavBtn.click();
            setTimeout(() => {
                if (!this.available() || !this.layerGroup) return;   // walk may have ended mid-animation
                window.map.invalidateSize();
                window.map.fitBounds(this.layerGroup.getBounds(), {
                    padding: [60, 60], animate: !window.instantNav, duration: window.instantNav ? 0 : 0.5
                });
            }, window.instantNav ? 0 : 250);
            return true;
        },

        clear() {
            this.polyline = null;
            this.positionMarker = null;
            if (!this.layerGroup) return;
            if (typeof this.layerGroup.clearLayers === 'function') this.layerGroup.clearLayers();
            if (window.map && typeof this.layerGroup.removeFrom === 'function') {
                try { this.layerGroup.removeFrom(window.map); } catch (err) { /* map already gone */ }
            }
        }
    };

    // ===================== the tracker =====================

    const WalkTracker = {
        watchId: null,
        wakeLock: null,
        signalTimer: null,
        boundVisibilityHandler: null,
        boundPageHideHandler: null,

        saving: false,
        segments: [],            // [[{lat,lng,ts}, ...], ...] — one array per unbroken run
        totalMiles: 0,
        manualFallbackMiles: 0,  // typed in to cover a gap; earns no points
        lastValidLocation: null,
        lastFixAt: 0,
        gapHandledThroughAt: 0,
        startedAt: 0,
        pendingReanchor: false,
        lastPersistAt: 0,

        isTracking() {
            return this.watchId !== null;
        },

        hasUnsavedWalk() {
            return this.totalMiles > 0 || this.segments.length > 0;
        },

        // ---------- lifecycle ----------

        async start() {
            if (this.isTracking()) return;
            if (!passesAccessGates()) return;
            if (!navigator.geolocation) {
                alert('This device does not support GPS tracking.');
                return;
            }
            if (!confirmScreenNotice()) return;

            this.clearWalkState();
            this.startedAt = Date.now();
            await this.beginWatching();
            this.persist(true);
            renderWalkCard();
        },

        /** Pick a stored walk back up: totals and route survive, watching restarts. */
        async resume(record) {
            if (this.isTracking()) return;
            this.clearWalkState();
            this.segments = normalizeSegments(record.segments);
            this.totalMiles = record.totalMiles;
            this.manualFallbackMiles = Number(record.manualFallbackMiles) || 0;
            this.startedAt = Number(record.startedAt) || Date.now();
            this.lastFixAt = Number(record.lastFixAt) || Number(record.updatedAt) || this.startedAt;
            this.gapHandledThroughAt = Number(record.gapHandledThroughAt) || 0;
            this.pendingReanchor = true;   // we have no idea where they went in between
            LiveRoute.restore(this.segments);

            const recoveredAt = Date.now();
            const gapMinutes = this.missingGapMinutes(recoveredAt);
            if (gapMinutes >= GAP_PROMPT_MINUTES) this.askForMissedMiles(gapMinutes, recoveredAt);

            await this.beginWatching();
            this.persist(true);
            renderWalkCard();
        },

        async beginWatching() {
            this.watchId = navigator.geolocation.watchPosition(
                (pos) => this.processGpsPing(pos),
                (err) => this.handleGpsError(err),
                { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
            );

            await this.requestWakeLock();
            LiveRoute.show();
            showFloatingBanner();

            this.boundVisibilityHandler = () => this.handleVisibilityChange();
            this.boundPageHideHandler = () => this.persist(true);
            document.addEventListener('visibilitychange', this.boundVisibilityHandler);
            window.addEventListener('pagehide', this.boundPageHideHandler);
            this.signalTimer = setInterval(() => renderWalkCard(), SIGNAL_TICK_MS);
        },

        async requestWakeLock() {
            if (!('wakeLock' in navigator)) return;
            try {
                this.wakeLock = await navigator.wakeLock.request('screen');
            } catch (err) {
                console.warn('[walkTracker] wake lock unavailable:', err);
            }
        },

        // ---------- position handling ----------

        processGpsPing(pos) {
            if (!this.isTracking()) return;

            const accuracy = Number(pos.coords.accuracy);
            const lat = Number(pos.coords.latitude);
            const lng = Number(pos.coords.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            if (!Number.isFinite(accuracy) || accuracy > MAX_ACCURACY_METERS) return;

            const fix = { lat, lng, ts: Date.now() };
            const previous = this.lastValidLocation;
            this.lastFixAt = fix.ts;

            if (this.pendingReanchor || !previous) {
                this.openSegment(fix);
                renderWalkCard();
                return;
            }

            const meters = distanceMeters(previous.lat, previous.lng, lat, lng);
            if (meters < requiredStepMeters(accuracy)) {
                // Persist accurate heartbeat fixes even when the dog has not moved
                // far enough to count a step. Recovery math needs a fresh clock.
                this.persist();
                return;
            }

            if (!isPlausibleStep(meters, fix.ts - previous.ts)) {
                // A jump this fast is the receiver relocating us, not us moving.
                this.openSegment(fix);
                renderWalkCard();
                return;
            }

            this.totalMiles += metersToMiles(meters);
            this.lastValidLocation = fix;
            this.appendPoint(fix);
            LiveRoute.extend(fix);
            this.persist();
            renderWalkCard();
        },

        handleGpsError(err) {
            console.error('[walkTracker] GPS error:', err);
            renderWalkCard();
        },

        /** Start a fresh run of points. The move into it is deliberately not counted. */
        openSegment(fix) {
            this.pendingReanchor = false;
            this.lastValidLocation = fix;
            this.segments.push([fix]);
            this.trimStoredPoints();
            LiveRoute.beginSegment(fix);
            this.persist(true);
        },

        appendPoint(fix) {
            if (!this.segments.length) this.segments.push([]);
            this.segments[this.segments.length - 1].push(fix);
            this.trimStoredPoints();
        },

        /** Cap memory on a very long walk. Miles are a running total, so only the drawn tail is lost. */
        trimStoredPoints() {
            let total = countPoints(this.segments);
            while (total > MAX_STORED_POINTS && this.segments.length) {
                const oldest = this.segments[0];
                const overflow = total - MAX_STORED_POINTS;
                if (oldest.length > overflow) {
                    oldest.splice(0, overflow);
                    return;
                }
                total -= oldest.length;
                this.segments.shift();
            }
        },

        // ---------- suspension ----------

        handleVisibilityChange() {
            if (document.hidden) {
                this.persist(true);
                return;
            }

            this.requestWakeLock();

            // Measured from the last fix we actually received, not from when the page
            // was hidden — a platform that kept feeding us positions in the background
            // has nothing missing to ask about.
            const recoveredAt = Date.now();
            const gapMinutes = this.missingGapMinutes(recoveredAt);
            if (gapMinutes >= GAP_PROMPT_MINUTES) {
                this.askForMissedMiles(gapMinutes, recoveredAt);
            }
            renderWalkCard();
        },

        missingGapMinutes(recoveredAt) {
            const gapStartAt = Math.max(this.lastFixAt, this.gapHandledThroughAt, this.startedAt);
            return gapStartAt ? Math.max(0, recoveredAt - gapStartAt) / 60000 : 0;
        },

        finishGapRecovery(recoveredAt) {
            this.pendingReanchor = true;
            this.gapHandledThroughAt = recoveredAt;
            this.persist(true);
        },

        askForMissedMiles(gapMinutes, recoveredAt) {
            const limits = fallbackLimits(gapMinutes);
            const roundedMinutes = Math.max(1, Math.round(gapMinutes));
            const promptText =
                `Your phone paused GPS for about ${roundedMinutes} minutes, so those miles were not recorded.\n\n` +
                `Walking pace is about ${limits.walkingMiles.toFixed(1)} mi for that time. ` +
                `Running entries can be up to ${limits.runningMiles.toFixed(1)} mi with confirmation.\n\n` +
                `How many miles did you cover while GPS was paused? (0 if none)`;

            while (true) {
                const decision = validateFallbackMiles(prompt(promptText), gapMinutes);
                if (decision.status === 'skip') break;
                if (decision.status === 'invalid') {
                    alert('Enter a valid positive number of miles, or 0 for none.');
                    continue;
                }
                if (decision.status === 'too-far') {
                    alert(
                        `${decision.miles.toFixed(2)} mi in ${roundedMinutes} minutes is beyond the experimental ` +
                        `walk/run limit of ${decision.limits.runningMiles.toFixed(1)} mi. Nothing was added.`
                    );
                    continue;
                }
                if (decision.status === 'confirm-run') {
                    const confirmed = confirm(
                        `${decision.miles.toFixed(2)} mi in ${roundedMinutes} minutes is about ` +
                        `${decision.claimedMph.toFixed(1)} mph, which is running pace. Confirm you ran this distance?`
                    );
                    if (!confirmed) continue;
                }

                this.totalMiles += decision.miles;
                this.manualFallbackMiles += decision.miles;
                break;
            }

            this.finishGapRecovery(recoveredAt);
        },

        // ---------- saving ----------

        async stopAndSave() {
            // The save is a round trip to Firestore. Without this a second tap on
            // the button while it is in flight logs the same walk twice.
            if (this.saving) return;
            if (!this.isTracking() && !this.hasUnsavedWalk()) return;

            const finalMiles = this.totalMiles;
            this.saving = true;
            this.stopWatching();

            try {
                if (finalMiles < MIN_LOGGABLE_MILES) {
                    this.discard();
                    alert('Not enough distance recorded to log an expedition.');
                    return;
                }

                this.persist(true, 'pending-save');
                const saved = await this.saveWithRetry(finalMiles);
                if (saved) {
                    this.discard();
                    alert(`Walk saved! You logged ${finalMiles.toFixed(2)} miles toward your trail.`);
                } else {
                    // The record stays on disk; boot will offer it again.
                    this.clearWalkState();
                    alert(`Your ${finalMiles.toFixed(2)} mi walk was kept on this device. We will offer to log it next time you open the app.`);
                }
            } finally {
                this.saving = false;
                renderWalkCard();
            }
        },

        async saveWithRetry(miles) {
            const logMiles = window.BARK.processMileageAddition;
            if (typeof logMiles !== 'function') return false;
            if (await logMiles(miles, 'GPS Active Track')) return true;
            if (!confirm('Saving your walk failed. Try again?')) return false;
            return Boolean(await logMiles(miles, 'GPS Active Track'));
        },

        cancel() {
            if (!confirm("Are you sure you want to cancel your walk? Its miles won't be added to your trail.")) return;
            this.stopWatching();
            this.discard();
            renderWalkCard();
        },

        // ---------- teardown ----------

        /** Stop listening to the OS. Distance and route stay in memory. */
        stopWatching() {
            if (this.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;

            if (this.boundVisibilityHandler) document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
            if (this.boundPageHideHandler) window.removeEventListener('pagehide', this.boundPageHideHandler);
            this.boundVisibilityHandler = null;
            this.boundPageHideHandler = null;

            if (this.signalTimer) clearInterval(this.signalTimer);
            this.signalTimer = null;

            if (this.wakeLock) {
                this.wakeLock.release().catch(() => {});
                this.wakeLock = null;
            }
            hideFloatingBanner();
        },

        clearWalkState() {
            this.segments = [];
            this.totalMiles = 0;
            this.manualFallbackMiles = 0;
            this.lastValidLocation = null;
            this.lastFixAt = 0;
            this.gapHandledThroughAt = 0;
            this.startedAt = 0;
            this.pendingReanchor = false;
            this.lastPersistAt = 0;
        },

        /** Throw the walk away for good: memory, disk, and the drawn route. */
        discard() {
            this.clearWalkState();
            clearStoredSession();
            LiveRoute.clear();
        },

        /** Account switch or sign-out. Whatever was tracked belonged to the old user. */
        reset() {
            this.stopWatching();
            this.discard();
        },

        // ---------- storage ----------

        persist(force, status) {
            const now = Date.now();
            if (!force && now - this.lastPersistAt < PERSIST_INTERVAL_MS) return;
            this.lastPersistAt = now;
            writeStoredSession({
                version: SESSION_VERSION,
                uid: currentUserId(),
                status: status || 'active',
                startedAt: this.startedAt,
                updatedAt: now,
                lastFixAt: this.lastFixAt,
                gapHandledThroughAt: this.gapHandledThroughAt,
                totalMiles: this.totalMiles,
                manualFallbackMiles: this.manualFallbackMiles,
                segments: packSegments(this.segments)
            });
        },

        // ---------- what the card needs to say ----------

        signalState() {
            if (!this.isTracking()) return 'idle';
            if (!this.lastFixAt) return 'acquiring';
            return (Date.now() - this.lastFixAt > STALE_FIX_MS) ? 'weak' : 'live';
        }
    };

    function countPoints(segments) {
        return segments.reduce((sum, segment) => sum + segment.length, 0);
    }

    function normalizeSegments(raw) {
        if (!Array.isArray(raw)) return [];
        return raw
            .filter(Array.isArray)
            .map(segment => segment.filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)))
            .filter(segment => segment.length > 0);
    }

    // ===================== recovering an interrupted walk =====================

    /**
     * iOS can reload a suspended PWA from scratch. Without this the walk in progress
     * simply vanished; the user found out when they hit stop and got nothing.
     */
    async function offerSessionRecovery() {
        const record = readStoredSession();
        if (!record) return;

        const uid = currentUserId();
        if (record.uid) {
            // Leave it alone rather than offer one account's miles to another.
            if (!uid) return;
            if (record.uid !== uid) {
                clearStoredSession();
                return;
            }
        }

        const age = Date.now() - (Number(record.updatedAt) || 0);
        if (age > RESUME_WINDOW_MS) {
            clearStoredSession();
            return;
        }

        const miles = Number(record.totalMiles) || 0;
        if (miles < MIN_LOGGABLE_MILES) {
            clearStoredSession();
            return;
        }

        if (record.status === 'pending-save') {
            if (confirm(`Your last walk (${miles.toFixed(2)} mi) was never saved. Log it now?`)) {
                await saveRecoveredWalk(record);
            } else {
                clearStoredSession();
            }
            renderWalkCard();
            return;
        }

        if (confirm(`You have a walk in progress (${miles.toFixed(2)} mi tracked). Resume tracking it?`)) {
            await WalkTracker.resume(record);
            return;
        }
        if (confirm(`Save the ${miles.toFixed(2)} mi you already tracked?`)) {
            await saveRecoveredWalk(record);
        } else {
            clearStoredSession();
        }
        renderWalkCard();
    }

    async function saveRecoveredWalk(record) {
        const miles = Number(record.totalMiles) || 0;
        const logMiles = window.BARK.processMileageAddition;
        if (typeof logMiles !== 'function') return;
        const saved = await logMiles(miles, 'GPS Active Track');
        if (saved) clearStoredSession();
    }

    // ===================== UI =====================

    const IDLE_DESC =
        'Tracks your real route while the app is open. iOS pauses GPS when the screen locks, ' +
        'so keep this screen on while you walk. Tracked miles advance your trail; completing the full trail earns 1 point.';

    const SCREEN_NOTICE =
        'Before you start:\n\n' +
        'Your phone stops giving the app GPS as soon as the screen locks or you switch apps, ' +
        'so keep this screen open while you walk.\n\n' +
        'If it does lock, we will ask how far you got while it was paused.';

    /** Shown once, ever. The limitation is worth one interruption and no more. */
    function confirmScreenNotice() {
        if (hasSeenScreenNotice()) return true;
        if (typeof confirm === 'function' && !confirm(SCREEN_NOTICE)) return false;
        markScreenNoticeSeen();   // only once they have actually acknowledged it
        return true;
    }

    function signalNote(state) {
        if (state === 'acquiring') return '<span style="color: #f59e0b;">Acquiring GPS…</span>';
        if (state === 'weak') return '<span style="color: #ef4444;">⚠️ Weak GPS signal — distance may be missing.</span>';
        return '<span style="color: #64748b;">Keep this screen on.</span>';
    }

    function renderWalkCard() {
        const btn = document.getElementById('training-action-btn');
        const cancelBtn = document.getElementById('cancel-training-btn');
        const descEl = document.getElementById('training-desc');
        const tracking = WalkTracker.isTracking();

        if (btn) {
            btn.textContent = tracking ? 'Stop & Save' : 'Start Walk';
            btn.className = tracking ? 'glass-btn training-btn active' : 'glass-btn training-btn';
        }
        if (cancelBtn) cancelBtn.style.display = tracking ? 'block' : 'none';

        if (descEl) {
            descEl.innerHTML = tracking
                ? `Distance: <strong style="color: #10b981;">${WalkTracker.totalMiles.toFixed(2)} mi</strong><br>${signalNote(WalkTracker.signalState())}`
                : IDLE_DESC;
        }

        updateBannerDistance();
    }

    function showFloatingBanner() {
        let banner = document.getElementById('live-walk-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'live-walk-banner';
            banner.className = 'live-walk-banner';
            document.body.appendChild(banner);
        }
        banner.innerHTML =
            '<button type="button" id="live-walk-banner-distance" class="live-walk-banner__distance">' +
            '<span class="live-walk-banner__dot">🟢</span> <strong><span id="floating-distance">0.00</span> mi</strong>' +
            '</button>' +
            '<button type="button" id="live-walk-banner-map" class="live-walk-banner__map" aria-label="Follow along on the map">🗺️</button>';

        const distanceBtn = document.getElementById('live-walk-banner-distance');
        if (distanceBtn) {
            distanceBtn.onclick = () => {
                const profileTab = document.querySelector('.nav-item[data-target="profile-view"]');
                if (profileTab) profileTab.click();
            };
        }
        const mapBtn = document.getElementById('live-walk-banner-map');
        if (mapBtn) mapBtn.onclick = () => LiveRoute.focus();

        banner.style.display = 'flex';
        updateBannerDistance();
    }

    function updateBannerDistance() {
        const el = document.getElementById('floating-distance');
        if (el) el.textContent = WalkTracker.totalMiles.toFixed(2);
    }

    function hideFloatingBanner() {
        const banner = document.getElementById('live-walk-banner');
        if (banner) banner.style.display = 'none';
    }

    // ===================== wiring =====================

    /**
     * Boot reaches the walk tracker before Firebase, so at init time nobody is
     * signed in yet and the uid on a stored walk would have nothing to check
     * against. Waiting for the first auth state means the walk is offered back to
     * the account that recorded it, or to nobody.
     */
    function whenAuthSettled(run) {
        if (typeof firebase === 'undefined' || !firebase.auth) {
            run();
            return;
        }
        let done = false;
        let unsubscribe = null;
        const finish = () => {
            if (done) return;
            done = true;
            if (typeof unsubscribe === 'function') unsubscribe();
            run();
        };
        try {
            unsubscribe = firebase.auth().onAuthStateChanged(finish);
        } catch (err) {
            console.warn('[walkTracker] could not wait for sign-in:', err);
            finish();
        }
    }

    function initWalkTracker() {
        renderWalkCard();
        // Deliberately not awaited: recovery asks the user a question and boot
        // should not sit behind the answer.
        whenAuthSettled(() => offerSessionRecovery());
    }

    window.handleTrainingClick = function () {
        if (WalkTracker.isTracking()) WalkTracker.stopAndSave();
        else WalkTracker.start();
    };

    window.cancelTrainingWalk = function () {
        WalkTracker.cancel();
    };

    window.BARK.initWalkTracker = initWalkTracker;
    window.BARK.walkTracker = WalkTracker;

    // Exposed for the node tests, which exercise the filters without a browser.
    // renderWalkCard is in here because the signal warning is driven by the interval
    // tick, which a headless test has no clock for.
    window.BARK.__walkTrackerInternals = {
        distanceMeters, metersToMiles, isPlausibleStep, requiredStepMeters,
        maximumFallbackMiles, fallbackLimits, validateFallbackMiles,
        normalizeSegments, countPoints, readStoredSession, clearStoredSession, renderWalkCard,
        STORAGE_KEY, SCREEN_NOTICE_KEY, MAX_ACCURACY_METERS, MIN_STEP_METERS,
        GAP_PROMPT_MINUTES, MIN_LOGGABLE_MILES, MAX_WALKING_MPH, MAX_RUNNING_MPH,
        MAX_FALLBACK_MILES
    };
})();
