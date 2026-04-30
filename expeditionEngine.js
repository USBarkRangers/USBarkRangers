/**
 * expeditionEngine.js — Virtual Expedition Lifecycle, WalkTracker, Trail Overlays
 * Loaded EIGHTH in the boot sequence.
 */
window.BARK = window.BARK || {};

// ====== TRAILS DATA CACHE ======
async function getTrailsData() {
    if (window._cachedTrailsData) return window._cachedTrailsData;
    try {
        const response = await fetch('trails.json');
        window._cachedTrailsData = await response.json();
        return window._cachedTrailsData;
    } catch (err) {
        console.error("Failed to fetch trails (Singleton Error):", err);
        throw err;
    }
}

window.BARK.getTrailsData = getTrailsData;

// ====== VIRTUAL TRAIL OVERLAY SYSTEM ======
let virtualTrailLayerGroup = null;
let completedTrailsLayerGroup = null;

function getMapRef() {
    return (typeof window.map !== 'undefined') ? window.map : null;
}

function removeTrailLayerGroup(layerGroup) {
    const mapRef = getMapRef();
    if (!layerGroup || !mapRef || typeof layerGroup.removeFrom !== 'function') return;

    try {
        layerGroup.removeFrom(mapRef);
    } catch (error) {
        console.warn('[expeditionEngine] failed to remove trail layer group:', error);
    }
}

function isExpeditionPremiumUnlocked() {
    return Boolean(
        typeof firebase !== 'undefined' &&
        firebase.auth &&
        firebase.auth().currentUser
    );
}

function blockLoggedOutTrailToggle(button) {
    if (button) button.classList.remove('active');
    removeTrailLayerGroup(virtualTrailLayerGroup);
    removeTrailLayerGroup(completedTrailsLayerGroup);
}

function resetExpeditionRuntimeState() {
    removeTrailLayerGroup(virtualTrailLayerGroup);
    removeTrailLayerGroup(completedTrailsLayerGroup);

    if (virtualTrailLayerGroup && typeof virtualTrailLayerGroup.clearLayers === 'function') {
        virtualTrailLayerGroup.clearLayers();
    }
    if (completedTrailsLayerGroup && typeof completedTrailsLayerGroup.clearLayers === 'function') {
        completedTrailsLayerGroup.clearLayers();
    }

    const virtualToggle = document.getElementById('toggle-virtual-trail');
    const completedToggle = document.getElementById('toggle-completed-trails');
    if (virtualToggle) virtualToggle.classList.remove('active');
    if (completedToggle) completedToggle.classList.remove('active');

    window.lastActiveTrailId = null;
    window.lastMilesCompleted = 0;

    const introState = document.getElementById('expedition-intro-state');
    const activeState = document.getElementById('expedition-active-state');
    const completeState = document.getElementById('expedition-complete-state');
    const nameEl = document.getElementById('expedition-name');
    if (introState) introState.style.display = 'block';
    if (activeState) activeState.style.display = 'none';
    if (completeState) completeState.style.display = 'none';
    if (nameEl) {
        nameEl.textContent = '';
        delete nameEl.dataset.trailName;
    }
}

function ensureTrailLayerGroups() {
    if (virtualTrailLayerGroup && completedTrailsLayerGroup) return true;

    if (typeof L === 'undefined' || typeof L.featureGroup !== 'function') {
        console.warn('[expeditionEngine] Leaflet is unavailable; trail overlays cannot initialize yet.');
        return false;
    }

    if (!virtualTrailLayerGroup) virtualTrailLayerGroup = L.featureGroup();
    if (!completedTrailsLayerGroup) completedTrailsLayerGroup = L.featureGroup();
    return true;
}

async function renderCompletedTrailsOverlay(completedExpeditions) {
    if (!ensureTrailLayerGroups()) return;
    completedTrailsLayerGroup.clearLayers();
    if (!completedExpeditions || completedExpeditions.length === 0) return;

    try {
        const trailsData = await getTrailsData();
        completedExpeditions.forEach(exp => {
            const trailId = exp.id || exp.trail_id;
            const trailGeoJson = trailsData[trailId];
            if (trailGeoJson) {
                L.geoJSON(trailGeoJson, {
                    style: { color: '#22c55e', weight: 4, opacity: 0.8, lineCap: 'round', dashArray: '1, 6' },
                    smoothFactor: window.simplifyTrails ? 5.0 : 1.0
                }).addTo(completedTrailsLayerGroup);

                const pt = turf.pointOnFeature(trailGeoJson);
                const coords = pt.geometry.coordinates;
                const pinIcon = L.divIcon({
                    className: 'custom-completed-icon',
                    html: `<div style="font-size: 16px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); background: #22c55e; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 3px solid white;">🏆</div>`,
                    iconSize: [32, 32], iconAnchor: [16, 16]
                });

                const trailName = trailGeoJson.properties ? trailGeoJson.properties.name : "Conquered Trail";
                L.marker([coords[1], coords[0]], { icon: pinIcon })
                    .bindPopup(`<div style="text-align:center;font-weight:800;color:#22c55e;">${trailName}</div><div style="font-size:11px;color:#64748b;text-align:center;margin-top:2px;">Expedition Conquered!</div>`)
                    .addTo(completedTrailsLayerGroup);
            }
        });

        const toggleBtn = document.getElementById('toggle-completed-trails');
        const mapRef = getMapRef();
        if (toggleBtn && toggleBtn.classList.contains('active') && mapRef) {
            completedTrailsLayerGroup.addTo(mapRef);
        }
    } catch (error) {
        console.error("Error rendering completed trails:", error);
    }
}

