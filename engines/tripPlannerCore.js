/**
 * tripPlannerCore.js — Trip Builder, Route Generation, Optimization, Map Visuals
 * Loaded NINTH in the boot sequence.
 */
window.BARK = window.BARK || {};

function removeTripMapLayer(layer) {
    const mapRef = window.map || (typeof map !== 'undefined' ? map : null);
    if (!layer || !mapRef || typeof mapRef.removeLayer !== 'function') return;

    try {
        mapRef.removeLayer(layer);
    } catch (error) {
        console.warn('[tripPlannerCore] failed to remove trip map layer:', error);
    }
}

function showTripToast(message) {
    let toast = window.BARK.DOM.tripActionToast();
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'trip-action-toast';
        toast.className = 'trip-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `✅ <span>${message}</span>`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
}

window.BARK.showTripToast = showTripToast;

// Trip overlay (badges, dashed day lines, A/B/🔄 bookends) is owned by
// modules/TripLayerManager.js. tripPlannerCore is the orchestrator: it mutates
// trip state and asks the overlay to sync. It never touches map DOM directly,
// and never appends badges to park marker icons (that path was the source of
// the cluster-recreate bug fixed in #19).
function updateTripMapVisuals() {
    const tripLayer = window.BARK.tripLayer;
    if (!tripLayer || typeof tripLayer.sync !== 'function') return;

    const tripDays = window.BARK.tripDays;
    const bookends = {
        start: window.tripStartNode || null,
        end: window.tripEndNode || null
    };

    // Restore the dashed day lines on every edit; generateAndRenderTripRoute()
    // explicitly hides them when it draws the real driving route.
    if (typeof tripLayer.setDayLinesVisible === 'function') {
        tripLayer.setDayLinesVisible(true);
    }

    const diff = tripLayer.sync(tripDays, bookends) || { added: new Set(), removed: new Set() };

    // Hand the diff to MarkerLayerManager so the park-pin--in-trip class flips
    // for stops that gained or lost trip status. tripLayer never touches park
    // marker DOM; markerManager owns that class.
    const markerManager = window.BARK.markerManager;
    if (markerManager && typeof markerManager.refreshTripStopClasses === 'function') {
        const affected = new Set();
        diff.added.forEach(id => affected.add(id));
        diff.removed.forEach(id => affected.add(id));
        if (affected.size > 0) markerManager.refreshTripStopClasses(affected);
    }
}

// ====== TRIP UI ======
// Future trip-place identity notes:
//   The current trip stop shape is intentionally minimal: id/name/lat/lng for
//   official parks, or name/lat/lng for custom towns/geocoded places. That is
//   enough for routing, rendering, and removing stops today, but it is not
//   enough for long-term personal memories.
//
//   When the app grows "personal cards" with notes/photos/reviews, do not store
//   that data directly inside tripDays[]. A trip route is an itinerary; user
//   memories are user-owned content. Keep these IDs separate:
//     - placeId: canonical official BARK place id, from allPoints/CSV.
//     - customPlaceId: stable id for a user-created/geocoded non-BARK place.
//     - tripStopId: unique id for this exact stop in this exact route.
//     - memoryId: user-owned notes/photos/reviews for a place or trip stop.
//
//   This separation answers the critical product questions:
//     - Official BARK spots keep official data immutable and shared.
//     - Personal notes/photos never mutate official park records.
//     - Trip planning data can be copied/shared without copying private media.
//     - A user can have a general park memory and a separate per-trip note.
//
//   Refactor target:
//     Replace lat/lng-derived fallback keys with generated tripStopId values,
//     then route all stop actions through a trip planner service/controller.
//     The map overlay should keep calling small APIs like removeTripStopByKey,
//     never mutate tripDays directly.
function getTotalStops() {
    return window.BARK.tripDays.reduce((sum, d) => sum + d.stops.length, 0);
}

function getTripStopKey(stop) {
    if (!stop) return '';
    return stop.id || `${stop.lat},${stop.lng}`;
}

function removeTripDay(dayIdx) {
    const tripDays = window.BARK.tripDays;
    if (!Array.isArray(tripDays) || tripDays.length <= 1) return;

    const day = tripDays[dayIdx];
    if (!day) return;

    if (day.stops && day.stops.length > 0) {
        const label = `Day ${dayIdx + 1}`;
        if (!confirm(`${label} has ${day.stops.length} stop${day.stops.length === 1 ? '' : 's'}. Delete this day?`)) return;
    }

    tripDays.splice(dayIdx, 1);
    if (window.BARK.activeDayIdx >= tripDays.length) {
        window.BARK.activeDayIdx = tripDays.length - 1;
    } else if (window.BARK.activeDayIdx > dayIdx) {
        window.BARK.activeDayIdx--;
    }
    updateTripUI();
}

