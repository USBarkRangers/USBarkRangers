/**
 * routeRenderer.js - Saved route list rendering and controller glue.
 */
window.BARK = window.BARK || {};
window.BARK.renderers = window.BARK.renderers || {};

let savedRoutesCursor = null;
let savedRoutesCount = 0;

function getRouteDate(route) {
    return route.createdAt ? new Date(route.createdAt.seconds * 1000).toLocaleDateString() : 'Unknown date';
}

function renderRoutesList(routes, containerElement, callbacks = {}) {
    if (!containerElement) return;

    if (!callbacks.append) containerElement.innerHTML = '';

    if (routes.length === 0 && !callbacks.append) {
        containerElement.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">No saved routes yet. Generate a route to save it here!</p>';
        return;
    }

    routes.forEach(route => {
        const date = getRouteDate(route);
        const dayCount = route.tripDays ? route.tripDays.length : 0;
        const stopCount = route.tripDays ? route.tripDays.reduce((s, d) => s + (d.stops ? d.stops.length : 0), 0) : 0;
        const colorDots = (route.tripDays || []).map(d =>
            `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${d.color || '#999'}; margin-right:2px;"></span>`
        ).join('');
        const tripName = route.tripName || "Untitled Route";

        const card = document.createElement('div');
        card.style.cssText = 'background:#f9f9f9; border-radius:10px; padding:10px 12px; margin-bottom:8px; border:1px solid rgba(0,0,0,0.06);';
        card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
                        <div>
                            <div style="font-weight:800; font-size:14px; color:#1a1a1a; margin-bottom:2px;">${tripName}</div>
                            <div style="font-weight:600; font-size:12px; color:#555; margin-bottom:4px;">${colorDots} ${dayCount} day${dayCount !== 1 ? 's' : ''} · ${stopCount} stop${stopCount !== 1 ? 's' : ''}</div>
                            <div style="font-size:11px; color:#888;">${date}</div>
                        </div>
                        <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
                            <button class="load-route-btn" data-id="${route.id}" style="background:#22c55e; color:white; border:none; border-radius:8px; padding:5px 10px; font-size:12px; cursor:pointer; font-weight:600;">Load</button>
                            <button class="delete-route-btn" data-id="${route.id}" style="background:none; border:none; color:#dc2626; font-size:14px; cursor:pointer; font-weight:bold;" title="Delete">×</button>
                        </div>
                    </div>
                `;
        containerElement.appendChild(card);
    });

    containerElement.querySelectorAll('.load-route-btn').forEach(btn => {
        btn.onclick = () => callbacks.onLoadRoute && callbacks.onLoadRoute(btn.getAttribute('data-id'));
    });

    containerElement.querySelectorAll('.delete-route-btn').forEach(btn => {
        btn.onclick = () => callbacks.onDeleteRoute && callbacks.onDeleteRoute(btn.getAttribute('data-id'));
    });

    if (callbacks.hasMore) {
        const loadMoreBtn = document.createElement('button');
        loadMoreBtn.className = 'load-more-routes-btn';
        loadMoreBtn.textContent = 'Load More (+5)';
        loadMoreBtn.style.cssText = 'width: 100%; background: rgba(0,0,0,0.05); border: 1px dashed rgba(0,0,0,0.2); border-radius: 8px; padding: 10px; font-size: 13px; cursor: pointer; color: #555; font-weight: 700; margin-top: 5px;';
        loadMoreBtn.onclick = () => callbacks.onLoadMore && callbacks.onLoadMore();
        containerElement.appendChild(loadMoreBtn);
    }
}

function renderRoutesMessage(message) {
    const savedList = document.getElementById('saved-routes-list');
    const plannerList = document.getElementById('planner-saved-routes-list');
    const html = `<p style="color:#aaa; text-align:center; padding:10px 0;">${message}</p>`;
    if (savedList) savedList.innerHTML = html;
    if (plannerList) plannerList.innerHTML = html;
}

async function loadRouteIntoPlanner(uid, routeId) {
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    if (!firebaseService || typeof firebaseService.loadSavedRoute !== 'function') return;

    try {
        const data = await firebaseService.loadSavedRoute(uid, routeId);
        if (!data) return;

        window.BARK.tripDays = (data.tripDays || []).map(d => ({ color: d.color, stops: d.stops, notes: d.notes || "" }));
        window.BARK.activeDayIdx = 0;

        const tripNameInput = document.getElementById('tripNameInput');
        if (tripNameInput) tripNameInput.value = data.tripName || "";

        if (typeof window.BARK.updateTripUI === 'function') window.BARK.updateTripUI();

        const plannerContainer = document.getElementById('planner-saved-routes-container');
        if (plannerContainer) plannerContainer.style.display = 'none';

        document.querySelector('[data-target="map-view"]')?.click();
        if (typeof window.BARK.showTripToast === 'function') window.BARK.showTripToast(`Route Loaded: ${data.tripName || "Untitled"}`);
    } catch (error) {
        console.error("[routeRenderer] load saved route failed:", error);
    }
}

async function deleteRouteAndRefresh(uid, routeId) {
    if (!confirm('Delete this saved route?')) return;

    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    if (!firebaseService || typeof firebaseService.deleteSavedRoute !== 'function') return;

    try {
        await firebaseService.deleteSavedRoute(uid, routeId);
        await loadSavedRoutes(uid);
    } catch (error) {
        console.error("[routeRenderer] delete saved route failed:", error);
    }
}

async function loadSavedRoutes(uid, isLoadMore = false) {
    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    const savedList = document.getElementById('saved-routes-list');
    const plannerList = document.getElementById('planner-saved-routes-list');
    const savedCount = document.getElementById('saved-routes-count');

    if (!firebaseService || typeof firebaseService.loadSavedRoutes !== 'function') return;
    if (!savedList && !plannerList) return;

    if (!isLoadMore) {
        savedRoutesCursor = null;
        savedRoutesCount = 0;
        renderRoutesMessage('Loading...');
    } else {
        document.querySelectorAll('.load-more-routes-btn').forEach(btn => btn.remove());
    }

    try {
        const fetchLimit = isLoadMore ? 5 : 3;
        const payload = await firebaseService.loadSavedRoutes(uid, isLoadMore ? savedRoutesCursor : null, fetchLimit);
        const routes = payload.routes || [];
        savedRoutesCursor = payload.nextCursor;
        savedRoutesCount = isLoadMore ? savedRoutesCount + routes.length : routes.length;

        if (savedCount) {
            savedCount.textContent = payload.hasMore ? `${savedRoutesCount}+` : savedRoutesCount;
        }

        const callbacks = {
            append: isLoadMore,
            hasMore: payload.hasMore,
            onLoadRoute: routeId => loadRouteIntoPlanner(uid, routeId),
            onDeleteRoute: routeId => deleteRouteAndRefresh(uid, routeId),
            onLoadMore: () => loadSavedRoutes(uid, true)
        };

        renderRoutesList(routes, savedList, callbacks);
        renderRoutesList(routes, plannerList, callbacks);
    } catch (error) {
        console.error("[routeRenderer] load saved routes failed:", error);
    }
}

function togglePlannerRoutes() {
    const container = document.getElementById('planner-saved-routes-container');
    if (!container) return;

    if (container.style.display === 'none') {
        container.style.display = 'block';
        const firebaseService = window.BARK.services && window.BARK.services.firebase;
        const user = firebaseService && typeof firebaseService.getCurrentUser === 'function'
            ? firebaseService.getCurrentUser()
            : null;
        if (user) {
            loadSavedRoutes(user.uid);
        } else {
            const list = document.getElementById('planner-saved-routes-list');
            if (list) list.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">Please log in to see saved routes.</p>';
        }
    } else {
        container.style.display = 'none';
    }
}

window.BARK.renderers.routes = { renderRoutesList };
window.BARK.renderRoutesList = renderRoutesList;
window.BARK.loadSavedRoutes = loadSavedRoutes;
window.togglePlannerRoutes = togglePlannerRoutes;