async function renderVirtualTrailOverlay(trailId, milesCompleted) {
    if (!ensureTrailLayerGroups()) return;
    virtualTrailLayerGroup.clearLayers();
    try {
        const trailsData = await getTrailsData();
        const trailGeoJson = trailsData[trailId];
        if (!trailGeoJson) return;

        const totalMiles = trailGeoJson.properties.total_miles;
        const actualGeoLength = turf.length(trailGeoJson, { units: 'miles' });
        const progressPct = totalMiles > 0 ? Math.min(1, milesCompleted / totalMiles) : 0;
        const geoSafeMiles = actualGeoLength * progressPct;

        if (geoSafeMiles > 0) {
            const completedLine = turf.lineSliceAlong(trailGeoJson, 0, geoSafeMiles, { units: 'miles' });
            L.geoJSON(completedLine, {
                style: { color: '#22c55e', weight: 6, opacity: 0.9, lineCap: 'round' },
                smoothFactor: window.simplifyTrails ? 5.0 : 1.0
            }).addTo(virtualTrailLayerGroup);
        }

        if (geoSafeMiles < actualGeoLength) {
            const remainingLine = turf.lineSliceAlong(trailGeoJson, geoSafeMiles, actualGeoLength, { units: 'miles' });
            L.geoJSON(remainingLine, {
                style: { color: '#ef4444', weight: 4, opacity: 0.6, dashArray: '5, 10', lineCap: 'round' },
                smoothFactor: window.simplifyTrails ? 5.0 : 1.0
            }).addTo(virtualTrailLayerGroup);
        }

        const currentAvatarPoint = turf.along(trailGeoJson, geoSafeMiles, { units: 'miles' });
        const dogIcon = L.divIcon({
            className: 'custom-avatar-icon',
            html: '<div style="font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">🐕</div>',
            iconSize: [30, 30], iconAnchor: [15, 15]
        });

        L.marker([currentAvatarPoint.geometry.coordinates[1], currentAvatarPoint.geometry.coordinates[0]], { icon: dogIcon })
            .addTo(virtualTrailLayerGroup);

        window.lastActiveTrailId = trailId;
        window.lastMilesCompleted = milesCompleted;

        const toggleBtn = document.getElementById('toggle-virtual-trail');
        const mapRef = getMapRef();
        if (toggleBtn && toggleBtn.classList.contains('active') && mapRef) {
            virtualTrailLayerGroup.addTo(mapRef);
        }
    } catch (error) {
        console.error("Error rendering virtual trail:", error);
    }
}

window.BARK.renderVirtualTrailOverlay = renderVirtualTrailOverlay;
window.BARK.renderCompletedTrailsOverlay = renderCompletedTrailsOverlay;
window.BARK.resetExpeditionRuntimeState = resetExpeditionRuntimeState;

// ====== TRAIL TOGGLE BUTTONS ======
function initTrailToggles() {
    const toggleVirtualBtn = document.getElementById('toggle-virtual-trail');
    if (toggleVirtualBtn) {
        toggleVirtualBtn.addEventListener('click', function () {
            if (!isExpeditionPremiumUnlocked()) {
                blockLoggedOutTrailToggle(this);
                return;
            }

            if (!ensureTrailLayerGroups()) return;
            const mapRef = getMapRef();
            if (!mapRef) return;

            this.classList.toggle('active');
            if (this.classList.contains('active')) {
                virtualTrailLayerGroup.addTo(mapRef);
                if (virtualTrailLayerGroup.getLayers().length > 0) {
                    mapRef.fitBounds(virtualTrailLayerGroup.getBounds(), {
                        padding: [50, 50], animate: !window.instantNav, duration: window.instantNav ? 0 : 0.5
                    });
                }
            } else {
                virtualTrailLayerGroup.removeFrom(mapRef);
            }
        });
    }

    const toggleCompletedBtn = document.getElementById('toggle-completed-trails');
    if (toggleCompletedBtn) {
        toggleCompletedBtn.addEventListener('click', function () {
            if (!isExpeditionPremiumUnlocked()) {
                blockLoggedOutTrailToggle(this);
                return;
            }

            if (!ensureTrailLayerGroups()) return;
            const mapRef = getMapRef();
            if (!mapRef) return;

            this.classList.toggle('active');
            if (this.classList.contains('active')) {
                completedTrailsLayerGroup.addTo(mapRef);
                if (completedTrailsLayerGroup.getLayers().length > 0) {
                    mapRef.fitBounds(completedTrailsLayerGroup.getBounds(), {
                        padding: [50, 50], animate: !window.instantNav, duration: window.instantNav ? 0 : 0.5
                    });
                }
            } else {
                completedTrailsLayerGroup.removeFrom(mapRef);
            }
        });
    }
}

window.BARK.initTrailToggles = initTrailToggles;