window.BARK.removeTripStopByKey = function removeTripStopByKey(stopKey) {
    if (!stopKey) return false;

    const tripDays = window.BARK.tripDays;
    for (let dayIdx = 0; dayIdx < tripDays.length; dayIdx++) {
        const day = tripDays[dayIdx];
        const stopIdx = (day.stops || []).findIndex(stop => getTripStopKey(stop) === stopKey);
        if (stopIdx === -1) continue;

        const stop = day.stops[stopIdx];
        const name = stop && stop.name ? stop.name : 'this stop';
        if (!confirm(`Remove "${name}" from Day ${dayIdx + 1}?`)) return false;

        day.stops.splice(stopIdx, 1);
        updateTripUI();
        showTripToast('Stop removed.');
        return true;
    }

    return false;
};

window.addStopToTrip = function (stopData) {
    const tripDays = window.BARK.tripDays;
    let activeDayIdx = window.BARK.activeDayIdx;

    for (let i = 0; i < tripDays.length; i++) {
        if (tripDays[i].stops.find(s => s.lat === stopData.lat && s.lng === stopData.lng)) {
            alert(`This location is already in your trip on Day ${i + 1}!`);
            return false;
        }
    }

    if (tripDays[activeDayIdx].stops.length >= 10) {
        const lastStopOfCurrentDay = tripDays[activeDayIdx].stops[tripDays[activeDayIdx].stops.length - 1];
        if (activeDayIdx + 1 < tripDays.length) {
            window.BARK.activeDayIdx = ++activeDayIdx;
        } else {
            const nextColor = window.BARK.DAY_COLORS[tripDays.length % window.BARK.DAY_COLORS.length];
            tripDays.push({ color: nextColor, stops: [{ ...lastStopOfCurrentDay }], notes: "" });
            window.BARK.activeDayIdx = tripDays.length - 1;
            activeDayIdx = window.BARK.activeDayIdx;
        }
        showTripToast(`Day full! Auto-moved to Day ${activeDayIdx + 1} 🚐`);
    }

    tripDays[activeDayIdx].stops.push(stopData);
    updateTripUI();
    setTimeout(() => showTripToast(`Added to Day ${activeDayIdx + 1}!`), 50);
    return true;
};

window.autoSortDay = function () {
    const tripDays = window.BARK.tripDays;
    const activeDayIdx = window.BARK.activeDayIdx;
    const day = tripDays[activeDayIdx];
    if (day.stops.length <= 2) { alert('You need at least 3 stops to sort a route!'); return; }

    const sorted = [day.stops[0]];
    const unvisited = day.stops.slice(1);
    let currentStop = sorted[0];
    while (unvisited.length > 0) {
        let nearestIdx = 0, minDist = Infinity;
        for (let i = 0; i < unvisited.length; i++) {
            const dist = window.BARK.haversineDistance(currentStop.lat, currentStop.lng, unvisited[i].lat, unvisited[i].lng);
            if (dist < minDist) { minDist = dist; nearestIdx = i; }
        }
        currentStop = unvisited.splice(nearestIdx, 1)[0];
        sorted.push(currentStop);
    }
    tripDays[activeDayIdx].stops = sorted;
    updateTripUI();
    showTripToast('✨ Route Optimized!');
};

window.executeSmartOptimization = function () {
    const tripDays = window.BARK.tripDays;
    const userMaxStops = parseInt(window.BARK.DOM.optMaxStops().value) || 5;
    const userMaxHours = parseFloat(window.BARK.DOM.optMaxHours().value) || 4;
    const totalStops = tripDays.reduce((sum, d) => sum + d.stops.length, 0);
    if (totalStops < 2) { alert('Add at least two stops before optimizing!'); return; }

    let allUniqueStops = [];
    tripDays.forEach(day => {
        day.stops.forEach(stop => {
            if (allUniqueStops.length === 0) allUniqueStops.push(stop);
            else {
                const lastStop = allUniqueStops[allUniqueStops.length - 1];
                const isDuplicate = stop.id && lastStop.id ? stop.id === lastStop.id : (stop.lat === lastStop.lat && stop.lng === lastStop.lng);
                if (!isDuplicate) allUniqueStops.push(stop);
            }
        });
    });

    let sorted = [], unvisited = [...allUniqueStops], currentStop;
    if (window.tripStartNode) currentStop = window.tripStartNode;
    else { currentStop = unvisited.shift(); sorted.push(currentStop); }
    while (unvisited.length > 0) {
        let nearestIdx = 0, minDist = Infinity;
        for (let i = 0; i < unvisited.length; i++) {
            const dist = window.BARK.haversineDistance(currentStop.lat, currentStop.lng, unvisited[i].lat, unvisited[i].lng);
            if (dist < minDist) { minDist = dist; nearestIdx = i; }
        }
        currentStop = unvisited.splice(nearestIdx, 1)[0];
        sorted.push(currentStop);
    }

    let newTripDays = [], currentDayStops = [], currentDayHours = 0, dayColorIndex = 0;
    for (let i = 0; i < sorted.length; i++) {
        const stop = sorted[i];
        if (currentDayStops.length > 0) {
            const prev = currentDayStops[currentDayStops.length - 1];
            const distKm = window.BARK.haversineDistance(prev.lat, prev.lng, stop.lat, stop.lng);
            currentDayHours += (distKm * 0.621371) / 55;
        }
        currentDayStops.push(stop);
        const isLastStop = i === sorted.length - 1;
        if (isLastStop || currentDayStops.length >= userMaxStops || currentDayHours >= userMaxHours) {
            newTripDays.push({ color: window.BARK.DAY_COLORS[dayColorIndex % window.BARK.DAY_COLORS.length], stops: [...currentDayStops], notes: tripDays[dayColorIndex] ? tripDays[dayColorIndex].notes : "" });
            dayColorIndex++;
            if (!isLastStop) { currentDayStops = [{ ...stop }]; currentDayHours = 0; }
        }
    }

    window.BARK.tripDays = newTripDays;
    window.BARK.activeDayIdx = 0;
    window.BARK.DOM.optimizerModal().style.display = 'none';
    updateTripUI();
    showTripToast('✨ Smart Optimization Complete!');
};