// ====== TRAIL NAVIGATION & EDUCATION ======
window.flyToActiveTrail = function () {
    if (!ensureTrailLayerGroups()) {
        alert("Trail map data is unavailable. Please refresh and try again.");
        return;
    }

    const mapNavBtn = document.querySelector('.nav-item[data-target="map-view"]');
    if (mapNavBtn) mapNavBtn.click();

    const toggleBtn = document.getElementById('toggle-virtual-trail');
    if (toggleBtn && !toggleBtn.classList.contains('active')) toggleBtn.click();

    const mapRef = getMapRef();
    if (mapRef && virtualTrailLayerGroup.getLayers().length > 0) {
        setTimeout(() => {
            mapRef.invalidateSize();
            mapRef.flyToBounds(virtualTrailLayerGroup.getBounds(), {
                padding: [50, 50], maxZoom: 14, animate: !window.lowGfxEnabled, duration: window.lowGfxEnabled ? 0 : 1.5
            });
        }, 350);
    } else {
        alert("Trail map data is still loading. Please try again in a moment.");
    }
};

window.hydrateEducationModal = function (trailId) {
    const trailData = window.BARK.TOP_10_TRAILS.find(t => t.id === trailId);
    if (!trailData) return;
    const parkEl = document.getElementById('edu-park-name');
    const descEl = document.getElementById('edu-trail-desc');
    const distEl = document.getElementById('edu-trail-distance');
    if (parkEl) parkEl.textContent = trailData.park;
    if (descEl) descEl.textContent = trailData.info;
    if (distEl) distEl.textContent = `${trailData.miles.toFixed(1)} Miles`;
};

// ====== SPIN WHEEL ======
function initSpinWheel() {
    const spinBtn = document.getElementById('spin-wheel-btn');
    if (spinBtn) {
        spinBtn.addEventListener('click', async () => {
            const user = firebase.auth().currentUser;
            if (!user) { alert("Please sign in to start your expedition!"); return; }

            spinBtn.textContent = '🎡 Spinning...';
            spinBtn.disabled = true;
            spinBtn.style.opacity = '0.7';

            window.BARK.incrementRequestCount();
            const userRef = firebase.firestore().collection('users').doc(user.uid);

            try {
                const docSnap = await userRef.get();
                const userData = docSnap.data() || {};
                const completedExpeditions = userData.completed_expeditions || [];
                const completionCounts = {};
                window.BARK.TOP_10_TRAILS.forEach(t => completionCounts[t.id] = 0);
                completedExpeditions.forEach(exp => { const id = exp.id || exp.trail_id; if (completionCounts[id] !== undefined) completionCounts[id]++; });
                const minCount = Math.min(...Object.values(completionCounts));
                let availableTrails = window.BARK.TOP_10_TRAILS.filter(trail => completionCounts[trail.id] === minCount);
                const isGrandCanyonAvailable = availableTrails.some(t => t.id === 'grand_canyon_rim2rim');
                if (isGrandCanyonAvailable && availableTrails.length > 1) availableTrails = availableTrails.filter(t => t.id !== 'grand_canyon_rim2rim');
                if (minCount > 0 && availableTrails.length === window.BARK.TOP_10_TRAILS.length - 1) alert(`🌟 Prestige Mode Lap ${minCount + 1}! You've conquered every trail. Spin to start your next lap!`);

                let spinCount = 0;
                let finalTrail = null;
                const nameHeader = document.getElementById('expedition-name');
                const shuffleInterval = setInterval(() => {
                    const randomTrail = availableTrails[Math.floor(Math.random() * availableTrails.length)];
                    if (nameHeader) nameHeader.textContent = randomTrail.name;
                    spinCount++;
                    if (spinCount > 15) {
                        clearInterval(shuffleInterval);
                        finalTrail = availableTrails[Math.floor(Math.random() * availableTrails.length)];
                        if (nameHeader) nameHeader.textContent = finalTrail.name;
                        assignTrailToUser(user.uid, finalTrail);
                        setTimeout(() => { spinBtn.textContent = '🎡 Spin for a Trail'; spinBtn.disabled = false; spinBtn.style.opacity = '1'; }, 500);
                    }
                }, 120);
            } catch (error) {
                console.error("Error fetching spin data:", error);
                alert("Error spinning the wheel. Please check your connection.");
                spinBtn.textContent = '🎡 Spin for a Trail'; spinBtn.disabled = false; spinBtn.style.opacity = '1';
            }
        });
    }
}

window.BARK.initSpinWheel = initSpinWheel;

async function assignTrailToUser(uid, trail) {
    window.BARK.incrementRequestCount();
    const userRef = firebase.firestore().collection('users').doc(uid);
    const doc = await userRef.get();
    const data = doc.data() || {};
    const existingHistory = (data.virtual_expedition && data.virtual_expedition.history) || [];

    await userRef.set({
        virtual_expedition: { active_trail: trail.id, trail_name: trail.name, miles_logged: 0, trail_total_miles: trail.miles, history: existingHistory }
    }, { merge: true });

    document.getElementById('expedition-intro-state').style.display = 'none';
    const activeEl = document.getElementById('expedition-active-state');
    const nameHeader = document.getElementById('expedition-name');
    if (nameHeader) { nameHeader.textContent = trail.name; nameHeader.dataset.trailName = trail.name; }
    activeEl.style.display = 'block';
    window.hydrateEducationModal(trail.id);
    activeEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' });

    renderExpeditionProgress(0, trail.miles);
    renderExpeditionHistory(existingHistory, trail.name);
}

window.BARK.assignTrailToUser = assignTrailToUser;

// ====== GPS DISTANCE HELPER ======
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ====== MILEAGE PROCESSING ======
function getMileageContext(userData) {
    const data = userData || {};
    const expedition = (typeof data.virtual_expedition === 'object' && data.virtual_expedition) || {};
    const hasActiveExpedition = Boolean(expedition.active_trail);
    const history = Array.isArray(expedition.history) ? [...expedition.history] : [];

    return {
        expedition,
        hasActiveExpedition,
        currentMiles: hasActiveExpedition ? Number(expedition.miles_logged) || 0 : 0,
        totalMiles: hasActiveExpedition ? Number(expedition.trail_total_miles) || 0 : 0,
        history,
        trailName: hasActiveExpedition ? (expedition.trail_name || "Active Trail") : "General Walk",
        lifetimeMiles: Number(data.lifetime_miles) || 0
    };
}

function updateLifetimeMilesDisplay(lifetimeMiles) {
    const lifetimeEl = document.getElementById('lifetime-miles-display');
    if (lifetimeEl) lifetimeEl.textContent = `${lifetimeMiles.toFixed(1)} mi`;
}

async function processMileageAddition(milesToAdd, typeLabel) {
    if (typeof firebase === 'undefined' || !firebase.auth || !firebase.firestore) {
        alert("Mileage logging is unavailable right now. Please refresh and try again.");
        return false;
    }

    const user = firebase.auth().currentUser;
    if (!user) return false;
    const userRef = firebase.firestore().collection('users').doc(user.uid);
    window.BARK.incrementRequestCount();

    try {
        const docSnap = await userRef.get();
        const userData = docSnap.data() || {};
        const context = getMileageContext(userData);
        const milesLogged = parseFloat(milesToAdd.toFixed(2));

        let newTotal = context.currentMiles + milesLogged;
        if (context.totalMiles > 0 && newTotal > context.totalMiles) newTotal = context.totalMiles;

        const logEntry = { ts: Date.now(), miles: milesLogged, type: typeLabel, trailName: context.trailName };
        const history = [logEntry, ...context.history];
        const virtualExpedition = { ...context.expedition, history };
        if (context.hasActiveExpedition) virtualExpedition.miles_logged = newTotal;

        await userRef.set({
            virtual_expedition: virtualExpedition,
            lifetime_miles: firebase.firestore.FieldValue.increment(milesLogged),
            walkPoints: firebase.firestore.FieldValue.increment(milesLogged)
        }, { merge: true });

        window.currentWalkPoints = (window.currentWalkPoints || 0) + milesLogged;
        if (window.BARK && typeof window.BARK.syncScoreToLeaderboard === 'function') {
            await window.BARK.syncScoreToLeaderboard();
        }

        const nextLifetimeMiles = context.lifetimeMiles + milesLogged;
        if (context.hasActiveExpedition) {
            renderExpeditionProgress(newTotal, context.totalMiles, nextLifetimeMiles);
            renderExpeditionHistory(history, context.trailName);
        } else {
            updateLifetimeMilesDisplay(nextLifetimeMiles);
            renderExpeditionHistory(history, context.trailName);
        }

        if (context.totalMiles > 0 && newTotal >= context.totalMiles) {
            setTimeout(() => alert("🎉 Expedition Complete! You conquered the trail!"), 800);
        }
        return true;
    } catch (error) {
        console.error("Failed to log miles:", error);
        alert("Failed to log miles. Please check your connection and try again.");
        return false;
    }
}

// ====== MANUAL MILES ======
function initManualMiles() {
    const logManualBtn = document.getElementById('log-manual-miles-btn');
    if (logManualBtn) {
        logManualBtn.addEventListener('click', async () => {
            const inputEl = document.getElementById('miles-input');
            let milesToLog = parseFloat(inputEl.value);
            if (isNaN(milesToLog) || milesToLog <= 0) return;
            if (milesToLog > 15) { alert("Whoa there! You can only log a maximum of 15 miles per day manually."); milesToLog = 15; inputEl.value = 15; }
            const logged = await processMileageAddition(milesToLog, 'Manual Entry');
            if (logged) inputEl.value = '';
        });
    }
}

window.BARK.initManualMiles = initManualMiles;