window.exportDayToMaps = function (dayIdx) {
    const tripDays = window.BARK.tripDays;
    const day = tripDays[dayIdx];
    const waypoints = [];
    if (dayIdx === 0 && window.tripStartNode) waypoints.push(`${window.tripStartNode.lat},${window.tripStartNode.lng}`);
    if (dayIdx > 0 && tripDays[dayIdx - 1].stops.length > 0) {
        const prevLast = tripDays[dayIdx - 1].stops[tripDays[dayIdx - 1].stops.length - 1];
        waypoints.push(`${prevLast.lat},${prevLast.lng}`);
    }
    day.stops.forEach(stop => waypoints.push(`${stop.lat},${stop.lng}`));
    if (dayIdx === tripDays.length - 1 && window.tripEndNode) waypoints.push(`${window.tripEndNode.lat},${window.tripEndNode.lng}`);
    if (waypoints.length < 2) { alert('Not enough stops to generate a driving route for this day!'); return; }
    window.open(`https://www.google.com/maps/dir/${waypoints.join('/')}`, '_blank');
};

// ====== DAY MANAGEMENT ======
window.shiftDayLeft = function () {
    const tripDays = window.BARK.tripDays;
    let activeDayIdx = window.BARK.activeDayIdx;
    if (activeDayIdx === 0) return;
    const temp = tripDays[activeDayIdx - 1];
    tripDays[activeDayIdx - 1] = tripDays[activeDayIdx];
    tripDays[activeDayIdx] = temp;
    window.BARK.activeDayIdx--;
    updateTripUI(); updateTripMapVisuals();
};

window.shiftDayRight = function () {
    const tripDays = window.BARK.tripDays;
    let activeDayIdx = window.BARK.activeDayIdx;
    if (activeDayIdx === tripDays.length - 1) return;
    const temp = tripDays[activeDayIdx + 1];
    tripDays[activeDayIdx + 1] = tripDays[activeDayIdx];
    tripDays[activeDayIdx] = temp;
    window.BARK.activeDayIdx++;
    updateTripUI(); updateTripMapVisuals();
};

window.insertDayAfter = function () {
    const tripDays = window.BARK.tripDays;
    if (tripDays.length >= 5) return;
    const nextColor = window.BARK.DAY_COLORS[tripDays.length % window.BARK.DAY_COLORS.length];
    tripDays.splice(window.BARK.activeDayIdx + 1, 0, { color: nextColor, stops: [], notes: "" });
    window.BARK.activeDayIdx++;
    updateTripUI();
};

window.editBookend = function (type) {
    const el = type === 'start' ? window.BARK.DOM.uiStartNode() : window.BARK.DOM.uiEndNode();
    const currentName = type === 'start' ? (window.tripStartNode ? window.tripStartNode.name : '') : (window.tripEndNode ? window.tripEndNode.name : '');
    const color = type === 'start' ? '#22c55e' : '#ef4444';
    const bg = type === 'start' ? '#f0fdf4' : '#fef2f2';

    el.innerHTML = `
    <div style="background: ${bg}; border: 2px solid ${color}; border-radius: 12px; padding: 12px; margin-top: ${type === 'end' ? '15px' : '0'}; margin-bottom: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="font-size: 11px; font-weight: 900; color: ${color}; margin-bottom: 8px; text-transform: uppercase;">📍 Set Trip ${type}</div>
        <div style="display: flex; gap: 5px;">
            <input type="text" id="inline-${type}-input" value="${currentName}" placeholder="Search park, town, or 'My location'" style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); font-size: 13px; outline: none; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
            <button onclick="processInlineSearch('${type}')" class="glass-btn primary-btn" style="padding: 10px 15px; border-radius: 8px; font-size: 12px; font-weight: 800;">🔍</button>
            <button onclick="updateTripUI()" class="glass-btn" style="padding: 10px; border-radius: 8px; font-size: 12px; font-weight: 800; color: #666;">✕</button>
        </div>
        <div id="inline-suggest-${type}" style="display: none; background: white; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; margin-top: 8px; max-height: 200px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"></div>
        ${currentName ? `<div style="text-align:right; margin-top: 8px;"><button onclick="window.trip${type === 'start' ? 'Start' : 'End'}Node=null; updateTripUI()" style="background: transparent; color: #dc2626; border: none; font-size: 11px; font-weight: 800; cursor: pointer; text-decoration: underline;">Remove ${type.toUpperCase()}</button></div>` : ''}
    </div>`;

    const inlineInput = window.BARK.DOM.inlineInput(type);
    if (inlineInput) {
        let inlineSearchTimer = null;

        setTimeout(() => {
            inlineInput.focus();
            inlineInput.select();
        }, 50);

        inlineInput.addEventListener('input', () => {
            clearTimeout(inlineSearchTimer);
            inlineSearchTimer = setTimeout(() => {
                if (window.BARK.runInlinePlannerSearch) {
                    window.BARK.runInlinePlannerSearch(type, { executeGlobal: false });
                }
            }, 250);
        });

        inlineInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                window.processInlineSearch(type);
            } else if (e.key === 'Escape') {
                if (window.BARK.hideInlinePlannerSuggestions) {
                    window.BARK.hideInlinePlannerSuggestions(type);
                }
                inlineInput.blur();
            }
        });

        inlineInput.addEventListener('blur', () => {
            clearTimeout(inlineSearchTimer);
            const suggestBox = window.BARK.DOM.inlineSuggest(type);
            if (suggestBox && suggestBox.contains(document.activeElement)) return;

            if (window.BARK.hideInlinePlannerSuggestions) {
                window.BARK.hideInlinePlannerSuggestions(type);
            } else if (suggestBox) {
                suggestBox.style.display = 'none';
            }
        });
    }
};