// ====== EXPEDITION PROGRESS ======
function renderExpeditionProgress(current, total, lifetime) {
    const fillEl = document.getElementById('expedition-fill');
    const textEl = document.getElementById('expedition-progress-text');
    const lifetimeEl = document.getElementById('lifetime-miles-display');
    const activeState = document.getElementById('expedition-active-state');
    const completeState = document.getElementById('expedition-complete-state');
    if (!fillEl || !textEl) return;

    const pct = (total > 0) ? Math.min(100, (current / total) * 100) : 0;
    fillEl.style.width = `${pct.toFixed(1)}%`;
    textEl.textContent = `${current.toFixed(1)} / ${total.toFixed(1)} Miles (${pct.toFixed(1)}%)`;

    if (total > 0 && current >= total && activeState && completeState) {
        activeState.style.display = 'none';
        completeState.style.display = 'block';
        document.getElementById('expedition-name').textContent = "CONQUERED";
        const trailName = document.getElementById('celebration-trail-name');
        if (trailName) {
            const currentTrailName = document.getElementById('expedition-name').dataset.trailName || "Expedition";
            trailName.textContent = currentTrailName;
        }
    } else if (activeState && completeState) {
        const nameHeader = document.getElementById('expedition-name');
        if (nameHeader && nameHeader.textContent === "CONQUERED") nameHeader.textContent = nameHeader.dataset.trailName || "";
    }

    if (lifetimeEl && lifetime !== undefined) lifetimeEl.textContent = `${lifetime.toFixed(1)} mi`;
}

window.BARK.renderExpeditionProgress = renderExpeditionProgress;

// ====== EXPEDITION HISTORY ======
function clearElement(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
}

function formatWalkMiles(value) {
    const miles = Number(value);
    return Number.isFinite(miles) ? miles.toFixed(2) : '0.00';
}

function getWalkLogIcon(type) {
    return type === 'GPS Verified' ? '📍' : '✏️';
}

function getWalkLogTypeLabel(type) {
    return typeof type === 'string' && type.trim() ? type : 'Manual Entry';
}

function appendExpeditionEmptyState(container, tagName, text, cssText) {
    clearElement(container);
    const empty = document.createElement(tagName);
    empty.style.cssText = cssText;
    empty.textContent = text;
    container.appendChild(empty);
}

function createRecentWalkLogItem(log) {
    const li = document.createElement('li');
    li.className = 'log-item';

    const left = document.createElement('div');
    left.className = 'log-item-left';

    const type = document.createElement('span');
    type.className = 'log-item-type';
    type.textContent = `${getWalkLogIcon(log.type)} ${getWalkLogTypeLabel(log.type)}`;

    const date = document.createElement('span');
    date.className = 'log-item-date';
    date.textContent = new Date(log.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const miles = document.createElement('div');
    miles.className = 'log-item-miles';
    miles.textContent = `+${formatWalkMiles(log.miles)} mi`;

    left.appendChild(type);
    left.appendChild(date);
    li.appendChild(left);
    li.appendChild(miles);
    return li;
}

function createWalkActionButton(label, color, handler) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.style.cssText = `background: none; border: none; color: ${color}; font-size: 10px; font-weight: 800; cursor: pointer; padding: 4px; letter-spacing: 0.5px;`;
    button.addEventListener('click', handler);
    return button;
}

function createManageWalkLogItem(log) {
    const li = document.createElement('li');
    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f8fafc;';

    const left = document.createElement('div');
    left.style.cssText = 'display: flex; align-items: center; gap: 8px;';

    const icon = document.createElement('span');
    icon.style.cssText = 'font-size: 14px;';
    icon.textContent = getWalkLogIcon(log.type);

    const details = document.createElement('div');
    details.style.cssText = 'display: flex; flex-direction: column;';

    const miles = document.createElement('span');
    miles.style.cssText = 'font-weight: 700; color: #1e293b; font-size: 13px;';
    miles.textContent = `${formatWalkMiles(log.miles)} mi`;

    const date = document.createElement('span');
    date.style.cssText = 'font-size: 10px; color: #64748b;';
    date.textContent = new Date(log.ts).toLocaleString([], { month: 'short', day: 'numeric' });

    details.appendChild(miles);
    details.appendChild(date);
    left.appendChild(icon);
    left.appendChild(details);

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 12px;';
    actions.appendChild(createWalkActionButton('EDIT', '#3b82f6', () => window.editWalkMiles(log.ts)));
    actions.appendChild(createWalkActionButton('DELETE', '#ef4444', () => window.deleteWalkLog(log.ts)));

    li.appendChild(left);
    li.appendChild(actions);
    return li;
}

function createWalkGroup(trail, logs) {
    const group = document.createElement('div');
    group.style.cssText = 'margin-bottom: 20px;';

    const totalTrailMiles = logs.reduce((sum, log) => sum + (Number(log.miles) || 0), 0);
    const header = document.createElement('div');
    header.style.cssText = 'font-size: 11px; font-weight: 900; color: #94a3b8; text-transform: uppercase; margin-bottom: 10px; display: flex; justify-content: space-between; padding: 0 4px;';

    const trailName = document.createElement('span');
    trailName.textContent = trail;

    const total = document.createElement('span');
    total.textContent = `${totalTrailMiles.toFixed(2)} mi`;

    header.appendChild(trailName);
    header.appendChild(total);

    const list = document.createElement('ul');
    list.style.cssText = 'list-style: none; padding: 0; margin: 0; background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #f1f5f9;';
    logs.forEach(log => list.appendChild(createManageWalkLogItem(log)));

    group.appendChild(header);
    group.appendChild(list);
    return group;
}

function renderExpeditionHistory(historyArray, activeTrailName = "Expedition") {
    const list = document.getElementById('expedition-history-list');
    const safeHistory = Array.isArray(historyArray) ? historyArray : [];
    if (list) {
        const currentTrailLogs = safeHistory.filter(log => log.trailName && log.trailName === activeTrailName);
        if (!currentTrailLogs || currentTrailLogs.length === 0) {
            appendExpeditionEmptyState(list, 'li', 'No miles logged yet.', 'color: #94a3b8; font-size: 11px; text-align: center; padding: 10px 0; font-style: italic;');
        } else {
            clearElement(list);
            currentTrailLogs.slice(0, 5).forEach(log => list.appendChild(createRecentWalkLogItem(log)));
        }
    }

    const masterList = document.getElementById('manage-walks-list');
    const masterCount = document.getElementById('manage-walks-count');
    if (masterList) {
        if (masterCount) masterCount.textContent = safeHistory.length;
        if (!safeHistory || safeHistory.length === 0) {
            appendExpeditionEmptyState(masterList, 'div', 'No walks logged yet.', 'color: #94a3b8; font-size: 12px; text-align: center; padding: 20px; font-style: italic;');
            return;
        }

        const grouped = safeHistory.reduce((acc, log) => {
            const isGeneric = !log.trailName || log.trailName === "Expedition" || log.trailName === "Active Trail";
            const trail = isGeneric ? (activeTrailName || "Expedition") : log.trailName;
            if (!acc.has(trail)) acc.set(trail, []);
            acc.get(trail).push(log);
            return acc;
        }, new Map());

        clearElement(masterList);
        grouped.forEach((logs, trail) => masterList.appendChild(createWalkGroup(trail, logs)));
    }
}

window.BARK.renderExpeditionHistory = renderExpeditionHistory;

// ====== EDIT/DELETE WALKS ======
window.editWalkMiles = async function (timestamp) {
    const user = firebase.auth().currentUser;
    if (!user) return;
    const userRef = firebase.firestore().collection('users').doc(user.uid);
    try {
        const doc = await userRef.get();
        const data = doc.data();
        let history = (data.virtual_expedition && data.virtual_expedition.history) || [];
        const logIndex = history.findIndex(l => l.ts.toString() === timestamp.toString());
        if (logIndex === -1) return;
        const currentLog = history[logIndex];
        const activeTrailName = data.virtual_expedition.trail_name;

        const newMilesStr = prompt("Enter new miles for this walk:", currentLog.miles);
        if (newMilesStr === null) return;
        const newMiles = parseFloat(newMilesStr);
        if (isNaN(newMiles) || newMiles < 0) { alert("Please enter a valid mileage."); return; }

        const newTrailName = prompt("Which trail was this on?", currentLog.trailName || "Expedition");
        if (newTrailName === null) return;

        const currentDateStr = new Date(currentLog.ts).toISOString().slice(0, 16);
        const newDateStr = prompt("Edit Date/Time (YYYY-MM-DDTHH:MM):", currentDateStr);
        if (newDateStr === null) return;
        const newTs = new Date(newDateStr).getTime();
        if (isNaN(newTs)) { alert("Invalid date format."); return; }

        const oldMiles = currentLog.miles;
        const oldTrail = currentLog.trailName;
        const diff = newMiles - oldMiles;

        history[logIndex].miles = newMiles;
        history[logIndex].trailName = newTrailName;
        history[logIndex].ts = newTs;
        history.sort((a, b) => b.ts - a.ts);

        let currentProgress = data.virtual_expedition.miles_logged || 0;
        if (oldTrail === activeTrailName && newTrailName === activeTrailName) currentProgress += diff;
        else if (oldTrail === activeTrailName && newTrailName !== activeTrailName) currentProgress -= oldMiles;
        else if (oldTrail !== activeTrailName && newTrailName === activeTrailName) currentProgress += newMiles;
        if (currentProgress < 0) currentProgress = 0;
        const maxMiles = data.virtual_expedition.trail_total_miles || 10;
        if (currentProgress > maxMiles) currentProgress = maxMiles;

        await userRef.update({
            "virtual_expedition.history": history,
            "virtual_expedition.miles_logged": currentProgress,
            "lifetime_miles": firebase.firestore.FieldValue.increment(diff),
            "walkPoints": firebase.firestore.FieldValue.increment(diff)
        });
        window.currentWalkPoints = (window.currentWalkPoints || 0) + diff;
        await window.BARK.syncScoreToLeaderboard();
        if (typeof window.BARK.showTripToast === 'function') window.BARK.showTripToast("Walk log updated ✏️");
    } catch (e) { console.error(e); alert("Failed to update walk."); }
};

window.deleteWalkLog = async function (timestamp) {
    if (!confirm("Are you sure? Removing this walk will subtract these miles from your progress, but you keep your reward points.")) return;
    const user = firebase.auth().currentUser;
    if (!user) return;
    const userRef = firebase.firestore().collection('users').doc(user.uid);
    try {
        const doc = await userRef.get();
        const data = doc.data();
        let history = (data.virtual_expedition && data.virtual_expedition.history) || [];
        const logIndex = history.findIndex(l => l.ts.toString() === timestamp.toString());
        if (logIndex === -1) return;
        const currentLog = history[logIndex];
        const milesToRemove = currentLog.miles;
        const walkTrail = currentLog.trailName;
        const activeTrail = data.virtual_expedition.trail_name;
        history.splice(logIndex, 1);
        let currentProgress = data.virtual_expedition.miles_logged || 0;
        if (walkTrail === activeTrail) currentProgress -= milesToRemove;
        if (currentProgress < 0) currentProgress = 0;

        await userRef.update({
            "virtual_expedition.history": history,
            "virtual_expedition.miles_logged": currentProgress,
            "lifetime_miles": firebase.firestore.FieldValue.increment(-milesToRemove),
            "walkPoints": firebase.firestore.FieldValue.increment(-milesToRemove)
        });
        window.currentWalkPoints = Math.max(0, (window.currentWalkPoints || 0) - milesToRemove);
        await window.BARK.syncScoreToLeaderboard();
        if (typeof window.BARK.showTripToast === 'function') window.BARK.showTripToast("Walk removed 🗑️");
    } catch (e) { console.error(e); alert("Failed to delete walk."); }
};