function updateTripUI() {
    const tripDays = window.BARK.tripDays;
    let activeDayIdx = window.BARK.activeDayIdx;
    const plannerBadge = window.BARK.DOM.plannerBadge();
    const list = window.BARK.DOM.tripQueueList();
    if (!list) return;

    const total = getTotalStops();
    if (plannerBadge) {
        if (total > 0) { plannerBadge.style.display = 'block'; plannerBadge.textContent = total; }
        else { plannerBadge.style.display = 'none'; }
    }

    let tabContainer = window.BARK.DOM.tripDayTabs();
    if (!tabContainer && list.parentElement) {
        tabContainer = document.createElement('div');
        tabContainer.id = 'trip-day-tabs';
        tabContainer.style.cssText = 'display:flex; gap:6px; flex-wrap: wrap; margin-bottom:14px; align-items:center;';
        list.parentElement.insertBefore(tabContainer, list);
    }
    if (tabContainer) tabContainer.innerHTML = '';

    // START BOOKEND
    let startEl = window.BARK.DOM.uiStartNode();
    if (!startEl && tabContainer && tabContainer.parentElement) {
        startEl = document.createElement('div');
        startEl.id = 'ui-start-node';
        tabContainer.parentElement.insertBefore(startEl, tabContainer);
    }

    if (startEl && window.tripStartNode) {
        startEl.innerHTML = `<div onclick="editBookend('start')" class="trip-node-card" style="background: #f0fdf4; cursor: pointer; padding: 10px; margin-bottom: 10px; border-radius: 8px;"><div style="display: flex; align-items: center; gap: 10px;"><span style="background: #22c55e; color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; justify-content: center; align-items: center; font-size: 11px; font-weight: 800;">A</span><div><div class="planner-metadata" style="color: #15803d; font-size: 10px;">Trip Start</div><div style="font-weight: 700; color: #333; font-size: 13px;">${window.tripStartNode.name}</div></div></div><div class="planner-metadata" style="opacity: 0.6; font-size: 10px;">Edit</div></div>`;
    } else if (startEl) {
        startEl.innerHTML = `<button onclick="editBookend('start')" class="glass-btn" style="width: 100%; height: 36px; background: #fff; border: 1px dashed #22c55e; color: #15803d; font-weight: 800; font-size: 11px; margin-bottom: 10px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px;"><span>➕</span> SET TRIP START</button>`;
    }

    // DAY TABS
    tripDays.forEach((day, di) => {
        const tab = document.createElement('div');
        tab.style.cssText = `display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:13px; font-weight:600; border: 2px solid ${di === activeDayIdx ? day.color : '#ddd'}; background:${di === activeDayIdx ? day.color : '#f5f5f5'}; color:${di === activeDayIdx ? 'white' : '#555'}; transition: all 0.2s;`;

        const swatch = document.createElement('input');
        swatch.type = 'color'; swatch.value = day.color; swatch.title = 'Change day color';
        swatch.style.cssText = 'width:14px; height:14px; border:none; padding:0; background:none; cursor:pointer; border-radius:50%; outline:none;';
        swatch.onclick = (e) => e.stopPropagation();
        swatch.oninput = (e) => { tripDays[di].color = e.target.value; updateTripUI(); };

        const label = document.createElement('span');
        label.textContent = `Day ${di + 1} (${day.stops.length})`;
        tab.appendChild(swatch); tab.appendChild(label);

        if (tripDays.length > 1 && (window.isTripEditMode || day.stops.length === 0)) {
            const delBtn = document.createElement('span');
            delBtn.textContent = '×'; delBtn.title = 'Remove day';
            delBtn.style.cssText = 'font-size:14px; cursor:pointer; margin-left:2px; line-height:1; padding:1px 3px; border-radius:999px;';
            delBtn.onclick = (e) => { e.stopPropagation(); removeTripDay(di); };
            tab.appendChild(delBtn);
        }
        tab.onclick = () => { window.BARK.activeDayIdx = di; updateTripUI(); };
        tabContainer.appendChild(tab);
    });

    // Add Day button
    const addDayBtn = document.createElement('button');
    addDayBtn.textContent = '+ Add Day';
    addDayBtn.style.cssText = 'padding:6px 12px; border-radius:20px; border:2px dashed #bbb; background:none; color:#888; font-size:13px; font-weight:600; cursor:pointer;';
    addDayBtn.onclick = () => {
        const prevDay = tripDays[tripDays.length - 1];
        const initialStops = [];
        if (prevDay && prevDay.stops.length > 0) initialStops.push({ ...prevDay.stops[prevDay.stops.length - 1] });
        tripDays.push({ color: window.BARK.DAY_COLORS[tripDays.length % window.BARK.DAY_COLORS.length], stops: initialStops, notes: "" });
        window.BARK.activeDayIdx = tripDays.length - 1;
        updateTripUI();
    };
    tabContainer.appendChild(addDayBtn);

    // Day management bar
    let dayManager = window.BARK.DOM.dayManagementBar();
    if (!dayManager) { dayManager = document.createElement('div'); dayManager.id = 'day-management-bar'; list.parentElement.insertBefore(dayManager, list); }
    if (window.isTripEditMode) {
        dayManager.innerHTML = `<div style="display: flex; gap: 8px; margin-bottom: 10px; padding: 8px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;"><button onclick="window.shiftDayLeft()" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 6px; color: #475569; border: 1px solid #cbd5e1; background: white;" ${activeDayIdx === 0 ? 'disabled' : ''}>← Shift Day</button><button onclick="window.insertDayAfter()" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 6px; color: #15803d; border: 1px solid #bbf7d0; background: #f0fdf4;">+ Insert Day</button><button onclick="window.shiftDayRight()" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 6px; color: #475569; border: 1px solid #cbd5e1; background: white;" ${activeDayIdx === tripDays.length - 1 ? 'disabled' : ''}>Shift Day →</button></div>`;
        dayManager.style.display = 'block';
    } else { dayManager.style.display = 'none'; }

    // Render stops
    const activeDay = tripDays[activeDayIdx];
    if (typeof window.isTripEditMode === 'undefined') window.isTripEditMode = false;
    window.toggleTripEditMode = () => { window.isTripEditMode = !window.isTripEditMode; updateTripUI(); };

    list.innerHTML = '';

    if (activeDay.stops.length > 0) {
        const actionBar = document.createElement('div');
        actionBar.style.cssText = 'display: flex; justify-content: flex-end; align-items: center; margin-bottom: 12px; padding: 0 4px;';
        actionBar.innerHTML = `<button onclick="toggleTripEditMode()" class="glass-btn" style="background: ${window.isTripEditMode ? '#e8f5e9' : '#f8fafc'}; border: 1px solid ${window.isTripEditMode ? '#4CAF50' : '#cbd5e1'}; color: ${window.isTripEditMode ? '#2E7D32' : '#64748b'}; font-size: 11px; font-weight: 800; padding: 6px 16px; border-radius: 8px; cursor: pointer; transition: all 0.2s;">${window.isTripEditMode ? '✅ Done Editing' : '✏️ Edit Stops & Days'}</button>`;
        list.appendChild(actionBar);
    }

    if (activeDay.stops.length === 0) {
        const empty = document.createElement('li');
        empty.style.cssText = 'color:#aaa; font-size:13px; text-align:center; padding:18px 0;';
        empty.textContent = 'No stops yet. Add parks or a town above!';
        list.appendChild(empty);
    }

    activeDay.stops.forEach((stop, index) => {
        const li = document.createElement('li');
        li.className = 'stop-list-item';
        let controlsHtml = '';
        if (window.isTripEditMode) {
            const moveToDayOptions = tripDays.map((d, di) => di !== activeDayIdx ? `<option value="${di}">Day ${di + 1}</option>` : '').join('');
            const moveSelect = moveToDayOptions ? `<select class="move-to-day-select" data-index="${index}" style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px; background: white; font-size: 11px; cursor:pointer; color:#475569; outline:none; font-weight:600;"><option value="">↳ Move</option>${moveToDayOptions}</select>` : '';
            controlsHtml = `<div style="display: flex; gap: 6px; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(0,0,0,0.05); width: 100%;">${moveSelect}<div style="flex: 1;"></div><button class="move-up-btn" data-index="${index}" style="background:#f1f5f9; border:none; border-radius:6px; cursor:pointer; font-size:14px; color:#475569; padding:4px 10px; ${index === 0 ? 'visibility:hidden;' : ''}" title="Move Up">↑</button><button class="move-down-btn" data-index="${index}" style="background:#f1f5f9; border:none; border-radius:6px; cursor:pointer; font-size:14px; color:#475569; padding:4px 10px; ${index === activeDay.stops.length - 1 ? 'visibility:hidden;' : ''}" title="Move Down">↓</button><button class="remove-stop-btn" data-index="${index}" style="background:#fee2e2; border:none; border-radius:6px; color:#ef4444; font-weight:900; font-size:12px; cursor:pointer; padding:6px 12px; margin-left: 4px;" title="Remove">✕</button></div>`;
        }
        li.innerHTML = `<div style="display: flex; flex-direction: column; width: 100%; padding: ${window.isTripEditMode ? '8px' : '12px 4px'}; background: ${window.isTripEditMode ? '#f8fafc' : 'transparent'}; border-radius: 10px; border: ${window.isTripEditMode ? '1px solid #e2e8f0' : '1px solid transparent'}; transition: all 0.2s;"><div style="display: flex; align-items: center; width: 100%;"><span style="background:${activeDay.color}; color:white; border-radius: 6px; width: 24px; height: 24px; min-width: 24px; display: inline-flex; justify-content: center; align-items: center; font-size: 12px; font-weight:900; margin-right: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${index + 1}</span><span style="font-weight: 700; color: #1e293b; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;" title="${stop.name}">${stop.name}</span></div>${controlsHtml}</div>`;
        list.appendChild(li);
    });

    // Ghost button
    const ghostBtn = document.createElement('div');
    ghostBtn.style.cssText = `margin: 10px 4px; padding: 12px; border: 2px dashed #e2e8f0; border-radius: 10px; color: #94a3b8; font-size: 12px; font-weight: 800; text-align: center; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.5px;`;
    ghostBtn.innerHTML = `➕ Add Stop to Day ${activeDayIdx + 1}`;
    ghostBtn.onmouseover = () => { ghostBtn.style.borderColor = activeDay.color; ghostBtn.style.color = activeDay.color; };
    ghostBtn.onmouseout = () => { ghostBtn.style.borderColor = '#e2e8f0'; ghostBtn.style.color = '#94a3b8'; };
    ghostBtn.onclick = () => { const gs = window.BARK.DOM.parkSearch(); if (gs) { gs.focus(); gs.scrollIntoView({ behavior: 'smooth', block: 'center' }); gs.style.boxShadow = `0 0 0 4px ${activeDay.color}44`; setTimeout(() => gs.style.boxShadow = '', 1500); document.querySelector('[data-target="map-view"]')?.click(); } };
    list.appendChild(ghostBtn);

    // Notes
    const notesContainer = window.BARK.DOM.dayNotesContainer();
    if (notesContainer) {
        notesContainer.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;"><label style="font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin:0;">📋 Day ${activeDayIdx + 1} Notes</label><button onclick="exportDayToMaps(${activeDayIdx})" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; font-size:10px; font-weight:800; padding:4px 8px; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.2s;" onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">🗺️ Drive Day ${activeDayIdx + 1}</button></div><textarea id="day-notes-textarea" placeholder="Hiking trails, confirmation #s, lunch spots..." style="width:100%; height:60px; padding:10px; border-radius:8px; border:none; background:#f8fafc; font-size:13px; outline:none; resize:none; font-family:inherit; color:#334155; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);" onfocus="this.style.boxShadow='inset 0 0 0 2px ${activeDay.color}'" onblur="this.style.boxShadow='inset 0 2px 4px rgba(0,0,0,0.02)'">${activeDay.notes || ""}</textarea><div style="text-align:right; font-size:10px; color:#cbd5e1; margin-top:4px;"><span id="char-count">${(activeDay.notes || "").length}</span> / 1000</div>`;
        const textarea = window.BARK.DOM.dayNotesTextarea();
        const charCount = window.BARK.DOM.charCount();
        textarea.oninput = (e) => { let val = e.target.value; if (val.length > 1000) { val = val.substring(0, 1000); e.target.value = val; } activeDay.notes = val; charCount.textContent = val.length; };
    }

    // Wire up buttons
    document.querySelectorAll('.remove-stop-btn').forEach(btn => { btn.onclick = (e) => { tripDays[activeDayIdx].stops.splice(parseInt(e.currentTarget.getAttribute('data-index')), 1); updateTripUI(); }; });
    document.querySelectorAll('.move-up-btn').forEach(btn => { btn.onclick = (e) => { const idx = parseInt(e.currentTarget.getAttribute('data-index')); if (idx > 0) { const stops = tripDays[activeDayIdx].stops; [stops[idx], stops[idx - 1]] = [stops[idx - 1], stops[idx]]; updateTripUI(); } }; });
    document.querySelectorAll('.move-down-btn').forEach(btn => { btn.onclick = (e) => { const idx = parseInt(e.currentTarget.getAttribute('data-index')); const stops = tripDays[activeDayIdx].stops; if (idx < stops.length - 1) { [stops[idx], stops[idx + 1]] = [stops[idx + 1], stops[idx]]; updateTripUI(); } }; });
    document.querySelectorAll('.move-to-day-select').forEach(sel => { sel.onchange = (e) => { const fromIdx = parseInt(e.currentTarget.getAttribute('data-index')); const toDayIdx = parseInt(e.target.value); if (isNaN(toDayIdx)) return; const stop = tripDays[activeDayIdx].stops.splice(fromIdx, 1)[0]; tripDays[toDayIdx].stops.push(stop); updateTripUI(); }; });

    // END BOOKEND
    let endEl = window.BARK.DOM.uiEndNode();
    if (!endEl) { const wrapper = window.BARK.DOM.itineraryTimelineWrapper(); if (wrapper) { endEl = document.createElement('div'); endEl.id = 'ui-end-node'; wrapper.appendChild(endEl); } }
    if (endEl && window.tripEndNode) {
        endEl.innerHTML = `<div onclick="editBookend('end')" style="cursor:pointer; background: #fef2f2; border: 2px solid #ef4444; border-radius: 8px; padding: 10px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 6px rgba(239,68,68,0.05);"><div style="font-size: 13px; font-weight: 900; color: #b91c1c; display: flex; align-items: center; gap: 8px;"><span style="background: #ef4444; color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; justify-content: center; align-items: center; font-size: 11px;">B</span> TRIP END: <span style="font-weight:600; color:#333; margin-left: 4px;">${window.tripEndNode.name}</span></div><div style="font-size:10px; color:#ef4444; font-weight:800; text-transform:uppercase;">Edit</div></div>`;
    } else if (endEl) {
        endEl.innerHTML = `<button onclick="editBookend('end')" style="width:100%; cursor:pointer; background: #fff; border: 1px dashed #ef4444; color:#b91c1c; border-radius: 8px; padding: 10px; margin-top: 10px; font-weight:800; text-transform:uppercase; font-size:11px;">+ Set Trip End</button>`;
    }

    try { updateTripMapVisuals(); } catch (e) { console.error("Map visuals update failed:", e); }
}