// ====== CLAIM REWARD ======
window.claimRewardAndReset = async function () {
    const user = firebase.auth().currentUser;
    if (!user) return;
    const userRef = firebase.firestore().collection('users').doc(user.uid);
    try {
        const docSnap = await userRef.get();
        const userData = docSnap.data();
        if (!userData || !userData.virtual_expedition) return;
        const currentTrailName = userData.virtual_expedition.trail_name || "Expedition";
        const trailMiles = userData.virtual_expedition.trail_total_miles || 0;
        const pointsEarned = Math.max(1, Math.round(trailMiles / 2));

        const completedTrail = { id: userData.virtual_expedition.active_trail, name: currentTrailName, miles: trailMiles, points_earned: pointsEarned, date_completed: Date.now() };
        const completedArray = userData.completed_expeditions || [];
        const existingIndex = completedArray.findIndex(exp => exp.id === completedTrail.id);
        if (existingIndex > -1) completedArray[existingIndex].date_completed = Date.now();
        else completedArray.push(completedTrail);

        await userRef.update({
            "completed_expeditions": completedArray,
            "virtual_expedition.active_trail": null, "virtual_expedition.trail_name": null, "virtual_expedition.miles_logged": 0, "virtual_expedition.trail_total_miles": 0,
            "walkPoints": firebase.firestore.FieldValue.increment(pointsEarned)
        });
        window.currentWalkPoints = (window.currentWalkPoints || 0) + pointsEarned;
        await window.BARK.syncScoreToLeaderboard();
        if (typeof window.BARK.showTripToast === 'function') window.BARK.showTripToast(`🏆 +${pointsEarned} PTS! Reward Claimed: ${currentTrailName}`);
    } catch (e) { console.error(e); alert("Failed to claim reward."); }
};

// ====== COMPLETED EXPEDITIONS GRID ======
function renderCompletedExpeditions(expeditionsArray) {
    const grid = document.getElementById('completed-expeditions-grid');
    const caseEl = document.getElementById('expedition-trophy-case');
    if (!grid || !caseEl) return;
    if (!expeditionsArray || expeditionsArray.length === 0) { caseEl.style.display = 'none'; return; }
    caseEl.style.display = 'block';
    clearElement(grid);

    expeditionsArray.forEach(exp => {
        const name = exp.name || exp.trail_name || "Expedition";
        const rawDate = exp.date_completed || exp.ts || Date.now();
        const dateStr = new Date(rawDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

        const card = document.createElement('div');
        card.style.cssText = 'background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; display: flex; align-items: center; gap: 10px; flex: 0 0 180px; scroll-snap-align: start;';

        const medal = document.createElement('div');
        medal.style.cssText = 'font-size: 24px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.1));';
        medal.textContent = '🏅';

        const details = document.createElement('div');
        details.style.cssText = 'display: flex; flex-direction: column;';

        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'font-size: 12px; font-weight: 800; color: #1e293b; line-height: 1.2; white-space: normal;';
        nameEl.textContent = name;

        const dateEl = document.createElement('span');
        dateEl.style.cssText = 'font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 2px;';
        dateEl.textContent = dateStr;

        details.appendChild(nameEl);
        details.appendChild(dateEl);
        card.appendChild(medal);
        card.appendChild(details);
        grid.appendChild(card);
    });
}

window.BARK.renderCompletedExpeditions = renderCompletedExpeditions;

// ====== WALK TRACKER (Advanced GPS Tracking) ======
const WalkTracker = {
    watchId: null, wakeLock: null, points: [], totalMiles: 0, lastValidLocation: null,
    isBlackedOut: false, blackoutStartTime: 0, boundVisibilityHandler: null,

    async start() {
        if (!navigator.geolocation) return alert('GPS not supported');
        this.points = []; this.totalMiles = 0; this.lastValidLocation = null;
        try { if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen'); } catch (err) { console.warn('Wake Lock failed/denied:', err); }

        const btn = document.getElementById('training-action-btn');
        if (btn) { btn.textContent = 'Tracking Active 🟢'; btn.className = 'glass-btn training-btn active'; btn.onclick = () => this.stopAndSave(); }
        const cancelBtn = document.getElementById('cancel-training-btn');
        if (cancelBtn) cancelBtn.style.display = 'block';

        this.watchId = navigator.geolocation.watchPosition((pos) => this.processGpsPing(pos), (err) => console.error("GPS Error:", err), { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });
        this.showFloatingBanner();
        this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    },

    processGpsPing(pos) {
        if (this.isBlackedOut) return;
        const accMeters = pos.coords.accuracy;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (accMeters > 25) return;
        if (!this.lastValidLocation) { this.lastValidLocation = { lat, lng, ts: Date.now() }; this.points.push(this.lastValidLocation); return; }
        const distMeters = getDistanceMeters(this.lastValidLocation.lat, this.lastValidLocation.lng, lat, lng);
        if (distMeters > 5) {
            const miles = distMeters * 0.000621371;
            this.totalMiles += miles;
            this.lastValidLocation = { lat, lng, ts: Date.now() };
            this.points.push(this.lastValidLocation);
            this.updateDistanceUI();
        }
    },

    handleVisibilityChange() {
        if (document.hidden) { this.isBlackedOut = true; this.blackoutStartTime = Date.now(); }
        else {
            this.isBlackedOut = false;
            const blackoutDurationMins = (Date.now() - this.blackoutStartTime) / 60000;
            if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(wl => this.wakeLock = wl).catch(() => {});
            if (blackoutDurationMins > 2) this.triggerBlackoutFallback(blackoutDurationMins);
        }
    },

    triggerBlackoutFallback(minutesLost) {
        const manualMiles = prompt(`Welcome back! iOS paused your GPS for ${Math.round(minutesLost)} minutes.\n\nWe tracked ${this.totalMiles.toFixed(2)} miles before the pause. How many missing miles? (Enter 0 if none)`);
        const parsed = parseFloat(manualMiles);
        if (!isNaN(parsed) && parsed > 0) { this.totalMiles += parsed; this.updateDistanceUI(); }
    },

    async stopAndSave() {
        const finalMiles = this.totalMiles;
        this.cleanup();
        if (finalMiles < 0.05) alert("Not enough distance recorded to log an expedition.");
        else { alert(`Expedition Complete! You logged ${finalMiles.toFixed(2)} miles.`); await processMileageAddition(finalMiles, 'GPS Active Track'); }
        initTrainingUI();
    },

    cancel() { this.cleanup(); initTrainingUI(); },

    cleanup() {
        if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
        if (this.boundVisibilityHandler) document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
        if (this.wakeLock) { this.wakeLock.release().catch(() => {}); this.wakeLock = null; }
        this.hideFloatingBanner();
        this.watchId = null; this.boundVisibilityHandler = null; this.points = []; this.totalMiles = 0; this.lastValidLocation = null; this.isBlackedOut = false;
    },

    showFloatingBanner() {
        let banner = document.getElementById('live-walk-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'live-walk-banner';
            banner.style.cssText = `position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: rgba(15, 23, 42, 0.95); color: white; padding: 10px 24px; border-radius: 30px; z-index: 10000; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid #10b981; cursor: pointer; font-size: 14px; transition: all 0.3s ease;`;
            banner.onclick = () => { const profileTab = document.querySelector('.nav-item[data-target="profile-view"]'); if (profileTab) profileTab.click(); };
            document.body.appendChild(banner);
            const style = document.createElement('style');
            style.innerHTML = `@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.5; } 100% { opacity: 1; } }`;
            document.head.appendChild(style);
        }
        banner.innerHTML = `<span style="animation: pulse 2s infinite;">🟢</span> <strong><span id="floating-distance">0.00</span> mi</strong>`;
        banner.style.display = 'flex';
    },

    hideFloatingBanner() { const banner = document.getElementById('live-walk-banner'); if (banner) banner.style.display = 'none'; },

    updateDistanceUI() {
        const descEl = document.getElementById('training-desc');
        if (descEl) descEl.innerHTML = `Distance: <strong style="color: #10b981;">${this.totalMiles.toFixed(2)} mi</strong>`;
        const floatDistEl = document.getElementById('floating-distance');
        if (floatDistEl) floatDistEl.textContent = this.totalMiles.toFixed(2);
    }
};

window.handleTrainingClick = function () {
    const btn = document.getElementById('training-action-btn');
    if (btn && btn.textContent.includes('Start')) WalkTracker.start();
    else WalkTracker.stopAndSave();
};

window.cancelTrainingWalk = function () {
    if (confirm("Are you sure you want to cancel your walk? You won't earn any points.")) WalkTracker.cancel();
};

function initTrainingUI() {
    ensureTrailLayerGroups();

    const btn = document.getElementById('training-action-btn');
    const cancelBtn = document.getElementById('cancel-training-btn');
    const descEl = document.getElementById('training-desc');
    if (!WalkTracker.watchId) {
        if (btn) { btn.textContent = 'Start Walk'; btn.className = 'glass-btn training-btn'; }
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (descEl) descEl.innerHTML = 'Start walking away from home. Log your turnaround point to calculate total distance and earn <strong style="color: #f59e0b;">+0.5 PTS</strong>.';
    } else {
        if (btn) { btn.textContent = 'Tracking Active 🟢'; btn.className = 'glass-btn training-btn active'; }
        if (cancelBtn) cancelBtn.style.display = 'block';
        if (descEl) descEl.innerHTML = `Distance: <strong style="color: #10b981;">${WalkTracker.totalMiles.toFixed(2)} mi</strong>`;
    }
}

window.BARK.initTrainingUI = initTrainingUI;