window.BARK.updateTripUI = updateTripUI;

// ====== INIT TRIP PLANNER ======
function initTripPlanner() {
    const clearTripBtn = window.BARK.DOM.clearTripBtn();
    const startRouteBtn = window.BARK.DOM.startRouteBtn();
    const saveRouteBtn = window.BARK.DOM.saveRouteBtn();
    const optimizeTripBtn = window.BARK.DOM.optimizeTripBtn();
    let currentRouteLayers = [];
    let routeRenderGeneration = 0;

    function setPlannerActionButtonLabel(button, label, icon = '') {
        if (!button) return;
        const iconMarkup = icon ? `<span class="planner-action-icon">${icon}</span>` : '';
        button.innerHTML = `${iconMarkup}<span>${label}</span>`;
    }

    function resetTripPlannerRuntime(options = {}) {
        const resetName = options.resetName !== false;

        window.BARK.tripDays = [{ color: window.BARK.DAY_COLORS[0], stops: [], notes: "" }];
        window.BARK.activeDayIdx = 0;
        window.tripStartNode = null;
        window.tripEndNode = null;
        window.isTripEditMode = false;
        routeRenderGeneration++;

        currentRouteLayers.forEach(removeTripMapLayer);
        currentRouteLayers = [];
        if (window.BARK.tripLayer && typeof window.BARK.tripLayer.clear === 'function') {
            const diff = window.BARK.tripLayer.clear() || { added: new Set(), removed: new Set() };
            const markerManager = window.BARK.markerManager;
            if (markerManager && typeof markerManager.refreshTripStopClasses === 'function' && diff.removed.size > 0) {
                markerManager.refreshTripStopClasses(diff.removed);
            }
        }

        if (resetName) {
            const nameInput = window.BARK.DOM.tripNameInput();
            if (nameInput) nameInput.value = '';
        }

        const telemetryEl = window.BARK.DOM.routeTelemetry();
        if (telemetryEl) {
            telemetryEl.style.display = 'none';
            telemetryEl.innerHTML = '';
        }

        document.querySelectorAll('[id^="inline-suggest-"]').forEach(el => {
            el.style.display = 'none';
            el.innerHTML = '';
        });

        updateTripUI();
    }

    window.BARK.resetTripPlannerRuntime = resetTripPlannerRuntime;

    if (optimizeTripBtn) {
        optimizeTripBtn.onclick = () => { window.BARK.DOM.optimizerModal().style.display = 'flex'; };
    }

    if (clearTripBtn) {
        clearTripBtn.onclick = () => {
            if (getTotalStops() > 0 || window.tripStartNode || window.tripEndNode) {
                if (!confirm("Are you sure you want to clear your trip?")) return;
            }
            resetTripPlannerRuntime();
        };
    }

    if (saveRouteBtn) {
        saveRouteBtn.onclick = async () => {
            setPlannerActionButtonLabel(saveRouteBtn, 'Saving...');
            saveRouteBtn.disabled = true;
            const saved = await saveCurrentTrip();
            setPlannerActionButtonLabel(saveRouteBtn, 'Save', '💾');
            saveRouteBtn.disabled = false;
            if (saved) alert('✅ Trip saved! Check Profile → Saved Routes.');
        };
    }

    if (startRouteBtn) {
        startRouteBtn.onclick = () => { if (getTotalStops() === 0) return; generateAndRenderTripRoute(); };
    }

    async function saveCurrentTrip() {
        const user = (typeof firebase !== 'undefined') ? firebase.auth().currentUser : null;
        if (!user) { alert('Please sign in to save routes.'); return false; }
        window.BARK.incrementRequestCount();
        if (getTotalStops() === 0) { alert('Nothing to save — add some stops first!'); return false; }
        const nameInput = window.BARK.DOM.tripNameInput();
        const tripName = nameInput ? nameInput.value.trim() : "";
        if (!tripName) { alert('Please enter a name for your trip.'); if (nameInput) nameInput.focus(); return false; }
        try {
            const tripDays = window.BARK.tripDays;
            const routeData = {
                tripName: tripName,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                tripDays: tripDays.map(d => ({ color: d.color, stops: d.stops.map(s => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })), notes: d.notes || "" }))
            };
            await firebase.firestore().collection('users').doc(user.uid).collection('savedRoutes').add(routeData);
            window.BARK.loadSavedRoutes(user.uid);
            return true;
        } catch (err) { console.error('Save failed:', err); alert('Could not save route: ' + err.message); return false; }
    }

    async function generateAndRenderTripRoute() {
        const user = (typeof firebase !== 'undefined') ? firebase.auth().currentUser : null;
        if (!user) { alert("Please sign in to generate routes."); return; }
        const routeRunId = ++routeRenderGeneration;
        window.BARK.incrementRequestCount();
        const tripDays = window.BARK.tripDays;
        const daysWithStops = tripDays.filter(d => d.stops.length >= 2);
        if (daysWithStops.length === 0) { alert("Each day needs at least 2 stops."); return; }

        currentRouteLayers.forEach(removeTripMapLayer); currentRouteLayers = [];
        // Hide the dashed day lines while the generated driving route is on the map.
        // Badges and bookends stay visible so the user keeps stop ordering context.
        if (window.BARK.tripLayer && typeof window.BARK.tripLayer.setDayLinesVisible === 'function') {
            window.BARK.tripLayer.setDayLinesVisible(false);
        }

        if (startRouteBtn) {
            setPlannerActionButtonLabel(startRouteBtn, 'Calculating...');
            startRouteBtn.disabled = true;
        }

        const allBounds = [];
        let anySucceeded = false, totalDistMeters = 0, totalDurSeconds = 0;

        for (let i = 0; i < daysWithStops.length; i++) {
            const day = daysWithStops[i];
            let dayStops = [...day.stops];
            if (i === 0 && window.tripStartNode) dayStops.unshift(window.tripStartNode);
            if (i === daysWithStops.length - 1 && window.tripEndNode) dayStops.push(window.tripEndNode);

            try {
                const orsCoordinates = dayStops.map(s => [Number(s.lng), Number(s.lat)]);
                const geoJSONData = await window.BARK.services.ors.directions(orsCoordinates, { radiuses: new Array(orsCoordinates.length).fill(-1) });
                const stillSignedIn = typeof firebase !== 'undefined' && firebase.auth().currentUser;
                if (routeRunId !== routeRenderGeneration || !stillSignedIn) break;
                const layer = L.geoJSON(geoJSONData, { style: () => ({ color: day.color, weight: 5, opacity: 0.85, dashArray: '10, 8' }) }).addTo(map);
                currentRouteLayers.push(layer); allBounds.push(layer.getBounds()); anySucceeded = true;
                const summary = geoJSONData.features[0].properties.summary;
                if (summary) { totalDistMeters += summary.distance; totalDurSeconds += summary.duration; }
            } catch (err) { console.error(`Route failed for day (${day.color}):`, err); alert(`A day's route failed: ${err.message}`); }
        }

        if (allBounds.length > 0) {
            const combined = allBounds.reduce((acc, b) => acc.extend(b), allBounds[0]);
            map.fitBounds(combined, { padding: [50, 50], animate: !window.instantNav, duration: window.instantNav ? 0 : 0.5 });
        }

        const telemetryEl = window.BARK.DOM.routeTelemetry();
        if (telemetryEl) {
            if (anySucceeded) {
                const miles = (totalDistMeters * 0.000621371).toFixed(1);
                const hrs = Math.floor(totalDurSeconds / 3600);
                const mins = Math.floor((totalDurSeconds % 3600) / 60);
                telemetryEl.style.display = 'block';
                telemetryEl.innerHTML = `<span style="font-weight: 700; color: #1976D2;">Total Drive:</span> ${miles} Miles | ${hrs}h ${mins}m`;
            } else { telemetryEl.style.display = 'none'; }
        }

        if (anySucceeded) document.querySelector('[data-target="map-view"]')?.click();
        if (startRouteBtn) {
            setPlannerActionButtonLabel(startRouteBtn, 'Generate Route');
            startRouteBtn.disabled = false;
        }
    }
}

window.BARK.initTripPlanner = initTripPlanner;
