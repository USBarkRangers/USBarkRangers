const APP_VERSION = 16;

// ====== iOS SAFARI MAGNIFIER & SELECTION HACK ======
// Prevent the long-press and double-tap-and-hold magnifying glass (loupe)
document.addEventListener('contextmenu', function(e) {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
    }
});

let lastTouchTime = 0;
document.addEventListener('touchstart', function(e) {
    const time = new Date().getTime();
    const timeSince = time - lastTouchTime;
    // Intercept the second tap of a double tap (which can lead to a magnifying glass if held)
    if (timeSince < 300 && timeSince > 0) {
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.isContentEditable) {
            e.preventDefault(); 
        }
    }
    lastTouchTime = time;
}, { passive: false });


// ====== SAFETY & COST CONTROLS ======
let globalRequestCounter = 0;
const SESSION_MAX_REQUESTS = 10000; // Auto-shutdown background activity if hit

function incrementRequestCount() {
    globalRequestCounter++;
    if (globalRequestCounter > SESSION_MAX_REQUESTS) {
        console.error("CRITICAL: Session request limit reached. Background sync disabled.");
        throw new Error("Safety Shutdown: API limit reached for this session.");
    }
}

window.attemptDailyStreakIncrement = async function () {
    if (typeof firebase === 'undefined' || !firebase.auth().currentUser) return { success: false, message: "Not logged in" };

    const user = firebase.auth().currentUser;
    const today = new Date().toISOString().split('T')[0];

    const docRef = firebase.firestore().collection('users').doc(user.uid);
    const doc = await docRef.get();
    const data = doc.exists ? doc.data() : {};

    const lastStreakDate = data.lastStreakDate || localStorage.getItem('lastStreakDate');
    if (lastStreakDate === today) return { success: false, message: "Already incremented today" };

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    let currentStreak = parseInt(data.streakCount || localStorage.getItem('streakCount') || 0);

    if (lastStreakDate === yesterdayStr) {
        currentStreak += 1;
    } else {
        currentStreak = 1;
    }

    incrementRequestCount();
    await docRef.set({
        streakCount: currentStreak,
        lastStreakDate: today
    }, { merge: true });

    localStorage.setItem('lastStreakDate', today);
    localStorage.setItem('streakCount', currentStreak);

    const streakLabel = document.getElementById('streak-count-label');
    if (streakLabel) streakLabel.textContent = currentStreak;

    return { success: true, count: currentStreak };
};

// ====== iOS KEYBOARD LAYOUT FIX ======
// iOS Safari resizes the visual viewport when the keyboard opens,
// but position:fixed elements (like the nav bar) don't move with it.
// This causes the nav bar to float over or under the screen.
(function () {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    // Method 1: visualViewport resize detection (most reliable)
    if (window.visualViewport) {
        let initialHeight = window.visualViewport.height;
        window.visualViewport.addEventListener('resize', () => {
            const currentHeight = window.visualViewport.height;
            // If viewport shrunk significantly, keyboard is likely open.
            // Using 25% of height as a more robust threshold than a fixed pixel value.
            if (initialHeight - currentHeight > window.screen.height * 0.2) {
                document.body.classList.add('keyboard-open');
                if (window.innerWidth < 768 && slidePanel) {
                    slidePanel.classList.remove('open');
                }
            } else {
                document.body.classList.remove('keyboard-open');
            }
        });
        // Update baseline on orientation change
        window.addEventListener('orientationchange', () => {
            setTimeout(() => { initialHeight = window.visualViewport.height; }, 1000); // Wait for Safari chrome animation
        });
    }

    // Method 2: Focus/blur on input elements (fallback)
    document.addEventListener('focusin', (e) => {
        if (e.target.matches('input, textarea')) {
            document.body.classList.add('keyboard-open');

            // Explicitly close slide panel on mobile if typing starts
            if (window.innerWidth < 768 && typeof slidePanel !== 'undefined' && slidePanel) {
                slidePanel.classList.remove('open');
            }

            // Scroll the focused element into view after a short delay
            if (isIOS) {
                setTimeout(() => {
                    e.target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 400); // Slightly longer for Safari stability
            }
        }
    });
    document.addEventListener('focusout', (e) => {
        if (e.target.matches('input, textarea')) {
            document.body.classList.remove('keyboard-open');
            // Force iOS to recalculate layout
            if (isIOS) {
                window.scrollTo(0, 0);
            }
        }
    });
})();

// Initialize map centered on the US
const map = L.map('map', {
    zoomControl: false,
    worldCopyJump: true,
    renderer: L.canvas({ padding: 0.5 }),
    preferCanvas: true,
    zoomSnap: 0.5,              // Smooth enough for custom gestures, crisp for scroll wheel
    zoomDelta: 1,               // Desktop scroll wheel zooms by 1 full level per tick
    wheelDebounceTime: 40,      // Responsive trackpad feel
    wheelPxPerZoomLevel: 120    // Natural scroll-to-zoom ratio
});

// 🎯 MAP MEMORY INJECTION
const savedView = JSON.parse(localStorage.getItem('barkMapView'));
if (savedView && savedView.lat && savedView.lng && savedView.zoom) {
    map.setView([savedView.lat, savedView.lng], savedView.zoom);
} else {
    map.setView([39.8283, -98.5795], 4); // Default US center
}

// Save the view every time the user stops dragging or zooming
map.on('moveend', () => {
    const center = map.getCenter();
    localStorage.setItem('barkMapView', JSON.stringify({
        lat: center.lat,
        lng: center.lng,
        zoom: map.getZoom()
    }));
});

// Helper to manually dismiss the cold-start loader exactly when we want to (e.g. after sync)
window.dismissBarkLoader = function () {
    const loader = document.getElementById('bark-loader');
    if (loader && loader.style.opacity !== '0') {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 600);
    }
};

L.control.zoom({
    position: 'bottomleft'
}).addTo(map);

// Add OpenStreetMap tiles
let currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
}).addTo(map);

const mapStyleSelect = document.getElementById('map-style-select');
if (mapStyleSelect) {
    mapStyleSelect.addEventListener('change', (e) => {
        if (currentTileLayer) map.removeLayer(currentTileLayer);
        const style = e.target.value;
        if (style === 'terrain') {
            currentTileLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)', maxZoom: 17 }).addTo(map);
        } else if (style === 'satellite') {
            currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community', maxZoom: 18 }).addTo(map);
        } else if (style === 'streets') {
            currentTileLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS, Intermap, iPC, NRCAN, Esri Japan, METI, Esri China (Hong Kong), Esri (Thailand), TomTom, 2012', maxZoom: 18 }).addTo(map);
        } else {
            currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 18 }).addTo(map);
        }
    });
}

// Add Locate Control
const LocateControl = L.Control.extend({
    options: {
        position: 'bottomleft'
    },
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

map.on('locationfound', function (e) {
    if (userLocationMarker) {
        map.removeLayer(userLocationMarker);
    }

    // 🎯 PULSING BLUE DOT UPGRADE
    const pulsingIcon = L.divIcon({
        className: 'custom-location-pulse',
        html: '<div class="pulse-location-dot" style="width: 16px; height: 16px;"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });

    userLocationMarker = L.marker(e.latlng, { icon: pulsingIcon }).addTo(map);
    userLocationMarker.bindPopup('You are here!').openPopup();

    // 🎯 RE-CALCULATE AND RE-SORT ACHIEVEMENTS NOW THAT WE HAVE ACTUAL LOCATION
    evaluateAchievements(userVisitedPlaces);
});

map.on('locationerror', function (e) {
    console.warn("Could not access your location. Please check your browser permissions.");
});

// Prompt for location immediately on load
setTimeout(() => {
    map.locate({ setView: false, watch: false });
}, 500); // Give the map engine a slight delay to settle before prompting

// Create a marker layer group for easy clearing
const markerLayer = L.layerGroup().addTo(map);

// Creates the clustering engine, but does NOT add it to the map yet.
const markerClusterGroup = L.markerClusterGroup({
    chunkedLoading: true, // Processes in batches so old phones don't freeze
    removeOutsideVisibleBounds: true, // Deletes off-screen pins to save RAM
    disableClusteringAtZoom: 16, // Ungroups when zoomed in close
    animate: false // Turned off specifically to save CPU on older phones
});

// ====== SETTINGS UI LOGIC ======
let allowUncheck = localStorage.getItem('barkAllowUncheck') === 'true';
let clusteringEnabled = localStorage.getItem('barkClusteringEnabled') === 'true';
let lowGfxEnabled = localStorage.getItem('barkLowGfxEnabled') === 'true';
let simplifyTrails = localStorage.getItem('barkSimplifyTrails') === 'true';
let instantNav = localStorage.getItem('barkInstantNav') === 'true';

// Apply initial Low Graphics class
if (lowGfxEnabled) document.body.classList.add('low-graphics');

document.addEventListener('DOMContentLoaded', () => {
    const settingsGearBtn = document.getElementById('settings-gear-btn');
    const settingsOverlay = document.getElementById('settings-overlay');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const allowUncheckToggle = document.getElementById('allow-uncheck-setting');
    const clusterToggle = document.getElementById('cluster-toggle');
    const lowGfxToggle = document.getElementById('low-gfx-toggle');
    const simplifyTrailToggle = document.getElementById('simplify-trail-toggle');
    const instantNavToggle = document.getElementById('instant-nav-toggle');

    if (settingsGearBtn && settingsOverlay) {
        if (allowUncheckToggle) allowUncheckToggle.checked = allowUncheck;
        if (clusterToggle) clusterToggle.checked = clusteringEnabled;
        if (lowGfxToggle) lowGfxToggle.checked = lowGfxEnabled;
        if (simplifyTrailToggle) simplifyTrailToggle.checked = simplifyTrails;
        if (instantNavToggle) instantNavToggle.checked = instantNav;

        // Set version dinamically
        const versionLabel = document.getElementById('settings-app-version');
        if (versionLabel) versionLabel.textContent = APP_VERSION;

        settingsGearBtn.addEventListener('click', () => {
            settingsOverlay.classList.add('active');
        });

        const closeSettings = () => {
            settingsOverlay.classList.remove('active');
        };

        closeSettingsBtn.addEventListener('click', closeSettings);

        // Close on backdrop click
        settingsOverlay.addEventListener('click', (e) => {
            if (e.target === settingsOverlay) closeSettings();
        });

        if (allowUncheckToggle) {
            allowUncheckToggle.addEventListener('change', (e) => {
                allowUncheck = e.target.checked;
                localStorage.setItem('barkAllowUncheck', allowUncheck ? 'true' : 'false');
            });
        }

        if (clusterToggle) {
            clusterToggle.addEventListener('change', (e) => {
                clusteringEnabled = e.target.checked;
                localStorage.setItem('barkClusteringEnabled', clusteringEnabled ? 'true' : 'false');
                updateMarkers(); // Instant re-render
            });
        }

        if (lowGfxToggle) {
            lowGfxToggle.addEventListener('change', (e) => {
                lowGfxEnabled = e.target.checked;
                localStorage.setItem('barkLowGfxEnabled', lowGfxEnabled ? 'true' : 'false');
                if (lowGfxEnabled) {
                    document.body.classList.add('low-graphics');
                } else {
                    document.body.classList.remove('low-graphics');
                }
            });
        }

        if (simplifyTrailToggle) {
            simplifyTrailToggle.addEventListener('change', (e) => {
                simplifyTrails = e.target.checked;
                localStorage.setItem('barkSimplifyTrails', simplifyTrails ? 'true' : 'false');
                // Trigger re-render of trails if active
                if (window.lastActiveTrailId) {
                    renderVirtualTrailOverlay(window.lastActiveTrailId, window.lastMilesCompleted || 0);
                }
                if (typeof renderCompletedTrailsOverlay === 'function') {
                    // Logic to refresh completed trails
                    const user = firebase.auth().currentUser;
                    if (user) {
                        firebase.firestore().collection('users').doc(user.uid).get().then(doc => {
                            if (doc.exists && doc.data().completedExpeditions) {
                                renderCompletedTrailsOverlay(doc.data().completedExpeditions);
                            }
                        });
                    }
                }
            });
        }

        if (instantNavToggle) {
            instantNavToggle.addEventListener('change', (e) => {
                instantNav = e.target.checked;
                localStorage.setItem('barkInstantNav', instantNav ? 'true' : 'false');
            });
        }
    }
});

let allPoints = [];
let activePinMarker = null;

// Helper to clear the active pin highlight
function clearActivePin() {
    if (activePinMarker && activePinMarker._icon) {
        activePinMarker._icon.classList.remove('active-pin');
    }
    activePinMarker = null;
}
let activeSwagFilters = new Set();
let activeSearchQuery = '';
let activeTypeFilter = 'all';

let userVisitedPlaces = new Map();
const DAY_COLORS = ['#1976D2', '#2E7D32', '#E65100', '#6A1B9A', '#C62828'];
let tripDays = [{ color: DAY_COLORS[0], stops: [], notes: "" }];
let activeDayIdx = 0;
window.tripStartNode = null;
window.tripEndNode = null;
let visitedFilterState = 'all';

const generatePinId = (lat, lng) => `${parseFloat(lat).toFixed(2)}_${parseFloat(lng).toFixed(2)}`;

const haversineDistance = (lat1, lon1, lat2, lon2) => {
    const r = 6371; // km
    const p = Math.PI / 180;
    const a = 0.5 - Math.cos((lat2 - lat1) * p) / 2 +
        Math.cos(lat1 * p) * Math.cos(lat2 * p) *
        (1 - Math.cos((lon2 - lon1) * p)) / 2;
    return 2 * r * Math.asin(Math.sqrt(a));
};

function renderManagePortal() {
    const listEl = document.getElementById('manage-places-list');
    const countEl = document.getElementById('manage-portal-count');
    if (!listEl || !countEl) return;

    countEl.textContent = userVisitedPlaces.size;
    if (userVisitedPlaces.size === 0) {
        listEl.innerHTML = '<li style="color: #888; font-style: italic; padding: 10px 0;">Get exploring!</li>';
        return;
    }

    listEl.innerHTML = '';
    const placesArray = Array.from(userVisitedPlaces.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    placesArray.forEach(place => {
        const li = document.createElement('li');
        li.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 12px 0; border-bottom: 1px solid rgba(0,0,0,0.05);';

        const topRow = document.createElement('div');
        topRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';

        const nameSpan = document.createElement('span');
        nameSpan.textContent = place.verified ? `🐾 ${place.name}` : place.name;
        nameSpan.style.cssText = 'font-weight: 600; color: #333; flex: 1;';

        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times;';
        removeBtn.style.cssText = 'background: #fee2e2; color: #dc2626; border: none; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; font-weight: 800;';
        removeBtn.onclick = () => removeVisitedPlace(place);

        topRow.appendChild(nameSpan);
        topRow.appendChild(removeBtn);

        const controls = document.createElement('div');
        controls.style.cssText = 'display: flex; align-items: center; gap: 8px;';

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        dateInput.style.cssText = 'font-size: 11px; padding: 4px; border: 1px solid #ddd; border-radius: 4px; flex: 1;';
        if (place.ts) {
            const d = new Date(place.ts);
            dateInput.value = d.toISOString().split('T')[0];
        }

        const updateBtn = document.createElement('button');
        updateBtn.textContent = 'Update';
        updateBtn.style.cssText = 'background: #3b82f6; color: white; border: none; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer;';
        updateBtn.onclick = async () => {
            if (dateInput.value) {
                const newTs = new Date(dateInput.value + 'T12:00:00').getTime();
                await updateVisitDate(place.id, newTs);
                alert(`${place.name} date updated!`);
            }
        };

        controls.appendChild(dateInput);
        controls.appendChild(updateBtn);

        li.appendChild(topRow);
        li.appendChild(controls);
        listEl.appendChild(li);
    });
}

/**
 * Consolidated Firebase Sync Engine
 */
async function syncUserProgress() {
    if (!firebase.auth().currentUser) return;
    const uid = firebase.auth().currentUser.uid;
    const db = firebase.firestore();
    incrementRequestCount();

    // Sync all visited places
    const visitedArray = Array.from(userVisitedPlaces.values());
    await db.collection('users').doc(uid).set({
        visitedPlaces: visitedArray
    }, { merge: true });

    // Recalculate and Sync achievements
    await evaluateAchievements(userVisitedPlaces);
}

async function updateVisitDate(parkId, newTs) {
    if (userVisitedPlaces.has(parkId)) {
        const place = userVisitedPlaces.get(parkId);
        place.ts = newTs;
        await syncUserProgress();
        renderManagePortal();
    }
}

async function removeVisitedPlace(place) {
    if (window.confirm(`Remove ${place.name}?`)) {
        userVisitedPlaces.delete(place.id);
        await syncUserProgress();
        updateMarkers();
        renderManagePortal();
    }
}

const gamificationEngine = new GamificationEngine();

/**
 * 🛡️ FLOAT PRECISION GUARD 🛡️
 * Firestore FieldValue.increment(0.3) accumulates IEEE 754 drift
 * (e.g. 10.109999999999943 instead of 10.11). This rounds to 2 decimal
 * places then floors to an integer for score calculation.
 */
function sanitizeWalkPoints(raw) {
    return Math.floor(Math.round((raw || 0) * 100) / 100);
}

/**
 * 🏆 CENTRALIZED LEADERBOARD SYNC 🏆
 * Recalculates totalScore from current in-memory state and writes to both
 * users/{uid} and leaderboard/{uid} — but ONLY if the score actually changed.
 * Called from evaluateAchievements AND every walkPoints mutation path.
 */
async function syncScoreToLeaderboard() {
    const user = firebase.auth().currentUser;
    if (!user) return;

    // Recalculate from authoritative in-memory state
    let verifiedCount = 0;
    let regularCount = 0;
    userVisitedPlaces.forEach(p => { if (p.verified) verifiedCount++; else regularCount++; });
    const totalScore = (verifiedCount * 2) + regularCount + sanitizeWalkPoints(window.currentWalkPoints);

    // Efficiency guard: skip Firestore write if nothing changed
    if (totalScore === window._lastSyncedScore) return;

    // console.log(`Syncing verified score to leaderboard: ${totalScore}`);
    const db = firebase.firestore();
    incrementRequestCount();

    // Sync to USER Profile
    await db.collection('users').doc(user.uid).set({
        totalPoints: totalScore,
        totalVisited: userVisitedPlaces.size,
        displayName: user.displayName || 'Bark Ranger',
        hasVerified: Array.from(userVisitedPlaces.values()).some(p => p.verified)
    }, { merge: true });

    // Sync to GLOBAL Leaderboard (Immediate View)
    await db.collection('leaderboard').doc(user.uid).set({
        displayName: user.displayName || 'Bark Ranger',
        photoURL: user.photoURL || '',
        totalPoints: totalScore,
        totalVisited: userVisitedPlaces.size,
        hasVerified: Array.from(userVisitedPlaces.values()).some(p => p.verified),
        lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    window._lastSyncedScore = totalScore;

    // 🎯 INSTANT LOCAL UPDATE: Patch the in-memory leaderboard cache too
    if (cachedLeaderboardData.length > 0) {
        const me = cachedLeaderboardData.find(u => u.uid === user.uid);
        if (me) {
            me.totalPoints = totalScore;
            me.totalVisited = userVisitedPlaces.size;
        } else {
            cachedLeaderboardData.push({
                uid: user.uid,
                displayName: user.displayName || 'Bark Ranger',
                totalPoints: totalScore,
                totalVisited: userVisitedPlaces.size,
                hasVerified: Array.from(userVisitedPlaces.values()).some(p => p.verified)
            });
        }
        cachedLeaderboardData.sort((a, b) => b.totalPoints - a.totalPoints);
        renderLeaderboard(cachedLeaderboardData);
    }
}

async function evaluateAchievements(visitedPlacesMap) {
    const visitedArray = Array.from(visitedPlacesMap.values());

    // 🔥 THE FIX: Hydrate saved visits with missing State data from the master map 🔥
    visitedArray.forEach(visit => {
        if (!visit.state) {
            const mapPoint = allPoints.find(p => p.id === visit.id);
            if (mapPoint) {
                visit.state = mapPoint.state;
            }
        }
    });

    let userId = null;
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
        userId = firebase.auth().currentUser.uid;
    }

    // Use our new bulletproof mapping logic to set the required totals per state
    gamificationEngine.updateCanonicalCountsFromPoints(allPoints);

    const achievements = await gamificationEngine.evaluateAndStoreAchievements(userId, visitedArray, null, window.currentWalkPoints || 0);

    // Update Banner
    const titleEl = document.getElementById('current-title-label');
    const scoreEl = document.getElementById('stat-score');
    const progressFill = document.getElementById('tier-progress-fill');
    const fractionEl = document.getElementById('rank-progress-fraction');

    // 🎉 RANK-UP CELEBRATION: Compare old title to new title
    if (titleEl) {
        const oldTitle = window._lastKnownRank || titleEl.textContent || 'B.A.R.K. Trainee';
        const newTitle = achievements.title;

        // Check if user is authenticated (prevents confetti firing on logout when data goes to 0)
        const isAuth = typeof firebase !== 'undefined' && firebase.auth().currentUser;

        // The system is fully hydrated ONLY if we received a server payload and it has completely settled
        const isSecurelyHydrated = window._serverPayloadSettled;

        if (isAuth && isSecurelyHydrated && window._lastKnownRank && oldTitle !== newTitle && newTitle !== 'B.A.R.K. Trainee') {
            // The system has securely hydrated from the server. Any rank shift here is a genuine upgrade! 
            showRankUpCelebration(oldTitle, newTitle);
        }

        window._lastKnownRank = newTitle;
        titleEl.textContent = newTitle;
    }
    if (scoreEl) scoreEl.textContent = achievements.totalScore;

    // 🏆 EFFICIENT LEADERBOARD SYNC 🏆
    if (userId) {
        await syncScoreToLeaderboard();
    }

    if (progressFill) {
        const thresholds = [10, 25, 50, 100, 200, 300, 500];
        const next = thresholds.find(t => t > achievements.totalScore) || 500;
        const prev = thresholds[thresholds.indexOf(next) - 1] || 0;
        const pct = Math.min(100, ((achievements.totalScore - prev) / (next - prev)) * 100);
        progressFill.style.width = pct + "%";

        if (fractionEl) {
            if (achievements.totalScore >= 500) {
                fractionEl.textContent = 'MAX RANK ACHIEVED 🏆';
                progressFill.style.width = "100%";
            } else {
                fractionEl.textContent = `${achievements.totalScore} / ${next} PTS`;
            }
        }
    }

    // Helper to guarantee a subtitle exists for sharing
    const getSubtitle = (b) => {
        let s = b.desc || b.hint || '';
        if (!s && b.id.includes('Paw')) s = 'Verified Check-ins';
        if (!s && b.id.includes('state')) s = '100% cleared!!';
        return s;
    };

    // Helper to safely escape single quotes for inline JS attributes
    const esc = (str) => String(str || '').replace(/'/g, "\\'");

    const renderStateBadge = (b) => {
        const isU = b.status === 'unlocked';
        const tCl = isU ? (b.tier === 'verified' ? 'verified-tier' : 'honor-tier') : 'locked-tier';
        const datePlaceholder = b.dateEarned || '--/--/----';
        const upgradeCta = (isU && b.tier === 'honor') ? '<div class="upgrade-pill">⭐ VERIFY TO UPGRADE</div>' : '';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', '${esc(b.tier)}', false, '${esc(sub)}')" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; color: white; font-size: 9px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">📸 SHARE</button>` : '';

        let progressHtml = '';
        if (!isU && typeof b.percentComplete !== 'undefined') {
            const pct = b.percentComplete;
            progressHtml = `
            <div class="state-progress-wrap">
                <div class="state-progress-track">
                    <div class="state-progress-fill" style="width: ${pct}%;"></div>
                </div>
                <span class="state-progress-text">${pct}%</span>
            </div>`;
        }

        return `
        <div class="flip-scene">
            <div class="skeuo-badge ${tCl} ${isU ? 'unlocked hover-float' : 'locked'}">
                <div class="badge-face badge-front">
                    <div class="badge-icon">${b.icon}</div>
                    <div class="badge-details">
                        <h4>${b.name}</h4>
                        <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || ''}</div>
                    </div>
                    ${progressHtml}
                </div>
                <div class="badge-face badge-back">
                    <div class="engraved-date">EST. ${datePlaceholder}</div>
                    ${upgradeCta}
                    ${shareBtnHtml}
                </div>
            </div>
        </div>`;
    };

    const renderCoin = (b) => {
        const isU = b.status === 'unlocked';
        const tCl = isU ? (b.tier === 'verified' ? 'verified-tier' : 'honor-tier') : 'locked-tier';
        const upgradeCta = (isU && b.tier === 'honor') ? '<div class="upgrade-pill">⭐ VERIFY TO UPGRADE</div>' : '';
        const datePlaceholder = b.dateEarned || '--/--/----';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', '${esc(b.tier)}', false, '${esc(sub)}')" style="margin-top: 8px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.2); padding: 4px 12px; border-radius: 20px; color: white; font-size: 9px; font-weight: 800; cursor: pointer; display: flex; align-items: center; gap: 4px;">📸 SHARE</button>` : '';

        return `
        <div class="flip-scene">
            <div class="skeuo-badge ${tCl} ${isU ? 'unlocked hover-float' : 'locked'}">
                <div class="badge-face badge-front">
                    <div class="badge-icon">${b.icon}</div>
                    <div class="badge-details">
                        <h4>${b.name}</h4>
                        <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || ''}</div>
                    </div>
                </div>
                <div class="badge-face badge-back">
                    <div class="engraved-date">EST. ${datePlaceholder}</div>
                    ${upgradeCta}
                    ${shareBtnHtml}
                </div>
            </div>
        </div>`;
    };

    const renderDossier = (b) => {
        const isU = b.status === 'unlocked';
        const sub = getSubtitle(b);
        const shareBtnHtml = isU ? `<button onclick="shareSingleBadge('${esc(b.name)}', '${esc(b.icon)}', 'verified', true, '${esc(sub)}')" class="mystery-share-btn" title="Share Milestone">📸</button>` : '';

        return `
        <div class="mystery-card ${isU ? 'unlocked' : 'locked'}">
            <div class="mystery-icon">${isU ? b.icon : '?'}</div>
            <div class="mystery-info">
                <div class="mystery-title">${isU ? b.name : '[CLASSIFIED]'}</div>
                <div style="font-size: 11px; font-weight: 600; color: #94a3b8; margin-top: 4px;">${b.criteria || b.hint || ''}</div>
            </div>
            ${shareBtnHtml}
        </div>`;
    };

    const gridRare = document.getElementById('rare-feats-grid');
    const gridPaws = document.getElementById('paws-grid');
    const gridStates = document.getElementById('states-grid');
    const gridDossier = document.getElementById('mystery-feats-dossier');

    if (gridRare) gridRare.innerHTML = achievements.rareFeats.map(renderCoin).join('');
    if (gridPaws) gridPaws.innerHTML = achievements.paws.map(renderCoin).join('');

    // --- STATES SORT: DISTANCE & COMPLETION ---
    const stateDistances = {};
    const refLatLng = userLocationMarker ? userLocationMarker.getLatLng() : map.getCenter();
    
    if (allPoints && allPoints.length > 0) {
        allPoints.forEach(p => {
            if (p.state && p.lat && p.lng) {
                const sts = String(p.state).split(/[,/]/);
                const dist = haversineDistance(refLatLng.lat, refLatLng.lng, parseFloat(p.lat), parseFloat(p.lng));
                sts.forEach(s => {
                    const cleanSt = gamificationEngine.getNormalizedStateCode(s);
                    if (cleanSt) {
                        if (stateDistances[cleanSt] === undefined || dist < stateDistances[cleanSt]) {
                            stateDistances[cleanSt] = dist;
                        }
                    }
                });
            }
        });
    }

    let minOverallDist = Infinity;
    let currentStateCode = null;
    for (const [code, dist] of Object.entries(stateDistances)) {
        if (dist < minOverallDist) {
            minOverallDist = dist;
            currentStateCode = code;
        }
    }

    achievements.stateBadges.sort((a, b) => {
        const aCode = a.id.replace('state-', '').toUpperCase();
        const bCode = b.id.replace('state-', '').toUpperCase();

        const aIsCurrent = aCode === currentStateCode;
        const bIsCurrent = bCode === currentStateCode;

        if (aIsCurrent && !bIsCurrent) return -1;
        if (!aIsCurrent && bIsCurrent) return 1;

        const aUnlocked = a.status === 'unlocked';
        const bUnlocked = b.status === 'unlocked';

        if (aUnlocked && !bUnlocked) return -1;
        if (!aUnlocked && bUnlocked) return 1;

        if (aUnlocked && bUnlocked) {
             return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0); // newest first
        }

        const aDist = stateDistances[aCode] !== undefined ? stateDistances[aCode] : Infinity;
        const bDist = stateDistances[bCode] !== undefined ? stateDistances[bCode] : Infinity;
        
        return aDist - bDist; // closest first
    });

    // --- NATIONAL PROGRESS ANCHOR CARD ---
    const nationalCardHtml = `
        <div class="flip-scene" style="flex: 0 0 auto; width: 140px; scroll-snap-align: center;">
            <div class="skeuo-badge" style="background: linear-gradient(135deg, #0f172a, #1e293b); border: 2px solid #3b82f6; box-shadow: 0 4px 15px rgba(59,130,246,0.3); border-radius: 16px; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 10px; text-align: center;">
                <div style="font-size: 28px; margin-bottom: 4px;">🇺🇸</div>
                <h4 style="color: #f1f5f9; font-size: 12px; font-weight: 900; text-transform: uppercase; margin: 0 0 8px 0;">National Map</h4>
                <div style="width: 80%; height: 6px; background: rgba(255,255,255,0.1); border-radius: 6px; overflow: hidden; margin-bottom: 4px;">
                    <div style="width: ${achievements.nationalProgress.percentComplete}%; height: 100%; background: linear-gradient(90deg, #38bdf8, #3b82f6); box-shadow: 0 0 8px rgba(56,189,248,0.6);"></div>
                </div>
                <span style="color: #94a3b8; font-size: 9px; font-weight: 800;">${achievements.nationalProgress.totalVisited} / ${achievements.nationalProgress.totalParks} SITES</span>
            </div>
        </div>`;

    if (gridStates) gridStates.innerHTML = nationalCardHtml + achievements.stateBadges.map(renderStateBadge).join('');
    if (gridDossier) gridDossier.innerHTML = achievements.mysteryFeats.map(renderDossier).join('');

    // Re-bind tab listeners (idempotent)
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const content = document.getElementById(btn.dataset.tab + '-content');
            if (content) content.classList.add('active');
        };
    });
}


function updateStatsUI() {
    const scoreEl = document.getElementById('stat-score');
    const verifiedEl = document.getElementById('stat-verified');
    const regularEl = document.getElementById('stat-regular');
    const statesEl = document.getElementById('stat-states');

    if (!scoreEl || !verifiedEl || !regularEl || !statesEl) return;

    const statesSet = new Set();
    allPoints.forEach(p => {
        if (userVisitedPlaces.has(p.id) && p.state) {
            const st = p.state.toString().split(/[,/]/);
            st.forEach(s => {
                const trimmed = s.trim().toUpperCase();
                if (trimmed) statesSet.add(trimmed);
            });
        }
    });

    let totalScore = 0;
    let verifiedCount = 0;
    let regularCount = 0;

    userVisitedPlaces.forEach((p) => {
        if (p.verified) {
            verifiedCount++;
        } else {
            regularCount++;
        }
    });

    totalScore = (verifiedCount * 2) + regularCount + sanitizeWalkPoints(window.currentWalkPoints);

    scoreEl.textContent = totalScore;
    verifiedEl.textContent = verifiedCount;
    regularEl.textContent = regularCount;
    statesEl.textContent = statesSet.size;

    // Reward Progress Bar logic
    let level = 1;
    let max = 10;
    if (totalScore >= 100) { level = 4; max = totalScore; }
    else if (totalScore >= 51) { level = 3; max = 100; }
    else if (totalScore >= 11) { level = 2; max = 50; }

    const pbTitle = document.getElementById('reward-level-title');
    const pbStatus = document.getElementById('reward-level-status');
    const pbBar = document.getElementById('reward-progress-bar');
    if (pbTitle && pbStatus && pbBar) {
        if (level === 4) {
            pbTitle.textContent = "🏆 B.A.R.K. Master!";
            pbStatus.textContent = totalScore + " Pts";
            pbBar.style.width = "100%";
        } else {
            pbTitle.textContent = "Level " + level;
            pbStatus.textContent = totalScore + " / " + max + " Pts";
            const pct = Math.min(100, Math.round((totalScore / max) * 100));
            pbBar.style.width = pct + "%";
        }
    }

    // Consistently update achievements when stats change
    evaluateAchievements(userVisitedPlaces);
    renderManagePortal();
}

const normalizationDict = {
    'ft': 'fort',
    'mt': 'mount',
    'st': 'saint',
    'natl': 'national',
    'np': 'national park',
    'sp': 'state park',
    'nf': 'national forest',
    'nwr': 'national wildlife refuge',
    'mem': 'memorial',
    'rec': 'recreation',
    'hist': 'historic'
};

function normalizeText(text) {
    if (!text) return '';
    let cleaned = String(text).toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s{2,}/g, " ").trim();
    let words = cleaned.split(' ');
    for (let i = 0; i < words.length; i++) {
        if (normalizationDict[words[i]]) {
            words[i] = normalizationDict[words[i]];
        }
    }
    return words.join(' ');
}

function levenshtein(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
    }
    return matrix[b.length][a.length];
}

function formatSwagLinks(text) {
    if (!text) return '';
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const urls = text.match(urlRegex);
    if (!urls) return text;

    let resultHTML = '';
    urls.forEach((url, index) => {
        resultHTML += `<a href="${url}" target="_blank" class="swag-link-btn">📷 Swag Pic ${index + 1}</a> `;
    });
    return resultHTML.trim();
}

// DOM Elements
const slidePanel = document.getElementById('slide-panel');
const titleEl = document.getElementById('panel-title');
const locEl = document.getElementById('panel-location');
const typeEl = document.getElementById('panel-swag-type');
const infoSection = document.getElementById('panel-info-section');
const infoEl = document.getElementById('panel-info');
const websitesContainer = document.getElementById('websites-container');
const costContainer = document.getElementById('panel-swag-cost');
const costValEl = document.getElementById('swag-cost-val');
const picsEl = document.getElementById('panel-pics');
const videoEl = document.getElementById('panel-video');
const filterBtns = document.querySelectorAll('.filter-btn');
const searchInput = document.getElementById('park-search');
const clearSearchBtn = document.getElementById('clear-search-btn');
const typeSelect = document.getElementById('type-filter');

// --- Virtual Trail Overlay System ---
let virtualTrailLayerGroup = L.featureGroup();
let completedTrailsLayerGroup = L.featureGroup();

async function renderCompletedTrailsOverlay(completedExpeditions) {
    completedTrailsLayerGroup.clearLayers();
    if (!completedExpeditions || completedExpeditions.length === 0) return;

    try {
        const response = await fetch('trails.json');
        const trailsData = await response.json();

        completedExpeditions.forEach(exp => {
            const trailId = exp.id || exp.trail_id;
            const trailGeoJson = trailsData[trailId];
            if (trailGeoJson) {
                // Drop the physical path
                L.geoJSON(trailGeoJson, {
                    style: { color: '#22c55e', weight: 4, opacity: 0.8, lineCap: 'round', dashArray: '1, 6' },
                    smoothFactor: simplifyTrails ? 5.0 : 1.0
                }).addTo(completedTrailsLayerGroup);

                // Calculate a center point on the line geometry and drop a massive Trophy pin
                const pt = turf.pointOnFeature(trailGeoJson);
                const coords = pt.geometry.coordinates; // [lon, lat]
                const pinIcon = L.divIcon({
                    className: 'custom-completed-icon',
                    html: `<div style="font-size: 16px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5)); background: #22c55e; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 3px solid white;">🏆</div>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });

                const trailName = trailGeoJson.properties ? trailGeoJson.properties.name : "Conquered Trail";
                L.marker([coords[1], coords[0]], { icon: pinIcon })
                    .bindPopup(`<div style="text-align:center;font-weight:800;color:#22c55e;">${trailName}</div><div style="font-size:11px;color:#64748b;text-align:center;margin-top:2px;">Expedition Conquered!</div>`)
                    .addTo(completedTrailsLayerGroup);
            }
        });

        const toggleBtn = document.getElementById('toggle-completed-trails');
        if (toggleBtn && toggleBtn.classList.contains('active')) {
            completedTrailsLayerGroup.addTo(map);
        }
    } catch (error) {
        console.error("Error rendering completed trails:", error);
    }
}

async function renderVirtualTrailOverlay(trailId, milesCompleted) {
    virtualTrailLayerGroup.clearLayers();
    try {
        const response = await fetch('trails.json');
        const trailsData = await response.json();
        const trailGeoJson = trailsData[trailId];

        if (!trailGeoJson) return;

        const totalMiles = trailGeoJson.properties.total_miles;

        // Scale mathematical progress accurately onto the literal geographical vector length
        const actualGeoLength = turf.length(trailGeoJson, { units: 'miles' });
        const progressPct = totalMiles > 0 ? Math.min(1, milesCompleted / totalMiles) : 0;
        const geoSafeMiles = actualGeoLength * progressPct;

        if (geoSafeMiles > 0) {
            const completedLine = turf.lineSliceAlong(trailGeoJson, 0, geoSafeMiles, { units: 'miles' });
            L.geoJSON(completedLine, {
                style: { color: '#22c55e', weight: 6, opacity: 0.9, lineCap: 'round' },
                smoothFactor: simplifyTrails ? 5.0 : 1.0
            }).addTo(virtualTrailLayerGroup);
        }

        if (geoSafeMiles < actualGeoLength) {
            const remainingLine = turf.lineSliceAlong(trailGeoJson, geoSafeMiles, actualGeoLength, { units: 'miles' });
            L.geoJSON(remainingLine, {
                style: { color: '#ef4444', weight: 4, opacity: 0.6, dashArray: '5, 10', lineCap: 'round' },
                smoothFactor: simplifyTrails ? 5.0 : 1.0
            }).addTo(virtualTrailLayerGroup);
        }

        const currentAvatarPoint = turf.along(trailGeoJson, geoSafeMiles, { units: 'miles' });

        const dogIcon = L.divIcon({
            className: 'custom-avatar-icon',
            html: '<div style="font-size: 24px; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.4));">🐕</div>',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });

        L.marker([currentAvatarPoint.geometry.coordinates[1], currentAvatarPoint.geometry.coordinates[0]], { icon: dogIcon })
            .addTo(virtualTrailLayerGroup);

        window.lastActiveTrailId = trailId;
        window.lastMilesCompleted = milesCompleted;

        const toggleBtn = document.getElementById('toggle-virtual-trail');
        if (toggleBtn && toggleBtn.classList.contains('active')) {
            virtualTrailLayerGroup.addTo(map);
            // Don't auto-zoom here — only zoom when user explicitly clicks the Active Trail toggle
        }
    } catch (error) {
        console.error("Error rendering virtual trail:", error);
    }
}

const toggleVirtualBtn = document.getElementById('toggle-virtual-trail');
if (toggleVirtualBtn) {
    toggleVirtualBtn.addEventListener('click', function () {
        this.classList.toggle('active');
        if (this.classList.contains('active')) {
            virtualTrailLayerGroup.addTo(map);
            if (virtualTrailLayerGroup.getLayers().length > 0) {
                map.fitBounds(virtualTrailLayerGroup.getBounds(), { 
                    padding: [50, 50],
                    animate: !instantNav,
                    duration: instantNav ? 0 : 0.5
                });
            }
        } else {
            virtualTrailLayerGroup.removeFrom(map);
        }
    });
}

const toggleCompletedBtn = document.getElementById('toggle-completed-trails');
if (toggleCompletedBtn) {
    toggleCompletedBtn.addEventListener('click', function () {
        this.classList.toggle('active');
        if (this.classList.contains('active')) {
            completedTrailsLayerGroup.addTo(map);
            if (completedTrailsLayerGroup.getLayers().length > 0) {
                map.fitBounds(completedTrailsLayerGroup.getBounds(), { 
                    padding: [50, 50],
                    animate: !instantNav,
                    duration: instantNav ? 0 : 0.5
                });
            }
        } else {
            completedTrailsLayerGroup.removeFrom(map);
        }
    });
}
// -------------------------------------

const closeSlideBtn = document.getElementById('close-slide-panel');

// Navigation & Views
const navItems = document.querySelectorAll('.nav-item');
const uiViews = document.querySelectorAll('.ui-view');
const filterPanel = document.getElementById('filter-panel');
const leafletControls = document.querySelectorAll('.leaflet-control-container');

// Watermark Tool Elements
const wmUpload = document.getElementById('wm-upload');
const wmCanvas = document.getElementById('wm-canvas');
const wmDownload = document.getElementById('wm-download');

// Stop Leaflet from stealing scroll/pan touches on the UI panels
L.DomEvent.disableClickPropagation(slidePanel);
L.DomEvent.disableScrollPropagation(slidePanel);

// Close panel and clear pin
closeSlideBtn.addEventListener('click', () => {
    slidePanel.classList.remove('open');
    clearActivePin(); // 🔥 Fixes the ghost pin
});

// Navigation Logic
navItems.forEach(btn => {
    btn.addEventListener('click', () => {
        navItems.forEach(n => n.classList.remove('active'));
        btn.classList.add('active');

        const targetId = btn.getAttribute('data-target');

        if (targetId === 'map-view') {
            uiViews.forEach(v => v.classList.remove('active'));
            if (filterPanel) filterPanel.style.display = 'flex';
            if (leafletControls.length) leafletControls[0].style.display = 'block';
        } else {
            uiViews.forEach(v => {
                if (v.id === targetId) {
                    v.classList.add('active');
                } else {
                    v.classList.remove('active');
                }
            });
            if (filterPanel) filterPanel.style.display = 'none';
            if (slidePanel) slidePanel.classList.remove('open');
            if (leafletControls.length) leafletControls[0].style.display = 'none';
        }
    });
});

// Watermark Tool Logic
const wmSliderContainer = document.getElementById('wm-slider-container');
const wmLogoSize = document.getElementById('wm-logo-size');
const wmLogoSizeVal = document.getElementById('wm-logo-size-val');
const wmHighRes = document.getElementById('wm-high-res');
let currentPhotoImg = null;
let currentLogoImg = null;

if (wmUpload) {
    currentLogoImg = new Image();
    currentLogoImg.src = 'WatermarkBARK.PNG';

    function drawWatermark(logoScalePercent) {
        if (!currentPhotoImg || !currentLogoImg) return;

        const ctx = wmCanvas.getContext('2d');
        const isFullRes = wmHighRes && wmHighRes.checked;

        // 1200px is a great sharp balance for social sharing.
        // Full resolution is used for printing.
        const PREVIEW_WIDTH = 1200;

        let width = currentPhotoImg.width;
        let height = currentPhotoImg.height;

        if (!isFullRes && width > PREVIEW_WIDTH) {
            height = height * (PREVIEW_WIDTH / width);
            width = PREVIEW_WIDTH;
        }

        const borderSize = Math.max(width, height) * 0.08;
        const canvasWidth = width + borderSize * 2;
        const canvasHeight = height + borderSize * 2;

        wmCanvas.width = canvasWidth;
        wmCanvas.height = canvasHeight;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        ctx.drawImage(currentPhotoImg, borderSize, borderSize, width, height);

        const scaleFactor = logoScalePercent / 100;
        const logoWidthPx = width * scaleFactor;
        const logoHeightPx = currentLogoImg.height * (logoWidthPx / currentLogoImg.width);

        const margin = width * 0.02;
        const logoX = borderSize + width - logoWidthPx - margin;
        const logoY = borderSize + height - logoHeightPx - margin;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(currentLogoImg, logoX, logoY, logoWidthPx, logoHeightPx);

        document.getElementById('wm-preview-container').style.display = 'block';
        if (wmSliderContainer) wmSliderContainer.style.display = 'block';
        wmDownload.style.display = 'inline-block';
    }

    if (wmLogoSize) {
        wmLogoSize.addEventListener('input', (e) => {
            const val = e.target.value;
            wmLogoSizeVal.textContent = val + '%';
            drawWatermark(parseInt(val, 10));
        });
    }

    wmUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Cleanup old ObjectURL to free memory
        if (currentPhotoImg && currentPhotoImg.src && currentPhotoImg.src.startsWith('blob:')) {
            URL.revokeObjectURL(currentPhotoImg.src);
        }

        const img = new Image();
        img.onload = () => {
            currentPhotoImg = img;
            if (wmLogoSize) {
                wmLogoSize.value = 10;
                wmLogoSizeVal.textContent = '10%';
            }
            drawWatermark(10);
        };
        img.src = URL.createObjectURL(file);
    });

    wmDownload.addEventListener('click', () => {
        const isFullRes = wmHighRes && wmHighRes.checked;
        const link = document.createElement('a');
        link.download = 'bark-ranger-swag-polaroid.jpg';

        // Final export at maximum quality (1.0 is lossless compression)
        link.href = wmCanvas.toDataURL('image/jpeg', 1.0);
        link.click();
    });

    if (wmHighRes) {
        wmHighRes.addEventListener('change', () => {
            drawWatermark(parseInt(wmLogoSize.value, 10));
        });
    }

    const wmClearBtn = document.getElementById('wm-clear');
    if (wmClearBtn) {
        wmClearBtn.addEventListener('click', () => {
            if (currentPhotoImg && currentPhotoImg.src && currentPhotoImg.src.startsWith('blob:')) {
                URL.revokeObjectURL(currentPhotoImg.src);
            }
            wmUpload.value = '';
            const ctx = wmCanvas.getContext('2d');
            ctx.clearRect(0, 0, wmCanvas.width, wmCanvas.height);
            currentPhotoImg = null;
            document.getElementById('wm-preview-container').style.display = 'none';
            if (wmSliderContainer) wmSliderContainer.style.display = 'none';
            wmDownload.style.display = 'none';
        });
    }
}

// Marker Color mapping
function getColor(type) {
    if (type === 'Tag') return '#2196F3';
    if (type === 'Bandana') return '#FF9800';
    if (type === 'Certificate') return '#4CAF50';
    return '#9E9E9E';
}

function getBadgeClass(type) {
    if (type === 'Tag') return 'tag';
    if (type === 'Bandana') return 'bandana';
    if (type === 'Certificate') return 'certificate';
    return 'other';
}

function getParkCategory(typeString) {
    if (!typeString) return 'Other';
    const t = String(typeString).trim().toLowerCase();
    if (t === 'national' || t.includes('national')) return 'National';
    if (t === 'state' || t.includes('state')) return 'State';
    return 'Other';
}

function getSwagType(info) {
    if (!info) return 'Other';
    const lower = String(info).toLowerCase();
    if (lower.includes('tag')) return 'Tag';
    if (lower.includes('bandana') || lower.includes('vest')) return 'Bandana';
    if (lower.includes('certificate') || lower.includes('pledge')) return 'Certificate';
    return 'Other';
}

let isRendering = false; // Concurrency lock
let pendingCSV = null;   // Queue if a render is in progress

function processParsedResults(results) {
    // Remember currently active pin location so we can restore it after rebuild
    let activeLat = null, activeLng = null;
    if (activePinMarker && activePinMarker._parkData) {
        activeLat = activePinMarker._parkData.lat;
        activeLng = activePinMarker._parkData.lng;
    }
    if (activePinMarker && activePinMarker._icon) {
        activePinMarker._icon.classList.remove('active-pin');
    }
    activePinMarker = null;

    markerLayer.clearLayers();
    allPoints = [];
    results.data.forEach(rawItem => {
        // Sanitize keys and values
        const item = {};
        if (rawItem && typeof rawItem === 'object') {
            Object.keys(rawItem).forEach(key => {
                let val = rawItem[key];
                if (typeof val === 'string') {
                    val = val.trim();
                }
                item[key] = val;
            });
        }

        // Map exact headers
        const name = item['Location'];
        const state = item['State'];
        const cost = item['Swag Cost'];
        const category = item['Type'];
        const info = item[' Useful/Important/Other Info'];
        const website = item['Website'];
        const pics = item['Swag Pics - If available, and may not be current.'];
        const video = item['Swearing-In Video. Not all sites do this, and ones that do only do it as time permits.'];
        let lat = item['lat'];
        let lng = item['lng'];

        // Fix incorrect geocoding for War in the Pacific (Guam) which defaults to Colorado
        if (name && name.includes('War in the Pacific')) {
            lat = 13.402746;
            lng = 144.6632005;
        }

        if (!lat || !lng) return;

        const swagType = getSwagType(info);
        const parkCategory = getParkCategory(category);

        const id = generatePinId(lat, lng);
        const parkData = { id, name, state, cost, swagType, info, website, pics, video, lat, lng, parkCategory };
        const isVisited = userVisitedPlaces.has(id);
        const marker = MapMarkerConfig.createCustomMarker(parkData, isVisited);

        // 🎯 THE DOM RECYCLING FIX
        // Scrub the HTML element clean before Leaflet throws it in the recycle bin
        marker.on('remove', function () {
            if (this._icon) {
                this._icon.classList.remove('active-pin');
                this._icon.classList.remove('visited-pin');
            }
        });

        // Re-apply the correct visual state when Leaflet pulls it out of the bin
        marker.on('add', function () {
            if (this._icon) {
                if (userVisitedPlaces.has(this._parkData.id)) this._icon.classList.add('visited-pin');
                if (activePinMarker === this) this._icon.classList.add('active-pin');
            }
        });

        marker.on('click', () => {
            if (activePinMarker && activePinMarker._icon) {
                activePinMarker._icon.classList.remove('active-pin');
            }
            if (marker._icon) {
                marker._icon.classList.add('active-pin');
            }
            activePinMarker = marker;

            // 🔥 THE FIX: Reset the scroll position of the panel to the very top
            const panelScrollContainer = document.querySelector('.panel-content');
            if (panelScrollContainer) {
                panelScrollContainer.scrollTop = 0;
            }

            // 🔥 NEW: Auto-collapse filter when a pin is clicked to save screen space
            document.getElementById('filter-panel').classList.add('collapsed');

            // Read data from the marker itself, not from a closure
            const d = marker._parkData;
            titleEl.textContent = d.name || 'Unknown Park';

            const metaContainer = document.getElementById('panel-meta-container');
            if (metaContainer) {
                metaContainer.innerHTML = `
                    <div class="meta-pill">📍 ${d.state || 'N/A'}</div>
                    <div class="meta-pill">🏷️ ${d.swagType}</div>
                    <div class="meta-pill">💰 ${d.cost || 'Free'}</div>
                `;
            }

            const suggestEditBtn = document.getElementById('suggest-edit-btn');
            if (suggestEditBtn) {
                const subject = encodeURIComponent(`B.A.R.K. Map Edit: ${d.name}`);
                const body = encodeURIComponent(`Park Name: ${d.name}\nID: ${d.id}\n\n--- Please describe the update below ---\n`);
                suggestEditBtn.href = `mailto:usbarkrangers@gmail.com?subject=${subject}&body=${body}`;
            }

            // --- FIXED UPDATES & REPORTS LOGIC ---
            if (d.info) {
                infoSection.style.display = 'block';
                const container = document.getElementById('panel-info-container');
                const showMoreBtn = document.getElementById('show-more-info');
                infoEl.innerHTML = d.info.replace(/\n/g, '<br>');

                // Show "More" button if character count > 250 OR if it has many line breaks
                const hasManyLines = (infoEl.innerHTML.match(/<br>/g) || []).length > 4;

                if (d.info.length > 250 || hasManyLines) {
                    container.classList.add('report-collapsed');
                    showMoreBtn.style.display = 'block';
                    showMoreBtn.onclick = () => {
                        container.classList.remove('report-collapsed');
                        showMoreBtn.style.display = 'none';
                    };
                } else {
                    container.classList.remove('report-collapsed');
                    showMoreBtn.style.display = 'none';
                }
            } else {
                infoSection.style.display = 'none';
                infoEl.innerHTML = '';
            }

            if (d.pics && typeof d.pics === 'string') {
                const formattedPics = formatSwagLinks(d.pics);
                if (formattedPics.includes('<a ')) {
                    picsEl.style.display = 'grid';
                    picsEl.innerHTML = formattedPics;
                } else {
                    picsEl.style.display = 'none';
                }
            } else {
                picsEl.style.display = 'none';
            }

            if (d.video && typeof d.video === 'string' && d.video.startsWith('http')) {
                videoEl.style.display = 'block';
                videoEl.href = d.video;
            } else {
                videoEl.style.display = 'none';
            }

            websitesContainer.innerHTML = '';
            if (d.website && typeof d.website === 'string') {
                const urlRegex = /(https?:\/\/[^\s]+)/g;
                const urls = d.website.match(urlRegex);
                if (urls && urls.length > 0) {
                    websitesContainer.style.display = 'grid';
                    urls.forEach((url, index) => {
                        const link = document.createElement('a');
                        link.href = url.replace(/['",]+$/, '');
                        link.target = '_blank';
                        link.className = 'website-btn';
                        link.textContent = urls.length > 1 ? `Website ${index + 1}` : 'Official Website';
                        websitesContainer.appendChild(link);
                    });
                } else {
                    websitesContainer.style.display = 'none';
                }
            } else {
                websitesContainer.style.display = 'none';
            }

            // --- FIXED MAP URLS & BUTTON RENDERING ---
            const stickyFooter = document.getElementById('panel-sticky-footer');
            if (stickyFooter) {
                stickyFooter.style.display = 'grid';
                // Corrected Google Maps URL and added Apple Maps search protocol
                stickyFooter.innerHTML = `
                    <a href="https://www.google.com/maps/search/?api=1&query=${d.lat},${d.lng}" target="_blank" class="dir-btn">🗺️ Google</a>
                    <a href="http://maps.apple.com/?q=${encodeURIComponent(d.name)}&ll=${d.lat},${d.lng}" target="_blank" class="dir-btn">🧭 Apple</a>
                    <button class="glass-btn btn-trip">➕ Add to Trip</button>
                `;

                const btnTrip = stickyFooter.querySelector('.btn-trip');
                if (btnTrip) {
                    const syncPopupUI = () => {
                        const inTripDay = Array.from(tripDays).findIndex(day => day.stops.some(s => s.id === d.id));
                        if (inTripDay > -1) {
                            btnTrip.innerHTML = `✓ In Trip (Day ${inTripDay + 1})`;
                            btnTrip.style.background = '#e8f5e9';
                            btnTrip.style.borderColor = '#4CAF50';
                            btnTrip.style.color = '#2E7D32';
                        } else {
                            btnTrip.innerHTML = `➕ Add to Trip`;
                            btnTrip.style.background = '#fff';
                            btnTrip.style.borderColor = '#cbd5e1';
                            btnTrip.style.color = '#333';
                        }
                    };

                    syncPopupUI();

                    btnTrip.onclick = (e) => {
                        e.preventDefault();
                        if (window.addStopToTrip({ id: d.id, name: d.name, lat: d.lat, lng: d.lng })) {
                            syncPopupUI();
                        }
                    };
                }
            }

            const visitedSection = document.getElementById('panel-visited-section');
            const markVisitedBtn = document.getElementById('mark-visited-btn');
            const markVisitedText = document.getElementById('mark-visited-text');
            const verifyBtn = document.getElementById('verify-checkin-btn');
            const verifyBtnText = document.getElementById('verify-checkin-text');

            if (visitedSection && markVisitedBtn && markVisitedText && verifyBtn) {
                if (typeof firebase !== 'undefined' && firebase.auth().currentUser) {
                    visitedSection.style.display = 'block';

                    if (userVisitedPlaces.has(d.id)) {
                        const cachedObj = userVisitedPlaces.get(d.id);

                        markVisitedBtn.classList.add('visited');
                        markVisitedText.textContent = '✓ Visited';
                        
                        // Delete logic styling if setting is flipped
                        if (allowUncheck && !cachedObj.verified) {
                            markVisitedBtn.disabled = false;
                            markVisitedBtn.style.cursor = 'pointer';
                            markVisitedBtn.style.opacity = '1';
                            markVisitedBtn.style.background = '#4CAF50';
                            
                            // Visual cue on hover to delete
                            markVisitedBtn.onmouseenter = () => markVisitedText.textContent = '✖ Remove Check-in';
                            markVisitedBtn.onmouseleave = () => markVisitedText.textContent = '✓ Visited';
                        } else {
                            markVisitedBtn.disabled = true;
                            markVisitedBtn.style.cursor = 'default';
                            markVisitedBtn.style.opacity = '0.7';
                            markVisitedBtn.onmouseenter = null;
                            markVisitedBtn.onmouseleave = null;
                        }

                        if (cachedObj.verified) {
                            verifyBtn.style.background = '#4CAF50';
                            verifyBtnText.textContent = '🐾 Verified & Secured';
                            verifyBtn.disabled = true;
                            verifyBtn.style.cursor = 'default';
                            verifyBtn.style.opacity = '0.7';
                        } else {
                            verifyBtn.style.background = '#FF9800';
                            verifyBtnText.textContent = '🐾 Verified Check-In';
                            verifyBtn.disabled = false;
                            verifyBtn.style.cursor = 'pointer';
                            verifyBtn.style.opacity = '1';
                        }
                    } else {
                        markVisitedBtn.classList.remove('visited');
                        markVisitedText.textContent = 'Mark as Visited';
                        markVisitedBtn.disabled = false;
                        markVisitedBtn.style.cursor = 'pointer';
                        markVisitedBtn.style.opacity = '1';
                        markVisitedBtn.onmouseenter = null;
                        markVisitedBtn.onmouseleave = null;

                        verifyBtn.style.background = '#FF9800';
                        verifyBtnText.textContent = '🐾 Verified Check-In';
                        verifyBtn.disabled = false;
                        verifyBtn.style.cursor = 'pointer';
                        verifyBtn.style.opacity = '1';
                    }

                    verifyBtn.onclick = () => {
                        if (!navigator.geolocation) {
                            alert("Geolocation is not supported by your browser.");
                            return;
                        }
                        verifyBtnText.textContent = 'Locating...';

                        navigator.geolocation.getCurrentPosition((position) => {
                            const dist = haversineDistance(position.coords.latitude, position.coords.longitude, d.lat, d.lng);
                            if (dist <= 25) {
                                alert(`Check-in Verified! You earned 2 points.`);
                                const newObj = { id: d.id, name: d.name, lat: d.lat, lng: d.lng, verified: true, ts: Date.now() };

                                incrementRequestCount();
                                const docRef = firebase.firestore().collection('users').doc(firebase.auth().currentUser.uid);

                                userVisitedPlaces.set(d.id, newObj); // Overwrite local map memory
                                const updatedArray = Array.from(userVisitedPlaces.values()); // Flatten map to array
                                docRef.update({ visitedPlaces: updatedArray }); // Execute a single, clean network write

                                verifyBtn.style.background = '#4CAF50';
                                verifyBtnText.textContent = '🐾 Verified & Secured';
                                verifyBtn.disabled = true;
                                verifyBtn.style.cursor = 'default';
                                verifyBtn.style.opacity = '0.7';

                                markVisitedBtn.classList.add('visited');
                                markVisitedText.textContent = '✓ Visited';
                                markVisitedBtn.disabled = true;
                                markVisitedBtn.style.cursor = 'default';
                                markVisitedBtn.style.opacity = '0.7';

                                updateMarkers();
                                updateStatsUI();
                                window.attemptDailyStreakIncrement();
                            } else {
                                alert(`Out of Range! You are ${dist.toFixed(1)} km away. You must be within 25 km to verify.`);
                                verifyBtnText.textContent = '🐾 Verified Check-In';
                            }
                        }, (error) => {
                            if (error.code === error.PERMISSION_DENIED) {
                                alert("Location permission denied. GPS is required for verified check-ins.");
                            } else {
                                alert("Failed to get location. Try again later.");
                            }
                            verifyBtnText.textContent = '🐾 Verified Check-In';
                        }, { enableHighAccuracy: true });
                    };

                    markVisitedBtn.onclick = async () => {
                        // Deletion execution logic
                        if (userVisitedPlaces.has(d.id)) {
                            const cachedObj = userVisitedPlaces.get(d.id);
                            if (allowUncheck && !cachedObj.verified) {
                                // Undo manual visit
                                userVisitedPlaces.delete(d.id);
                                markVisitedBtn.classList.remove('visited');
                                markVisitedText.textContent = 'Mark as Visited';
                                markVisitedBtn.onmouseenter = null;
                                markVisitedBtn.onmouseleave = null;
                                
                                // Direct sync
                                const updatedArray = Array.from(userVisitedPlaces.values());
                                await firebase.firestore().collection('users').doc(firebase.auth().currentUser.uid).update({ visitedPlaces: updatedArray });

                                updateMarkers();
                                updateStatsUI();
                                evaluateAchievements();
                            }
                            return; 
                        }

                        const newObj = { id: d.id, name: d.name, lat: d.lat, lng: d.lng, verified: false, ts: Date.now() };
                        userVisitedPlaces.set(d.id, newObj);

                        markVisitedBtn.classList.add('visited');
                        markVisitedBtn.disabled = true;

                        await syncUserProgress();
                        updateMarkers();
                        window.attemptDailyStreakIncrement();
                    };
                } else {
                    visitedSection.style.display = 'none';
                }
            }

            // 🎯 SMART AUTO-PAN (No Zoom, Correct Desktop Offset)
            // Locks the current zoom level so it never zooms in or out
            const currentZoom = map.getZoom();

            // Negative X: Shifts camera left, pushing the pin RIGHT (out from under your left panel)
            // Positive Y: Shifts camera down, pushing the pin UP (out from under mobile bottom panel)
            const xOffset = window.innerWidth >= 768 ? -250 : 0;
            const yOffset = window.innerWidth < 768 ? 180 : 0;

            // Project coordinates to flat pixels, apply the offset, and unproject back to GPS
            const targetPoint = map.project([d.lat, d.lng], currentZoom).add([xOffset, yOffset]);
            const targetLatLng = map.unproject(targetPoint, currentZoom);

            // Use panTo instead of setView to guarantee it only moves the camera X/Y
            map.panTo(targetLatLng, { 
                animate: !instantNav, 
                duration: instantNav ? 0 : 0.5 
            });

            slidePanel.classList.add('open');
        });

        allPoints.push({
            id: id,
            name: name || '',
            state: state || '',
            swagType: swagType,
            category: parkCategory,
            lat: lat,
            lng: lng,
            marker: marker
        });
    });
    updateMarkers();
    updateStatsUI();

    // Restore the previously active pin if it still exists in the new data
    if (activeLat !== null && activeLng !== null) {
        const match = allPoints.find(p => {
            const d = p.marker._parkData;
            return d && parseFloat(d.lat) === parseFloat(activeLat) && parseFloat(d.lng) === parseFloat(activeLng);
        });
        if (match) {
            activePinMarker = match.marker;
            if (activePinMarker._icon) {
                activePinMarker._icon.classList.add('active-pin');
            }
            // Panel stays open with currently displayed data — no flash
        } else {
            // Pin was removed from the sheet; close the panel
            slidePanel.classList.remove('open');
        }
    }
}

function parseCSVString(csvString) {
    // If a render is already in progress, replace any queued CSV with the newest one
    if (isRendering) {
        pendingCSV = csvString; // keep only the latest pending CSV
        return;
    }
    isRendering = true;
    Papa.parse(csvString, {
        header: true,
        dynamicTyping: true,
        complete: function (results) {
            processParsedResults(results);
            isRendering = false;
            // Process the most recent pending CSV, if any
            if (pendingCSV) {
                const next = pendingCSV;
                pendingCSV = null;
                parseCSVString(next);
            }
        },
        error: function (err) {
            console.error('Error parsing CSV data:', err);
            isRendering = false;
        }
    });
}

// Simple hash function to reliably detect changes
function quickHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const ch = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + ch;
        hash |= 0;
    }
    return hash;
}

let lastDataHash = null;
let pollInFlight = false; // Prevent overlapping fetches
let latestRequestId = 0; // Incremented each poll to track newest fetch

let seenHashes = new Map(); // tracks first-seen timestamp of each data hash

function pollForUpdates() {
    if (!navigator.onLine || pollInFlight) return Promise.resolve();

    try {
        incrementRequestCount(); // Count the data poll request
    } catch (e) {
        // Propagate the kill-switch error to safeDataPoll
        return Promise.reject(e);
    }

    pollInFlight = true;

    const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRMM2ZRU5lmT-ncrsil4W3qhrbo8NBxnQ-xC877TNkhLYOpTlnCocYA9gNg-dPRyaQr_8e0CWZ0WB2F/pub?output=csv';

    // Prevent hanging requests from locking the polling system forever
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6-second timeout

    fetch(csvUrl + '&t=' + Date.now() + '&r=' + Math.random(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
        signal: controller.signal
    })
        .then(res => {
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error('Network response was not ok');
            // return the text and the final redirected URL which contains Google's internal revision timestamp
            return res.text().then(text => ({ newCsv: text, url: res.url }));
        })
        .then(({ newCsv, url }) => {
            if (!newCsv || newCsv.trim().length < 10) return;
            const newHash = quickHash(newCsv);

            if (!seenHashes.has(newHash)) {
                // Try to extract Google's exact internal revision timestamp from the redirected URL
                // e.g. /1774762780000/
                let revisionTime = Date.now();
                const match = /\/([0-9]{13})\//.exec(url);
                if (match) {
                    revisionTime = parseInt(match[1], 10);
                }
                seenHashes.set(newHash, revisionTime);
            }

            if (newHash !== lastDataHash) {
                const newHashTime = seenHashes.get(newHash);
                const currentHashTime = lastDataHash && seenHashes.has(lastDataHash) ? seenHashes.get(lastDataHash) : 0;

                // Stop eventual-consistency flip-flops from Google's distributed CDN servers.
                if (lastDataHash !== null && newHashTime < currentHashTime) {
                    // console.log('Ignored stale edge cache (flip-flop detected across reload)');
                    return;
                }

                // console.log('Map data changed! Hash:', lastDataHash, '->', newHash);
                lastDataHash = newHash;
                localStorage.setItem('barkCSV', newCsv);
                localStorage.setItem('barkCSV_time', newHashTime.toString());
                parseCSVString(newCsv);
            }
        })
        .catch(err => {
            if (err.name === 'AbortError') {
                console.warn('Poll request timed out after 6s. Retry next cycle.');
            } else {
                console.error('Poll Error:', err);
            }
        })
        .finally(() => {
            pollInFlight = false;
        });
}

// ── Safe Background Data Polling ──
let dataPollErrorCount = 0;
async function safeDataPoll() {
    // 1. Check Visibility API (Save costs when tab is inactive)
    if (document.hidden) {
        setTimeout(safeDataPoll, 15000); // 15s when inactive
        return;
    }
    try {
        await pollForUpdates();
        dataPollErrorCount = 0;
    } catch (err) {
        if (err.message && err.message.includes("Safety Shutdown")) {
            console.error("KILL SWITCH: Terminating Data Poll.");
            return; // STOP THE LOOP
        }
        dataPollErrorCount++;
        console.error("Data poll failed, backing off...");
    }
    // 2. Adaptive Back-off: If it fails 5 times, slow down to 1 minute
    const interval = dataPollErrorCount > 5 ? 60000 : 3000;
    setTimeout(safeDataPoll, interval);
}
safeDataPoll();

function loadData() {
    const cachedCsv = localStorage.getItem('barkCSV');
    const cachedTime = localStorage.getItem('barkCSV_time');
    const isPremium = localStorage.getItem('premiumLoggedIn') === 'true';

    if (cachedCsv) {
        lastDataHash = quickHash(cachedCsv);
        if (cachedTime) {
            seenHashes.set(lastDataHash, parseInt(cachedTime, 10));
        } else {
            seenHashes.set(lastDataHash, Date.now()); // fallback
        }
        parseCSVString(cachedCsv);
    }

    if (!navigator.onLine) {
        if (!isPremium && !cachedCsv) {
            alert('Network disconnected. Log in via the Profile tab to enable Premium Offline Mode.');
            markerLayer.clearLayers();
        }
        return;
    }

    pollForUpdates();
}

// (Replaced by safeDataPoll above)

function updateMarkers() {
    markerLayer.clearLayers();
    markerClusterGroup.clearLayers();
    
    let visibleBounds = L.latLngBounds(); // 🎯 Track the boundaries

    allPoints.forEach(item => {
        const matchesSwag = activeSwagFilters.size === 0 || activeSwagFilters.has(item.swagType);

        const queryNorm = normalizeText(activeSearchQuery);
        const nameNorm = normalizeText(item.name);

        let matchesSearch = false;
        if (!queryNorm) {
            matchesSearch = true;
        } else if (nameNorm.includes(queryNorm)) {
            matchesSearch = true;
        } else {
            let minDist = levenshtein(queryNorm, nameNorm);
            const tokens = nameNorm.split(' ');
            for (const word of tokens) {
                if (queryNorm.length > 2) {
                    minDist = Math.min(minDist, levenshtein(queryNorm, word));
                }
            }
            if (minDist <= 2) matchesSearch = true;
        }

        const matchesType = activeTypeFilter === 'all' || item.category === activeTypeFilter;

        let matchesVisited = true;
        const isVisited = userVisitedPlaces.has(item.id);

        if (visitedFilterState === 'visited' && !isVisited) matchesVisited = false;
        if (visitedFilterState === 'unvisited' && isVisited) matchesVisited = false;

        // --- DYNAMIC VISIBILITY GATE ---
        const isInTrip = Array.from(tripDays).some(day => day.stops.some(s => s.id === item.id));

        if ((matchesSwag && matchesSearch && matchesType && matchesVisited) || isInTrip) {
            // THE STRICT FORK: Where does the pin go?
            if (clusteringEnabled) {
                markerClusterGroup.addLayer(item.marker);
            } else {
                markerLayer.addLayer(item.marker);
            }
            
            visibleBounds.extend(item.marker.getLatLng()); // 🎯 Expand the invisible frame

            if (item.marker._icon) {
                if (isVisited) {
                    item.marker._icon.classList.add('visited-pin');
                } else {
                    item.marker._icon.classList.remove('visited-pin');
                }
            }
        }
    });

    // Handle Map Layer Assignment
    if (clusteringEnabled) {
        if (!map.hasLayer(markerClusterGroup)) map.addLayer(markerClusterGroup);
        if (map.hasLayer(markerLayer)) map.removeLayer(markerLayer);
    } else {
        if (!map.hasLayer(markerLayer)) map.addLayer(markerLayer);
        if (map.hasLayer(markerClusterGroup)) map.removeLayer(markerClusterGroup);
    }

    // 🎯 SMART AUTO-FRAMING (Interrupt Protection)
    // Only swoop the camera if the user actually changed the search/filter criteria
    const currentFilterState = activeSearchQuery + '|' + Array.from(activeSwagFilters).join(',');

    if (window._lastFilterState !== currentFilterState) {
        window._lastFilterState = currentFilterState;

        if ((activeSwagFilters.size > 0 || activeSearchQuery.length > 2) && visibleBounds.isValid()) {
            map.flyToBounds(visibleBounds, { 
                padding: [50, 50], 
                maxZoom: 12, 
                duration: instantNav ? 0 : 0.8,
                animate: !instantNav
            });
        }
    }
}

// Event Listeners
const searchSuggestions = document.getElementById('search-suggestions');
let searchTimeout = null;

searchInput.addEventListener('input', (e) => {
    activeSearchQuery = e.target.value;

    if (clearSearchBtn) {
        clearSearchBtn.style.display = activeSearchQuery.length > 0 ? 'block' : 'none';
    }

    if (searchTimeout) clearTimeout(searchTimeout);

    if (activeSearchQuery.trim() === '') {
        if (searchSuggestions) searchSuggestions.style.display = 'none';
        updateMarkers();
        return;
    }

    searchTimeout = setTimeout(() => {
        const queryNorm = normalizeText(activeSearchQuery);
        let matches = [];

        allPoints.forEach(item => {
            const nameNorm = normalizeText(item.name);
            let score = 999;

            if (nameNorm.includes(queryNorm)) {
                score = 0;
            } else {
                let minDist = levenshtein(queryNorm, nameNorm);
                const tokens = nameNorm.split(' ');
                for (const word of tokens) {
                    if (queryNorm.length > 2) {
                        minDist = Math.min(minDist, levenshtein(queryNorm, word));
                    }
                }
                if (minDist <= 2) score = minDist;
            }

            if (score <= 2) {
                matches.push({ item: item, score: score });
            }
        });

        matches.sort((a, b) => a.score - b.score);
        const topMatches = matches.slice(0, 10);

        searchSuggestions.innerHTML = '';

        // 1. Render local map matches
        if (topMatches.length > 0) {
            topMatches.forEach(match => {
                const div = document.createElement('div');
                div.className = 'suggestion-item';
                div.textContent = match.item.name + (match.item.state ? `, ${match.item.state}` : '');
                div.addEventListener('click', () => {
                    searchInput.value = match.item.name;
                    activeSearchQuery = match.item.name;
                    searchSuggestions.style.display = 'none';
                    updateMarkers();

                    if (match.item.marker && match.item.marker._parkData) {
                        map.setView([match.item.marker._parkData.lat, match.item.marker._parkData.lng], 12, { 
                            animate: !instantNav,
                            duration: instantNav ? 0 : 0.4
                        });
                        match.item.marker.fire('click');
                    }
                });
                searchSuggestions.appendChild(div);
            });
        }

        // 2. BLENDED FALLBACK: Always offer global search if query is > 2 chars
        if (activeSearchQuery.trim().length > 2) {
            const isPremium = (typeof firebase !== 'undefined' && firebase.auth().currentUser !== null);

            if (topMatches.length === 0 && isPremium) {
                // If NO local matches, show the "Searching..." status and auto-trigger
                const statusDiv = document.createElement('div');
                statusDiv.className = 'suggestion-item';
                statusDiv.style.cssText = 'background: #fdf4ff; color: #c026d3; font-weight: 700; border-top: 1px solid #f0abfc;';
                statusDiv.innerHTML = `🔍 Searching for "${activeSearchQuery}"...`;
                searchSuggestions.appendChild(statusDiv);
                executeGeocode(activeSearchQuery, 'stop');
            } else {
                // If local matches EXIST, show the manual Federated Fallback button
                const federatedBtn = document.createElement('div');
                federatedBtn.className = 'suggestion-item';
                federatedBtn.style.cssText = 'background: #f0fdf4; color: #15803d; font-weight: 700; border-top: 1px solid #bbf7d0; display: flex; align-items: center; gap: 8px; cursor: pointer; margin-top: 4px;';
                federatedBtn.innerHTML = `🌍 <div>Search towns & cities for "${activeSearchQuery}"<br><span style="font-size:10px; font-weight:normal; color:#166534;">Query global database</span></div>`;

                federatedBtn.addEventListener('click', () => {
                    if (!isPremium) {
                        alert('Searching for custom towns and locations is a Premium feature. Please log in via the Profile tab.');
                        return;
                    }
                    const queryToFetch = activeSearchQuery;
                    searchInput.value = `Searching for "${queryToFetch}"...`;
                    searchSuggestions.style.display = 'none';
                    executeGeocode(queryToFetch, 'stop');
                });

                // Show a locked state if not premium
                if (!isPremium) {
                    federatedBtn.style.opacity = '0.7';
                    federatedBtn.innerHTML = `🔒 <div style="color:#64748b;">Search global towns for "${activeSearchQuery}"<br><span style="font-size:10px; font-weight:normal;">Sign in to unlock global routing</span></div>`;
                }

                searchSuggestions.appendChild(federatedBtn);
            }
        }

        if (searchSuggestions.innerHTML !== '') {
            searchSuggestions.style.display = 'block';
        } else {
            searchSuggestions.style.display = 'none';
        }

        updateMarkers();
    }, 300);
});

// Hide dropdown when clicking outside
document.addEventListener('click', (e) => {
    if (searchSuggestions && searchSuggestions.style.display === 'block') {
        if (!searchSuggestions.contains(e.target) && e.target !== searchInput) {
            searchSuggestions.style.display = 'none';
        }
    }
});

// Reshow dropdown when focusing search bar (if there are matches)
searchInput.addEventListener('focus', () => {
    if (searchSuggestions && searchSuggestions.innerHTML.trim() !== '' && activeSearchQuery.length > 0) {
        searchSuggestions.style.display = 'block';
    }
});

if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        activeSearchQuery = '';
        clearSearchBtn.style.display = 'none';
        if (searchSuggestions) searchSuggestions.style.display = 'none';
        updateMarkers();
        searchInput.focus();
    });
}

typeSelect.addEventListener('change', (e) => {
    activeTypeFilter = e.target.value;
    updateMarkers();
});

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-filter');

        if (activeSwagFilters.size === 0) {
            activeSwagFilters.add(type);
            btn.classList.add('active');
        } else {
            if (activeSwagFilters.has(type)) {
                activeSwagFilters.delete(type);
                btn.classList.remove('active');
            } else {
                activeSwagFilters.add(type);
                btn.classList.add('active');
            }
        }

        if (activeSwagFilters.size === 0) {
            filterBtns.forEach(b => b.classList.remove('active'));
        }

        updateMarkers();
    });
});

// Profile Authentication Logic
const loginContainer = document.getElementById('login-container');
const offlineStatusContainer = document.getElementById('offline-status-container');
const logoutBtn = document.getElementById('logout-btn');

let visitedSnapshotUnsubscribe = null;

// ── Module-level saved routes loader (needs firebase globally available) ──
window._lastSavedRouteDoc = null;

async function loadSavedRoutes(uid, isLoadMore = false) {
    const savedList = document.getElementById('saved-routes-list');
    const plannerList = document.getElementById('planner-saved-routes-list');
    const savedCount = document.getElementById('saved-routes-count');

    if (!savedList && !plannerList) return;

    if (!isLoadMore) {
        window._lastSavedRouteDoc = null;
        const renderTo = (container) => {
            if (!container) return;
            container.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">Loading...</p>';
        };
        renderTo(savedList);
        renderTo(plannerList);
    } else {
        // Remove existing "Load More" buttons before appending new contents
        document.querySelectorAll('.load-more-routes-btn').forEach(btn => btn.remove());
    }

    try {
        const fetchLimit = isLoadMore ? 5 : 3;
        incrementRequestCount(); // Count Firestore Route Fetch

        let query = firebase.firestore()
            .collection('users').doc(uid)
            .collection('savedRoutes')
            .orderBy('createdAt', 'desc');

        if (isLoadMore && window._lastSavedRouteDoc) {
            query = query.startAfter(window._lastSavedRouteDoc);
        }

        const snapshot = await query.limit(fetchLimit).get();

        // Update count ONLY on initial load
        if (!isLoadMore && savedCount) {
            // To get accurate size without burning reads, we'd need an aggregation query.
            // For now, we'll just indicate total loaded or 3+ if it hit the limit.
            savedCount.textContent = snapshot.size === fetchLimit ? `${fetchLimit}+` : snapshot.size;
        } else if (isLoadMore && savedCount && snapshot.size > 0) {
            // Just update the total loaded indicator
            const currentObj = parseInt(savedCount.textContent) || 0;
            savedCount.textContent = snapshot.size === fetchLimit ? `${currentObj + snapshot.size}+` : (currentObj + snapshot.size);
        }

        // Save the cursor
        if (!snapshot.empty) {
            window._lastSavedRouteDoc = snapshot.docs[snapshot.docs.length - 1];
        }

        const populateList = (list) => {
            if (!list) return;
            
            if (snapshot.empty && !isLoadMore) {
                list.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">No saved routes yet. Generate a route to save it here!</p>';
                return;
            }

            if (!isLoadMore) {
                list.innerHTML = '';
            }

            snapshot.forEach(doc => {
                const data = doc.data();
                const date = data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'Unknown date';
                const dayCount = data.tripDays ? data.tripDays.length : 0;
                const stopCount = data.tripDays ? data.tripDays.reduce((s, d) => s + (d.stops ? d.stops.length : 0), 0) : 0;

                const colorDots = (data.tripDays || []).map(d =>
                    `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${d.color || '#999'}; margin-right:2px;"></span>`
                ).join('');

                const tripName = data.tripName || "Untitled Route";

                const card = document.createElement('div');
                card.style.cssText = 'background:#f9f9f9; border-radius:10px; padding:10px 12px; margin-bottom:8px; border:1px solid rgba(0,0,0,0.06);';
                card.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
                        <div>
                            <div style="font-weight:800; font-size:14px; color:#1a1a1a; margin-bottom:2px;">${tripName}</div>
                            <div style="font-weight:600; font-size:12px; color:#555; margin-bottom:4px;">
                                ${colorDots} ${dayCount} day${dayCount !== 1 ? 's' : ''} · ${stopCount} stop${stopCount !== 1 ? 's' : ''}
                            </div>
                            <div style="font-size:11px; color:#888;">${date}</div>
                        </div>
                        <div style="display:flex; gap:6px; align-items:center; flex-shrink:0;">
                            <button class="load-route-btn" data-id="${doc.id}" style="background:#22c55e; color:white; border:none; border-radius:8px; padding:5px 10px; font-size:12px; cursor:pointer; font-weight:600;">Load</button>
                            <button class="delete-route-btn" data-id="${doc.id}" style="background:none; border:none; color:#dc2626; font-size:14px; cursor:pointer; font-weight:bold;" title="Delete">×</button>
                        </div>
                    </div>
                `;
                list.appendChild(card);
            });

            // Rebind the button handlers for the newly added routes
            list.querySelectorAll('.load-route-btn').forEach(btn => {
                btn.onclick = async () => {
                    const docId = btn.getAttribute('data-id');
                    incrementRequestCount(); // Count Firestore Document Get
                    const docSnap = await firebase.firestore()
                        .collection('users').doc(uid)
                        .collection('savedRoutes').doc(docId).get();
                    if (!docSnap.exists) return;
                    const data = docSnap.data();
                    tripDays = data.tripDays.map(d => ({ color: d.color, stops: d.stops, notes: d.notes || "" }));
                    activeDayIdx = 0;

                    const tripNameInput = document.getElementById('tripNameInput');
                    if (tripNameInput) tripNameInput.value = data.tripName || "";

                    updateTripUI();

                    // If we loaded from the planner list, hide it automatically
                    const plannerContainer = document.getElementById('planner-saved-routes-container');
                    if (plannerContainer) plannerContainer.style.display = 'none';

                    document.querySelector('[data-target="map-view"]')?.click();
                    showTripToast(`Route Loaded: ${data.tripName || "Untitled"}`);
                };
            });

            list.querySelectorAll('.delete-route-btn').forEach(btn => {
                btn.onclick = async () => {
                    if (!confirm('Delete this saved route?')) return;
                    incrementRequestCount(); // Count Firestore Delete
                    await firebase.firestore()
                        .collection('users').doc(uid)
                        .collection('savedRoutes').doc(btn.getAttribute('data-id')).delete();
                    loadSavedRoutes(uid); // This will reset and reload from top
                };
            });

            // If we actually hit the limit, there might be more routes, so add the "Load More" button
            if (snapshot.size === fetchLimit) {
                const loadMoreBtn = document.createElement('button');
                loadMoreBtn.className = 'load-more-routes-btn';
                loadMoreBtn.textContent = 'Load More (+5)';
                loadMoreBtn.style.cssText = 'width: 100%; background: rgba(0,0,0,0.05); border: 1px dashed rgba(0,0,0,0.2); border-radius: 8px; padding: 10px; font-size: 13px; cursor: pointer; color: #555; font-weight: 700; margin-top: 5px;';
                loadMoreBtn.onclick = () => loadSavedRoutes(uid, true);
                list.appendChild(loadMoreBtn);
            }
        };

        populateList(savedList);
        populateList(plannerList);
    } catch (error) {
        console.error("Error loading routes:", error);
    }
}

window.togglePlannerRoutes = function () {
    const container = document.getElementById('planner-saved-routes-container');
    if (!container) return;

    if (container.style.display === 'none') {
        container.style.display = 'block';
        const user = firebase.auth().currentUser;
        if (user) {
            loadSavedRoutes(user.uid);
        } else {
            const list = document.getElementById('planner-saved-routes-list');
            if (list) list.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">Please log in to see saved routes.</p>';
        }
    } else {
        container.style.display = 'none';
    }
};

if (typeof firebase !== 'undefined') {
    const firebaseConfig = {
        apiKey: "AIzaSyDcBn2YQCAFrAjN27gIM9lBiu0PZsComO4",
        authDomain: "barkrangermap-auth.firebaseapp.com",
        projectId: "barkrangermap-auth",
        storageBucket: "barkrangermap-auth.firebasestorage.app",
        messagingSenderId: "564465144962",
        appId: "1:564465144962:web:9e43dbc993b93a33d5d09b",
        measurementId: "G-V2QCN2MFBZ"
    };

    firebase.initializeApp(firebaseConfig);

    firebase.auth().onAuthStateChanged((user) => {
        // Redefine globals strictly as window variables for cross-component stability
        window._lastSyncedScore = window._lastSyncedScore || 0;
        window.isAdmin = false;
        window._serverPayloadSettled = false;
        window._firstServerPayloadReceived = false;
        window._lastKnownRank = null;
        window.currentWalkPoints = window.currentWalkPoints || 0;

        const profileName = document.getElementById('user-profile-name');

        if (user) {
            // Reset hydration locks on login
            window._serverPayloadSettled = false;
            window._firstServerPayloadReceived = false;
            // 🏆 FORCE first leaderboard sync on every login to guarantee
            // leaderboard/{uid} stays in sync with the actual score.
            window._lastSyncedScore = -1;

            if (loginContainer) loginContainer.style.display = 'none';
            if (offlineStatusContainer) offlineStatusContainer.style.display = 'block';
            if (logoutBtn) logoutBtn.style.display = 'block';
            if (profileName) profileName.textContent = user.displayName || user.email || 'Bark Ranger';

            incrementRequestCount(); // Count initial snapshot fetch
            visitedSnapshotUnsubscribe = firebase.firestore().collection('users').doc(user.uid)
                .onSnapshot((doc) => {
                    // Monitor when the first authoritative server payload arrives vs local cache
                    if (!doc.metadata.fromCache && !window._firstServerPayloadReceived) {
                        window._firstServerPayloadReceived = true;
                        // Give the UI 1000ms to finish evaluating the massive server data spike before unlocking the celebration engine
                        setTimeout(() => { window._serverPayloadSettled = true; }, 1000);
                    }

                    if (doc.exists) {
                        const data = doc.data();
                        const placeList = data.visitedPlaces || [];

                        // Admin Dashboard Reveal
                        const adminContainer = document.getElementById('admin-controls-container');
                        window.isAdmin = data.isAdmin === true;

                        if (adminContainer) {
                            if (window.isAdmin) {
                                adminContainer.innerHTML = `
                                    <div style="display: flex; gap: 8px; flex-direction: column;">
                                        <button onclick="window.location.href='admin.html'" class="glass-btn primary-btn" style="width: 100%; background: #10b981; color: white; border: none; padding: 14px; border-radius: 12px; font-weight: 800; display: flex; justify-content: center; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"></path></svg>
                                            Enter Data Refinery
                                        </button>
                                        <button onclick="adminEditPoints()" class="glass-btn" style="width: 100%; background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; padding: 10px; border-radius: 10px; font-size: 11px; font-weight: 800; letter-spacing: 0.5px;">
                                            ⚙️ EDIT TEST POINTS (ADMIN)
                                        </button>
                                    </div>`;
                            } else {
                                adminContainer.innerHTML = '';
                            }
                        }

                        // New: Fetch and sync streak & walk points
                        const streakVal = data.streakCount || 0;
                        let walkVal = data.walkPoints || 0;
                        const lifetimeVal = data.lifetime_miles || 0;

                        // 🎯 BOUNTY FIX: Self-Correction Logic
                        // If walkPoints is lagging behind lifetime_miles (due to a legacy bug),
                        // we auto-correct it here to ensure the user gets credit for every mile walked.
                        if (lifetimeVal > walkVal) {
                            // console.log(`Bounty Hunter: Correcting point/mileage discrepancy (${walkVal} < ${lifetimeVal})`);
                            walkVal = lifetimeVal;
                            // Silently sync back to Firestore
                            firebase.firestore().collection('users').doc(user.uid).update({ walkPoints: lifetimeVal });
                        }

                        const streakLabel = document.getElementById('streak-count-label');
                        if (streakLabel) streakLabel.textContent = streakVal;

                        // Sync window state for evaluateAchievements (sanitize float precision)
                        window.currentWalkPoints = Math.round(walkVal * 100) / 100;
                        // NOTE: Do NOT set _lastSyncedScore here — syncScoreToLeaderboard()
                        // is the sole authority for that value and must compare against it
                        // to decide whether leaderboard/{uid} needs a write.

                        // Unified Virtual Expedition Sync & State Swap
                        if (data.virtual_expedition && data.virtual_expedition.active_trail) {
                            const miles = data.virtual_expedition.miles_logged || 0;
                            const total = data.virtual_expedition.trail_total_miles || 0;

                            // Trigger the map overlay
                            renderVirtualTrailOverlay(data.virtual_expedition.active_trail, miles);
                            hydrateEducationModal(data.virtual_expedition.active_trail);

                            // Only complete if we have a valid total and miles >= total
                            const isComplete = total > 0 && miles >= total;

                            document.getElementById('expedition-intro-state').style.display = 'none';
                            document.getElementById('expedition-active-state').style.display = isComplete ? 'none' : 'block';
                            document.getElementById('expedition-complete-state').style.display = isComplete ? 'block' : 'none';

                            const nameEl = document.getElementById('expedition-name');
                            if (nameEl) {
                                nameEl.textContent = isComplete ? "CONQUERED" : data.virtual_expedition.trail_name;
                                nameEl.dataset.trailName = data.virtual_expedition.trail_name;
                            }

                            // Populate the celebration UI with trail name and dynamic points
                            if (isComplete) {
                                const celebName = document.getElementById('celebration-trail-name');
                                if (celebName) celebName.textContent = data.virtual_expedition.trail_name;
                                const claimBtn = document.getElementById('claim-reward-btn');
                                const trailPts = Math.max(1, Math.round(total / 2));
                                if (claimBtn) claimBtn.textContent = `🎁 Claim +${trailPts} PTS & Reset`;
                            }

                            const lifetime = data.lifetime_miles || 0;
                            renderExpeditionProgress(miles, total, lifetime);
                            renderExpeditionHistory(data.virtual_expedition.history || [], data.virtual_expedition.trail_name);
                        } else {
                            document.getElementById('expedition-intro-state').style.display = 'block';
                            document.getElementById('expedition-active-state').style.display = 'none';
                            document.getElementById('expedition-complete-state').style.display = 'none';
                            document.getElementById('expedition-name').textContent = '';
                        }

                        // Sync Digital Trophy Case
                        const cExpeditions = data.completed_expeditions || [];
                        renderCompletedExpeditions(cExpeditions);
                        renderCompletedTrailsOverlay(cExpeditions);

                        if (Array.isArray(placeList)) {
                            userVisitedPlaces = new Map();
                            placeList.forEach(obj => {
                                if (obj && obj.id) userVisitedPlaces.set(obj.id, obj);
                            });
                        }
                    } else {
                        userVisitedPlaces = new Map();
                    }
                    updateMarkers();
                    updateStatsUI();

                    // Only run leaderboard fetch AFTER the initial visitedPlaces map is hydrated
                    // This prevents 'localScore' from calculating as 0 on initial page load, which
                    // was causing mathematically incorrect rank queries.
                    if (!window._leaderboardLoadedOnce) {
                        window._leaderboardLoadedOnce = true;
                        loadLeaderboard();
                    }

                    // 🛑 HIDE LOADER HERE (After pins turn green!)
                    window.dismissBarkLoader();

                    if (activePinMarker && activePinMarker._parkData && document.getElementById('mark-visited-btn')) {
                        const d = activePinMarker._parkData;
                        const btn = document.getElementById('mark-visited-btn');
                        const btnText = document.getElementById('mark-visited-text');
                        if (userVisitedPlaces.has(d.id)) {
                            btn.classList.add('visited');
                            btnText.textContent = 'Visited!';
                        } else {
                            btn.classList.remove('visited');
                            btnText.textContent = 'Mark as Visited';
                        }
                    }
                });

            // Load saved routes for this user
            loadSavedRoutes(user.uid);

            // UNLOCK PREMIUM FILTERS
            const premiumWrap = document.getElementById('premium-filters-wrap');
            const visitedSelect = document.getElementById('visited-filter');
            const mapStyleSelect = document.getElementById('map-style-select');
            if (premiumWrap) {
                premiumWrap.classList.remove('premium-locked');
                premiumWrap.classList.add('premium-unlocked');
                if (visitedSelect) visitedSelect.disabled = false;
                if (mapStyleSelect) mapStyleSelect.disabled = false;
            }
        } else {
            if (loginContainer) loginContainer.style.display = 'block';
            if (offlineStatusContainer) offlineStatusContainer.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'none';
            userVisitedPlaces.clear();
            if (visitedSnapshotUnsubscribe) {
                visitedSnapshotUnsubscribe();
                visitedSnapshotUnsubscribe = null;
            }
            updateMarkers();
            updateStatsUI();

            // 🛑 HIDE LOADER HERE FOR GUESTS
            window.dismissBarkLoader();
            // Refresh leaderboard to clear personal rank
            loadLeaderboard();
            // Clear saved routes panel on logout
            const savedList = document.getElementById('saved-routes-list');
            const savedCount = document.getElementById('saved-routes-count');
            if (savedList) savedList.innerHTML = '<p style="color:#aaa; text-align:center; padding:10px 0;">Sign in to view saved routes.</p>';
            if (savedCount) savedCount.textContent = '0';

            // LOCK PREMIUM FILTERS
            const premiumWrap = document.getElementById('premium-filters-wrap');
            const visitedSelect = document.getElementById('visited-filter');
            const mapStyleSelect = document.getElementById('map-style-select');
            if (premiumWrap) {
                premiumWrap.classList.add('premium-locked');
                premiumWrap.classList.remove('premium-unlocked');
                if (visitedSelect) {
                    visitedSelect.disabled = true;
                    visitedSelect.value = 'all';
                }
                if (mapStyleSelect) {
                    mapStyleSelect.disabled = true;
                    mapStyleSelect.value = 'default';
                }
            }
        }
    });

    const googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
            incrementRequestCount(); // Count Login Attempt
            firebase.auth().signInWithPopup(provider).catch(err => {
                console.error("Login Error:", err);
                alert("Login Error: " + err.message);
            });
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            firebase.auth().signOut().catch(err => console.error("Logout Error:", err));
        });
    }

    // Initialize Email Suggestion Template
    const emailSuggestBtn = document.getElementById('email-suggest-btn');
    if (emailSuggestBtn) {
        const subject = encodeURIComponent("B.A.R.K. Map: Suggest a New Place");
        const bodyTemplate = [
            "--- B.A.R.K. Ranger Map Suggestion ---",
            "Park Name:",
            "State:",
            "Swag Available (Tag/Bandana/Certificate/Other):",
            "Cost (Free/$$/Other):",
            "Park Entrance Fee:",
            "ADA Accessibility Areas:",
            "Useful Info / Rules:",
            "Official Website Link:",
            "",
            "--- IMPORTANT ---",
            "Please attach photos of the swag, the park entrance, or any relevant signage to help us verify this location! 🐾"
        ].join("\n");
        emailSuggestBtn.href = `mailto:usbarkrangers@gmail.com?subject=${subject}&body=${encodeURIComponent(bodyTemplate)}`;
    }
}

const visitedFilterEl = document.getElementById('visited-filter');
if (visitedFilterEl) {
    visitedFilterEl.addEventListener('change', (e) => {
        visitedFilterState = e.target.value;
        updateMarkers();
    });
}

// Initial load
loadData();

// Close panel when clicking on map
// Close panel when clicking on map and clear pin
map.on('click', () => {
    slidePanel.classList.remove('open');
    clearActivePin(); // 🔥 Fixes the ghost pin

    // 🔥 NEW: Auto-collapse filter on empty map click
    document.getElementById('filter-panel').classList.add('collapsed');
});

// Auto-collapse filter when user pans/drags the map
map.on('movestart', () => {
    const filterPanel = document.getElementById('filter-panel');
    if (filterPanel && !filterPanel.classList.contains('collapsed')) {
        filterPanel.classList.add('collapsed');
    }
});

// Toggle filter panel
document.getElementById('toggle-filter-btn').addEventListener('click', () => {
    document.getElementById('filter-panel').classList.toggle('collapsed');
});

// Update Manager (Safety Net Refactor)
let pollErrorCount = 0;

async function safePoll() {
    // 1. Check Visibility API (Save costs when tab is inactive)
    if (document.hidden) {
        setTimeout(safePoll, 10000); // Slow down to 10s when inactive
        return;
    }

    try {
        await checkForUpdates();
        pollErrorCount = 0;
    } catch (err) {
        if (err.message && err.message.includes("Safety Shutdown")) {
            console.error("KILL SWITCH: Terminating Version Poll.");
            return; // STOP THE LOOP
        }
        pollErrorCount++;
        console.error("Update check failed, backing off...", err);
    }

    // 2. Adaptive Back-off: If it fails 5 times, slow down significantly (1 min)
    const nextInterval = pollErrorCount > 5 ? 60000 : 30000;
    setTimeout(safePoll, nextInterval);
}

async function checkForUpdates() {
    if (!navigator.onLine || window.location.protocol === 'file:') return;

    incrementRequestCount(); // Track background activity

    const res = await fetch('version.json?cache_bypass=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('version.json not found');

    const data = await res.json();
    if (data.version && data.version > APP_VERSION) {
        const toast = document.getElementById('update-toast');
        if (toast) toast.classList.add('show');
    }
}

// Start the loop
setTimeout(safePoll, 2000);

const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        window.location.reload(true);
    });
}

// CSV Export Logic
const exportCsvBtn = document.getElementById('export-csv-btn');
if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
        if (!allPoints || allPoints.length === 0) {
            alert("Map data hasn't loaded fully yet. Please wait a moment and try again.");
            return;
        }

        const exportData = allPoints.map(p => {
            const data = p.marker._parkData;
            return {
                Name: data.name,
                "Grid-Snap ID": data.id,
                State: data.state,
                Category: data.category || '',
                Cost: data.cost || '',
                "Swag Type": data.swagType || '',
                Latitude: data.lat,
                Longitude: data.lng,
                Visited: userVisitedPlaces.has(data.id) ? 1 : 0
            };
        });

        const csvString = Papa.unparse(exportData);
        const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', 'My_BarkRanger_Data.csv');
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}

/**
 * Leaderboard System (Direct Read — No Cache)
 */
let leaderboardVisibleLimit = 4;
let cachedLeaderboardData = [];

function renderLeaderboard(topUsers) {
    if (topUsers) cachedLeaderboardData = topUsers;
    const data = cachedLeaderboardData;

    const listEl = document.getElementById('leaderboard-list');
    const rankEl = document.getElementById('personal-rank-display');
    const controlsEl = document.getElementById('leaderboard-controls');
    if (!listEl || !rankEl || !controlsEl) return;

    listEl.innerHTML = '';
    const uid = (typeof firebase !== 'undefined' && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : null;
    let personalRank = '--';
    let personalUserObj = null;
    let personalActualRankNum = -1;

    // Phase 1: Determine ranks and identify the current user
    data.forEach((user, index) => {
        let rank = index + 1;
        if (user.isPersonalFallback && user.exactRank) {
            rank = user.exactRank;
        }

        if (user.uid === uid) {
            personalRank = rank;
            personalUserObj = user;
            personalActualRankNum = rank;
        }
    });

    if (rankEl) {
        // Format with commas if over 1000 for neatness
        rankEl.textContent = 'Rank: ' + (personalRank > 1000 ? personalRank.toLocaleString() : personalRank);
    }

    // Helper function to render a user row
    const createRow = (user, rank, isPinnedSelf = false) => {
        const isMe = user.uid === uid;
        const li = document.createElement('li');

        // Base Styles for Podium & Others
        let bg = 'white';
        let border = '1px solid rgba(0,0,0,0.05)';
        let shadow = '0 2px 4px rgba(0,0,0,0.05)';
        let textColor = '#444';
        let rankIcon = `#${rank}`;

        if (isPinnedSelf) {
            bg = 'rgba(59, 130, 246, 0.08)';
            border = '2px dashed #3b82f6';
            shadow = '0 4px 10px rgba(59, 130, 246, 0.2)';
            textColor = '#1e3a8a';
            // Add slight margin above pinned self to separate them
            li.style.marginTop = '15px';
        } else if (rank === 1) {
            bg = 'linear-gradient(135deg, #fde68a, #f59e0b, #d97706)';
            border = '2px solid #b45309';
            shadow = '0 4px 12px rgba(217, 119, 6, 0.3)';
            textColor = '#451a03';
            rankIcon = '👑';
        } else if (rank === 2) {
            bg = 'linear-gradient(135deg, #f1f5f9, #94a3b8, #475569)';
            border = '2px solid #334155';
            shadow = '0 4px 10px rgba(71, 85, 105, 0.2)';
            textColor = '#0f172a';
        } else if (rank === 3) {
            bg = 'linear-gradient(135deg, #ffedd5, #d97706, #92400e)';
            border = '2px solid #78350f';
            shadow = '0 4px 10px rgba(146, 64, 14, 0.2)';
            textColor = '#431407';
        } else if (isMe) {
            bg = 'rgba(59, 130, 246, 0.08)';
            border = '2px solid #3b82f6';
            textColor = '#1e3a8a';
        }

        li.style.cssText = `
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
            padding: 12px 16px; 
            margin-bottom: 10px; 
            border-radius: 14px; 
            background: ${bg}; 
            border: ${border}; 
            box-shadow: ${shadow};
            transition: all 0.3s ease;
        `;

        // Left Section (Rank + Name)
        const leftSide = document.createElement('div');
        leftSide.style.cssText = 'display: flex; align-items: center; gap: 12px;';

        const rankBadge = document.createElement('span');
        rankBadge.textContent = rankIcon;
        rankBadge.style.cssText = `font-weight: 900; font-size: 14px; color: ${textColor}; min-width: 24px;`;

        const nameInfo = document.createElement('div');
        nameInfo.style.cssText = 'display: flex; flex-direction: column;';

        const nameSpan = document.createElement('span');
        nameSpan.style.cssText = `font-weight: 800; font-size: 13px; color: ${textColor};`;
        nameSpan.textContent = `${isPinnedSelf ? 'You' : user.displayName} ${user.hasVerified ? '🐾' : ''}`;

        nameInfo.appendChild(nameSpan);

        // Alpha Dog Hook
        if (isMe && rank === 1) {
            const alphaBadge = document.createElement('span');
            alphaBadge.textContent = '🐺 ALPHA DOG';
            alphaBadge.style.cssText = 'font-size: 9px; font-weight: 900; color: #fff; background: rgba(0,0,0,0.4); padding: 2px 6px; border-radius: 4px; margin-top: 2px; width: fit-content; letter-spacing: 0.5px;';
            nameInfo.appendChild(alphaBadge);
        }

        leftSide.appendChild(rankBadge);
        leftSide.appendChild(nameInfo);

        // Right Section (Score + Rivalry Gap)
        const rightSide = document.createElement('div');
        rightSide.style.cssText = 'display: flex; flex-direction: column; align-items: flex-end; gap: 4px;';

        const scorePill = document.createElement('span');
        scorePill.style.cssText = `
            background: ${rank <= 3 ? 'rgba(255,255,255,0.3)' : 'rgba(76, 175, 80, 0.1)'}; 
            color: ${rank <= 3 ? textColor : '#2E7D32'}; 
            padding: 4px 10px; 
            border-radius: 20px; 
            font-size: 12px; 
            font-weight: 800;
        `;
        const displayScore = user.totalPoints !== undefined ? user.totalPoints : (user.totalVisited || 0);
        scorePill.textContent = `${displayScore} PTS`;

        rightSide.appendChild(scorePill);

        // Rivalry Gap Logic
        if (isMe && rank > 1 && data[rank - 2]) {
            const competitorScore = data[rank - 2].totalPoints !== undefined ? data[rank - 2].totalPoints : (data[rank - 2].totalVisited || 0);
            const myScore = user.totalPoints !== undefined ? user.totalPoints : (user.totalVisited || 0);
            const pointsToOvertake = parseFloat((competitorScore - myScore + 0.1).toFixed(1));
            
            if (pointsToOvertake > 0) {
                const rivalryPill = document.createElement('span');
                rivalryPill.className = 'rivalry-pill';
                rivalryPill.style.cssText = 'background: #fee2e2; color: #dc2626; padding: 3px 8px; border-radius: 12px; font-size: 9px; font-weight: 900; letter-spacing: 0.5px;';
                rivalryPill.textContent = `🚨 ${pointsToOvertake} PTS TO OVERTAKE`;
                rightSide.appendChild(rivalryPill);
            }
        }

        li.appendChild(leftSide);
        li.appendChild(rightSide);
        return li;
    };

    // Phase 2: Render regular fetched data
    data.forEach((user, index) => {
        if (user.isPersonalFallback) return; // Skip the tacked-on fallback here
        listEl.appendChild(createRow(user, index + 1, false));
    });

    // Phase 3: Pin the current user if they are a fallback
    if (personalUserObj && personalUserObj.isPersonalFallback) {
        listEl.appendChild(createRow(personalUserObj, personalUserObj.exactRank, true));
    }

    if (data.length === 0) {
        listEl.innerHTML = '<li style="color: #888; font-style: italic; text-align: center; padding: 10px 0;">No leaderboard data yet.</li>';
    }

    // Handle "Show More" button logic pointing to the server-side fetcher
    controlsEl.innerHTML = '';
    if (window._lastLeaderboardDoc) {
        const showMoreBtn = document.createElement('button');
        showMoreBtn.id = 'lb-load-more-btn';
        showMoreBtn.textContent = 'Show More (+5)';
        showMoreBtn.style.cssText = 'width: 100%; background: rgba(0,0,0,0.05); border: 1px dashed rgba(0,0,0,0.2); border-radius: 8px; padding: 10px; font-size: 13px; cursor: pointer; color: #555; font-weight: 700; margin-top: 5px;';
        showMoreBtn.onclick = loadMoreLeaderboard;
        controlsEl.appendChild(showMoreBtn);
    }
}



let leaderboardHasLoaded = false;

window._lastLeaderboardDoc = null;
let isFetchingMoreLeaderboard = false;

async function loadLeaderboard() {
    if (typeof firebase === 'undefined') return;

    // 🎯 DIRECT READ: Always pull fresh from `leaderboard` collection.
    // No hourly cache, no throttle. Pulls once on login/reload.
    try {
        incrementRequestCount();

        // Server-Side cursor pagination: start with 5.
        const snapshot = await firebase.firestore().collection('leaderboard')
            .orderBy('totalPoints', 'desc')
            .limit(5)
            .get();

        let topUsers = [];
        if (!snapshot.empty) {
            window._lastLeaderboardDoc = snapshot.docs[snapshot.docs.length - 1];
        } else {
            window._lastLeaderboardDoc = null;
        }

        snapshot.forEach(doc => {
            const d = doc.data();
            topUsers.push({
                uid: doc.id,
                displayName: d.displayName || 'Bark Ranger',
                totalPoints: d.totalPoints !== undefined ? d.totalPoints : (d.totalVisited || 0),
                totalVisited: d.totalVisited || 0,
                hasVerified: !!d.hasVerified
            });
        });

        // Inject personal fallback if you aren't in the list yet
        const user = firebase.auth().currentUser;
        if (user && !topUsers.find(u => u.uid === user.uid)) {
            let localVerified = 0;
            let localRegular = 0;
            userVisitedPlaces.forEach(p => { if (p.verified) localVerified++; else localRegular++; });
            const localScore = (localVerified * 2) + localRegular + sanitizeWalkPoints(window.currentWalkPoints);

            // V3.1 DEEP RANK ACTUAL LOOKUP (REST API ENFORCED)
            let exactRank = null;
            try {
                // Since compat SDK omits getCountFromServer, we enforce exactly 1 read
                // by manually calling the highly-optimized Firebase REST API
                const projectId = firebase.app().options.projectId;
                const idToken = await firebase.auth().currentUser.getIdToken();
                const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runAggregationQuery`;
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        structuredAggregationQuery: {
                            structuredQuery: {
                                from: [{ collectionId: 'leaderboard' }],
                                where: {
                                    fieldFilter: {
                                        field: { fieldPath: 'totalPoints' },
                                        op: 'GREATER_THAN',
                                        value: Number.isInteger(localScore) ? { integerValue: localScore } : { doubleValue: localScore }
                                    }
                                }
                            },
                            aggregations: [{ alias: 'rankCount', count: {} }] // ALIAS IS REQUIRED
                        }
                    })
                });

                const countData = await response.json();
                // The API returns an array. We target the alias 'rankCount'
                const countMatched = parseInt(countData[0].result.aggregateFields.rankCount.integerValue);
                exactRank = countMatched + 1;
            } catch(e) {
                console.warn('REST API aggregate rank lookup failed.', e);
                exactRank = null;
            }

            topUsers.push({
                uid: user.uid,
                displayName: user.displayName || 'Bark Ranger',
                totalPoints: localScore,
                totalVisited: userVisitedPlaces.size,
                hasVerified: Array.from(userVisitedPlaces.values()).some(p => p.verified),
                isPersonalFallback: true,
                exactRank: exactRank
            });
        }

        cachedLeaderboardData = topUsers;
        leaderboardHasLoaded = true;
        renderLeaderboard(cachedLeaderboardData);

    } catch (err) {
        console.error('Leaderboard load error:', err);
    }
}

async function loadMoreLeaderboard() {
    if (!window._lastLeaderboardDoc || isFetchingMoreLeaderboard) return;
    isFetchingMoreLeaderboard = true;

    const btn = document.getElementById('lb-load-more-btn');
    if (btn) btn.textContent = 'Loading...';

    try {
        incrementRequestCount();
        const snapshot = await firebase.firestore().collection('leaderboard')
            .orderBy('totalPoints', 'desc')
            .startAfter(window._lastLeaderboardDoc)
            .limit(5)
            .get();

        if (snapshot.empty) {
            window._lastLeaderboardDoc = null;
            renderLeaderboard(cachedLeaderboardData);
            return;
        }

        window._lastLeaderboardDoc = snapshot.docs[snapshot.docs.length - 1];

        // Ensure we strip off the temporary personal fallback before pushing real sorted data
        cachedLeaderboardData = cachedLeaderboardData.filter(u => !u.isPersonalFallback);

        snapshot.forEach(doc => {
            if (!cachedLeaderboardData.find(u => u.uid === doc.id)) {
                const d = doc.data();
                cachedLeaderboardData.push({
                    uid: doc.id,
                    displayName: d.displayName || 'Bark Ranger',
                    totalPoints: d.totalPoints !== undefined ? d.totalPoints : (d.totalVisited || 0),
                    totalVisited: d.totalVisited || 0,
                    hasVerified: !!d.hasVerified
                });
            }
        });

        // Re-inject personal fallback if still haven't fetched the user
        const user = firebase.auth().currentUser;
        if (user && !cachedLeaderboardData.find(u => u.uid === user.uid)) {
            let localVerified = 0;
            let localRegular = 0;
            userVisitedPlaces.forEach(p => { if (p.verified) localVerified++; else localRegular++; });
            const localScore = (localVerified * 2) + localRegular + sanitizeWalkPoints(window.currentWalkPoints);

            try {
                const projectId = firebase.app().options.projectId;
                const idToken = await firebase.auth().currentUser.getIdToken();
                const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runAggregationQuery`;
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${idToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        structuredAggregationQuery: {
                            structuredQuery: {
                                from: [{ collectionId: 'leaderboard' }],
                                where: {
                                    fieldFilter: {
                                        field: { fieldPath: 'totalPoints' },
                                        op: 'GREATER_THAN',
                                        value: Number.isInteger(localScore) ? { integerValue: localScore } : { doubleValue: localScore }
                                    }
                                }
                            },
                            aggregations: [{ alias: 'rankCount', count: {} }]
                        }
                    })
                });

                const countData = await response.json();
                const countMatched = parseInt(countData[0].result.aggregateFields.rankCount.integerValue);
                let exactRank = countMatched + 1;
                
                cachedLeaderboardData.push({
                    uid: user.uid,
                    displayName: user.displayName || 'Bark Ranger',
                    totalPoints: localScore,
                    totalVisited: userVisitedPlaces.size,
                    hasVerified: Array.from(userVisitedPlaces.values()).some(p => p.verified),
                    isPersonalFallback: true,
                    exactRank: exactRank
                });
            } catch(e) {
                console.warn('REST API aggregate rank lookup failed in loadMore', e);
            }
        }

        renderLeaderboard(cachedLeaderboardData);

    } catch (err) {
        console.error('Error fetching more leaderboard:', err);
    } finally {
        isFetchingMoreLeaderboard = false;
    }
}

// --- ADMIN OVERRIDE ENGINE ---
window.adminEditPoints = async function () {
    if (!window.isAdmin) return alert("Unauthorized: Admin credentials required.");

    const uid = firebase.auth().currentUser.uid;
    const currentVal = window.currentWalkPoints || 0;
    const newScore = prompt("ADMIN: Manually override your Walk Points?", currentVal);

    if (newScore !== null && !isNaN(newScore)) {
        const finalPoints = parseFloat(newScore);
        try {
            incrementRequestCount();
            const db = firebase.firestore();
            await db.collection('users').doc(uid).set({
                walkPoints: finalPoints
            }, { merge: true });
            alert(`Admin Success: Walk Points set to ${finalPoints}`);
        } catch (err) {
            alert("Failed to override points.");
        }
    }
}

// Trigger initial load
// Public Feedback Portal Logic
const submitFeedbackBtn = document.getElementById('submit-feedback-btn');
if (submitFeedbackBtn && typeof firebase !== 'undefined') {
    submitFeedbackBtn.addEventListener('click', () => {
        const textArea = document.getElementById('feedback-text');
        const text = textArea ? textArea.value : '';
        if (!text || text.trim() === '') return;

        const user = firebase.auth().currentUser;
        const sender = user ? (user.displayName || user.uid) : 'Anonymous Guest';

        submitFeedbackBtn.textContent = 'Submitting...';
        submitFeedbackBtn.disabled = true;

        incrementRequestCount(); // Count Feedback Write
        firebase.firestore().collection('feedback').add({
            text: text,
            sender: sender,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        }).then(() => {
            submitFeedbackBtn.textContent = 'Feedback Sent!';
            if (textArea) textArea.value = '';
            setTimeout(() => {
                submitFeedbackBtn.textContent = 'Submit Feedback';
                submitFeedbackBtn.disabled = false;
            }, 3000);
        }).catch(err => {
            console.error('Feedback error:', err);
            submitFeedbackBtn.textContent = 'Error. Try again';
            submitFeedbackBtn.disabled = false;
        });
    });
}

// Share & Connect QR Logic
const shareSelect = document.getElementById('share-link-select');
const qrContainer = document.getElementById('qr-code-container');
const downloadQrBtn = document.getElementById('download-qr-btn');

if (shareSelect && qrContainer && typeof QRCode !== 'undefined') {
    let qrcode = new QRCode(qrContainer, {
        text: "https://usbarkrangers.github.io/USBarkRangers/",
        width: 160,
        height: 160,
        colorDark: "#1976D2",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.H
    });

    shareSelect.addEventListener('change', (e) => {
        let val = e.target.value;
        if (val === 'app') val = "https://usbarkrangers.github.io/USBarkRangers/";

        qrcode.clear();
        qrcode.makeCode(val);
    });

    if (downloadQrBtn) {
        downloadQrBtn.addEventListener('click', () => {
            const img = qrContainer.querySelector('img');
            const canvas = qrContainer.querySelector('canvas');
            let dataUrl = '';

            if (img && img.src && img.src.startsWith('data:')) {
                dataUrl = img.src;
            } else if (canvas) {
                dataUrl = canvas.toDataURL("image/png");
            }

            if (dataUrl) {
                const link = document.createElement('a');
                link.download = 'BarkRanger_QRCode.png';
                link.href = dataUrl;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } else {
                alert('QR Code not ready yet.');
            }
        });
    }
}

// ====== VIRTUAL EXPEDITION ENGINE ======
const TOP_10_TRAILS = [
    { id: 'half_dome', name: 'Half Dome', miles: 16.0, park: 'Yosemite National Park', info: 'Geologically, Half Dome is a granodiorite magma chamber that cooled slowly deep underground millions of years ago, later exposed and sheared in half by glacial activity. Before the 1870s, it was declared "perfectly inaccessible," but today, hikers ascend the final 400 feet using steel cables originally installed by the Sierra Club in 1919.' },
    { id: 'angels_landing', name: 'Angels Landing', miles: 5.0, park: 'Zion National Park', info: 'Formed around 200 million years ago from windblown sand dunes that turned into Navajo Sandstone, this narrow fin of rock was named in 1916 by explorer Frederick Fisher, who remarked that "only an angel could land on it." The trail itself is an engineering marvel, carved directly into the rock in 1926 to grant hikers access to its 1,500-foot vertical drop-offs.' },
    { id: 'zion_narrows', name: 'Zion Narrows', miles: 16.0, park: 'Zion National Park', info: 'This gorge represents millions of years of hydrology at work, where the Virgin River has sliced through Navajo Sandstone to create slot canyons up to 1,000 feet deep and sometimes just 20-30 feet wide. It is one of the world\'s premier examples of a slot canyon, requiring hikers to wade through the riverbed while being highly vigilant of sudden flash floods shaped by distant rainfall.' },
    { id: 'cascade_pass', name: 'Cascade Pass / Sahale Arm', miles: 12.1, park: 'North Cascades National Park', info: 'This route was historically used by Native Americans as a vital trading corridor across the rugged Cascade Range. Today, it offers a dramatic transition from subalpine meadows to the rocky moraines of the Sahale Glacier. It serves as a living classroom on glaciology and alpine ecosystems, frequently hosting wildlife like marmots, pikas, and mountain goats.' },
    { id: 'highline_trail', name: 'Highline Trail', miles: 11.8, park: 'Glacier National Park', info: 'Carved directly into the Garden Wall, an arête (a sharp mountain ridge formed by glaciation), this trail hugs the Continental Divide. It was blasted out of the rock in the 1920s to allow visitors to experience the park\'s dramatic, U-shaped valleys. The trail showcases the ancient, colorful sedimentary rock of the Belt Supergroup, dating back over a billion years.' },
    { id: 'harding_icefield', name: 'Harding Icefield', miles: 8.2, park: 'Kenai Fjords National Park', info: 'This rigorous trail acts as a time machine to the last Ice Age, concluding at the edge of the 700-square-mile Harding Icefield, a massive relic from the Pleistocene epoch. As hikers ascend, they walk backward through ecological succession, passing through cottonwood forests that recently colonized exposed land, up to barren, rocky terrain only recently surrendered by the shrinking Exit Glacier.' },
    { id: 'old_rag', name: 'Old Rag Trail', miles: 9.3, park: 'Shenandoah National Park', info: 'Old Rag Mountain is composed of billion-year-old Old Rag Granite, some of the oldest rock exposed in the eastern United States. The mountain\'s famous rock scramble is a result of millions of years of erosion removing softer surrounding rock, leaving behind the hard granite boulders. It is a world-class example of a batholith—magma that cooled deep beneath the Earth\'s crust.' },
    { id: 'emerald_lake', name: 'Emerald Lake', miles: 3.2, park: 'Rocky Mountain National Park', info: 'This trail offers a masterclass in glacial geology, taking hikers past a series of paternoster lakes (Nymph, Dream, and Emerald). These lakes were formed sequentially by retreating glaciers that gouged out depressions in the bedrock. The final destination, Emerald Lake, sits in a stunning "cirque"—a steep, bowl-shaped amphitheater sculpted by ice during the last glacial maximum.' },
    { id: 'precipice_trail', name: 'Precipice Trail', miles: 2.1, park: 'Acadia National Park', info: 'Scaled via a series of iron rungs and ladders embedded into Champlain Mountain, this trail navigates the exposed granite cliffs of a mountain shaped by heavy, mile-thick glaciers that retreated 15,000 years ago. It also serves as a crucial habitat for peregrine falcons, and the trail is often closed in early summer to protect the nesting sites of these incredible raptors, which can dive at speeds over 240 mph.' },
    { id: 'skyline_loop', name: 'Skyline Trail Loop', miles: 5.5, park: 'Mount Rainier National Park', info: 'This trail winds through the Paradise area, famous for having some of the most vibrant subalpine wildflower meadows on Earth, which bloom fiercely during the short summer window. Hikers also get unobstructed views of the Nisqually Glacier, providing a firsthand look at glaciology on one of the world\'s most dangerous stratovolcanoes, which is still geologically active.' },
    { id: 'grand_canyon_rim2rim', name: 'Grand Canyon Rim to Rim', miles: 44.0, park: 'Grand Canyon National Park', info: 'Crossing the Grand Canyon is a journey through deep time. As hikers descend to the Colorado River, hikers walk past nearly two billion years of Earth\'s geological history exposed in the canyon walls, from the 270-million-year-old Kaibab Limestone at the rim down to the ancient Vishnu Schist at the bottom. It spans several distinct ecosystems, equivalent to traveling from Canada to Mexico in a single day.' }
];

// --- TRAIL NAVIGATION & EDUCATION ENGINE ---
window.flyToActiveTrail = function () {
    // 1. Programmatically click your existing Nav Bar 'Map' button to switch views
    const mapNavBtn = document.querySelector('.nav-item[data-target="map-view"]');
    if (mapNavBtn) mapNavBtn.click();

    // 2. Ensure the Virtual Trail toggle is enabled so the line is visible
    const toggleBtn = document.getElementById('toggle-virtual-trail');
    if (toggleBtn && !toggleBtn.classList.contains('active')) {
        toggleBtn.click();
    }

    // 3. Leaflet rendering sequence
    if (virtualTrailLayerGroup && virtualTrailLayerGroup.getLayers().length > 0) {
        // We use a slight timeout because switching UI views (display: block) 
        // temporarily breaks Leaflet's size calculations.
        setTimeout(() => {
            map.invalidateSize();
            map.flyToBounds(virtualTrailLayerGroup.getBounds(), {
                padding: [50, 50],
                maxZoom: 14,
                animate: !instantNav,
                duration: instantNav ? 0 : 1.5
            });
        }, 350);
    } else {
        alert("Trail map data is still loading. Please try again in a moment.");
    }
};

window.hydrateEducationModal = function (trailId) {
    const trailData = TOP_10_TRAILS.find(t => t.id === trailId);
    if (!trailData) return;

    const parkEl = document.getElementById('edu-park-name');
    const descEl = document.getElementById('edu-trail-desc');
    const distEl = document.getElementById('edu-trail-distance');

    if (parkEl) parkEl.textContent = trailData.park;
    if (descEl) descEl.textContent = trailData.info;
    if (distEl) distEl.textContent = `${trailData.miles.toFixed(1)} Miles`;
};

const spinBtn = document.getElementById('spin-wheel-btn');
if (spinBtn) {
    spinBtn.addEventListener('click', async () => {
        const user = firebase.auth().currentUser;
        if (!user) {
            alert("Please sign in to start your expedition!");
            return;
        }

        spinBtn.textContent = '🎡 Spinning...';
        spinBtn.disabled = true;
        spinBtn.style.opacity = '0.7';

        // 1. Fetch user data to see what they have already completed
        incrementRequestCount();
        const userRef = firebase.firestore().collection('users').doc(user.uid);

        try {
            const docSnap = await userRef.get();
            const userData = docSnap.data() || {};

            const completedExpeditions = userData.completed_expeditions || [];
            const completedIds = completedExpeditions.map(exp => exp.id || exp.trail_id);

            // 2. Count how many times each trail has been completed
            const completionCounts = {};
            TOP_10_TRAILS.forEach(t => completionCounts[t.id] = 0);

            completedExpeditions.forEach(exp => {
                const id = exp.id || exp.trail_id;
                if (completionCounts[id] !== undefined) {
                    completionCounts[id]++;
                }
            });

            // 3. Find the lowest completion count (the current "lap" they are on)
            const minCount = Math.min(...Object.values(completionCounts));

            // 4. Filter available trails to ONLY those on the current lap
            let availableTrails = TOP_10_TRAILS.filter(trail => completionCounts[trail.id] === minCount);

            // 👑 BOSS TRAIL LOGIC 👑
            // Grand Canyon Rim to Rim is an imposing 44-mile endurance test. Force it to be the final challenge.
            const isGrandCanyonAvailable = availableTrails.some(t => t.id === 'grand_canyon_rim2rim');
            if (isGrandCanyonAvailable && availableTrails.length > 1) {
                availableTrails = availableTrails.filter(t => t.id !== 'grand_canyon_rim2rim');
            }

            if (minCount > 0 && availableTrails.length === TOP_10_TRAILS.length - 1) {
                alert(`🌟 Prestige Mode Lap ${minCount + 1}! You've conquered every trail. Spin to start your next lap!`);
            }

            let spinCount = 0;
            let finalTrail = null;
            const nameHeader = document.getElementById('expedition-name');

            const shuffleInterval = setInterval(() => {
                // Spin only using the available (uncompleted) trails
                const randomTrail = availableTrails[Math.floor(Math.random() * availableTrails.length)];
                if (nameHeader) nameHeader.textContent = randomTrail.name;
                spinCount++;

                if (spinCount > 15) {
                    clearInterval(shuffleInterval);
                    finalTrail = availableTrails[Math.floor(Math.random() * availableTrails.length)];
                    if (nameHeader) nameHeader.textContent = finalTrail.name;

                    assignTrailToUser(user.uid, finalTrail);

                    // 🔥 THE FIX: Reset the button state in the background so it's ready for the next loop
                    setTimeout(() => {
                        spinBtn.textContent = '🎡 Spin for a Trail';
                        spinBtn.disabled = false;
                        spinBtn.style.opacity = '1';
                    }, 500);
                }
            }, 120);

        } catch (error) {
            console.error("Error fetching spin data:", error);
            alert("Error spinning the wheel. Please check your connection.");
            spinBtn.textContent = '🎡 Spin for a Trail';
            spinBtn.disabled = false;
            spinBtn.style.opacity = '1';
        }
    });
}

async function assignTrailToUser(uid, trail) {
    incrementRequestCount();
    const userRef = firebase.firestore().collection('users').doc(uid);

    const doc = await userRef.get();
    const data = doc.data() || {};
    const existingHistory = (data.virtual_expedition && data.virtual_expedition.history) || [];

    await userRef.set({
        virtual_expedition: {
            active_trail: trail.id,
            trail_name: trail.name,
            miles_logged: 0,
            trail_total_miles: trail.miles,
            history: existingHistory
        }
    }, { merge: true });

    document.getElementById('expedition-intro-state').style.display = 'none';
    const activeEl = document.getElementById('expedition-active-state');
    const nameHeader = document.getElementById('expedition-name');
    if (nameHeader) {
        nameHeader.textContent = trail.name;
        nameHeader.dataset.trailName = trail.name;
    }
    activeEl.style.display = 'block';
    hydrateEducationModal(trail.id);
    activeEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 400, fill: 'forwards' });

    renderExpeditionProgress(0, trail.miles);
    renderExpeditionHistory(existingHistory, trail.name);
}

// Helper: Calculate distance in meters
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Global function to process ANY mileage addition (GPS or Manual)
async function processMileageAddition(milesToAdd, typeLabel) {
    const user = firebase.auth().currentUser;
    if (!user) return;

    const userRef = firebase.firestore().collection('users').doc(user.uid);
    incrementRequestCount();

    try {
        const docSnap = await userRef.get();
        const userData = docSnap.data();

        let currentMiles = 0;
        let totalMiles = 10;
        let history = [];
        let lifetimeTotal = userData.lifetime_miles || 0;

        // Grab the trail name from the user data
        const currentTrailName = (userData.virtual_expedition && userData.virtual_expedition.trail_name) || "Active Trail";

        if (userData.virtual_expedition) {
            currentMiles = userData.virtual_expedition.miles_logged || 0;
            totalMiles = userData.virtual_expedition.trail_total_miles || 0;
            history = userData.virtual_expedition.history || [];
        }

        let newTotal = currentMiles + milesToAdd;
        if (totalMiles > 0 && newTotal > totalMiles) newTotal = totalMiles;

        // The updated object structure for the array
        const logEntry = {
            ts: Date.now(),
            miles: parseFloat(milesToAdd.toFixed(2)),
            type: typeLabel,
            trailName: currentTrailName // Added for grouping
        };
        history.unshift(logEntry);

        await userRef.update({
            "virtual_expedition.miles_logged": newTotal,
            "virtual_expedition.history": history,
            "lifetime_miles": firebase.firestore.FieldValue.increment(parseFloat(milesToAdd.toFixed(2))),
            "walkPoints": firebase.firestore.FieldValue.increment(parseFloat(milesToAdd.toFixed(2)))
        });

        // 🏆 LEADERBOARD SYNC: Update in-memory walkPoints and push to leaderboard
        window.currentWalkPoints = (window.currentWalkPoints || 0) + parseFloat(milesToAdd.toFixed(2));
        await syncScoreToLeaderboard();

        renderExpeditionProgress(newTotal, totalMiles, lifetimeTotal + milesToAdd);
        renderExpeditionHistory(history, currentTrailName);

        if (newTotal >= totalMiles) {
            setTimeout(() => alert("🎉 Expedition Complete! You conquered the trail!"), 800);
        }

    } catch (error) {
        console.error("Failed to log miles:", error);
    }
}

// The Manual Override Action
const logManualBtn = document.getElementById('log-manual-miles-btn');
if (logManualBtn) {
    logManualBtn.addEventListener('click', () => {
        const inputEl = document.getElementById('miles-input');
        let milesToLog = parseFloat(inputEl.value);

        if (isNaN(milesToLog) || milesToLog <= 0) return;
        if (milesToLog > 15) {
            alert("Whoa there! You can only log a maximum of 15 miles per day manually.");
            milesToLog = 15;
            inputEl.value = 15;
        }

        processMileageAddition(milesToLog, 'Manual Entry');
        inputEl.value = '';
    });
}

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

        // Ensure celebration trail name is set
        const trailName = document.getElementById('celebration-trail-name');
        if (trailName) {
            const currentTrailName = document.getElementById('expedition-name').dataset.trailName || "Expedition";
            trailName.textContent = currentTrailName;
        }
    } else if (activeState && completeState) {
        // Not complete or total is 0, ensure the name isn't stuck on "CONQUERED"
        const nameHeader = document.getElementById('expedition-name');
        if (nameHeader && nameHeader.textContent === "CONQUERED") {
            nameHeader.textContent = nameHeader.dataset.trailName || "";
        }
    }

    if (lifetimeEl && lifetime !== undefined) {
        lifetimeEl.textContent = `${lifetime.toFixed(1)} mi`;
    }
}

function renderExpeditionHistory(historyArray, activeTrailName = "Expedition") {
    // 1. Update the mini-log in the expedition card (FILTERED FOR CURRENT TRAIL ONLY)
    const list = document.getElementById('expedition-history-list');
    if (list) {
        // Filter the array so we only show logs belonging to the active trail
        const currentTrailLogs = historyArray.filter(log => {
            // Only show logs that explicitly match the active trail name
            return log.trailName && log.trailName === activeTrailName;
        });

        if (!currentTrailLogs || currentTrailLogs.length === 0) {
            list.innerHTML = '<li style="color: #94a3b8; font-size: 11px; text-align: center; padding: 10px 0; font-style: italic;">No miles logged yet.</li>';
        } else {
            // Render only the filtered logs (limited to the 5 most recent)
            list.innerHTML = currentTrailLogs.slice(0, 5).map(log => {
                const dateStr = new Date(log.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                const icon = log.type === 'GPS Verified' ? '📍' : '✏️';
                return `
                <li class="log-item">
                    <div class="log-item-left">
                        <span class="log-item-type">${icon} ${log.type}</span>
                        <span class="log-item-date">${dateStr}</span>
                    </div>
                    <div class="log-item-miles">+${log.miles.toFixed(2)} mi</div>
                </li>`;
            }).join('');
        }
    }

    // 2. Update the master management list in the side panel (NO CHANGES - SHOWS ALL TIME)
    const masterList = document.getElementById('manage-walks-list');
    const masterCount = document.getElementById('manage-walks-count');
    if (masterList) {
        if (masterCount) masterCount.textContent = historyArray.length;
        if (!historyArray || historyArray.length === 0) {
            masterList.innerHTML = '<div style="color: #94a3b8; font-size: 12px; text-align: center; padding: 20px; font-style: italic;">No walks logged yet.</div>';
            return;
        }

        // Group by trailName
        const grouped = historyArray.reduce((acc, log) => {
            // Smart fallback: if trailName is missing or generic, use the current activeTrailName
            const isGeneric = !log.trailName || log.trailName === "Expedition" || log.trailName === "Active Trail";
            const trail = isGeneric ? (activeTrailName || "Expedition") : log.trailName;

            if (!acc[trail]) acc[trail] = [];
            acc[trail].push(log);
            return acc;
        }, {});

        masterList.innerHTML = Object.keys(grouped).map(trail => {
            const logs = grouped[trail];
            const totalTrailMiles = logs.reduce((sum, l) => sum + l.miles, 0);
            return `
            <div style="margin-bottom: 20px;">
                <div style="font-size: 11px; font-weight: 900; color: #94a3b8; text-transform: uppercase; margin-bottom: 10px; display: flex; justify-content: space-between; padding: 0 4px;">
                    <span>${trail}</span>
                    <span>${totalTrailMiles.toFixed(2)} mi</span>
                </div>
                <ul style="list-style: none; padding: 0; margin: 0; background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #f1f5f9;">
                    ${logs.map(log => {
                const dateStr = new Date(log.ts).toLocaleString([], { month: 'short', day: 'numeric' });
                const icon = log.type === 'GPS Verified' ? '📍' : '✏️';
                return `
                        <li style="display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #f8fafc;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 14px;">${icon}</span>
                                <div style="display: flex; flex-direction: column;">
                                    <span style="font-weight: 700; color: #1e293b; font-size: 13px;">${log.miles.toFixed(2)} mi</span>
                                    <span style="font-size: 10px; color: #64748b;">${dateStr}</span>
                                </div>
                            </div>
                            <div style="display: flex; gap: 12px;">
                                <button onclick="editWalkMiles('${log.ts}')" style="background: none; border: none; color: #3b82f6; font-size: 10px; font-weight: 800; cursor: pointer; padding: 4px; letter-spacing: 0.5px;">EDIT</button>
                                <button onclick="deleteWalkLog('${log.ts}')" style="background: none; border: none; color: #ef4444; font-size: 10px; font-weight: 800; cursor: pointer; padding: 4px; letter-spacing: 0.5px;">DELETE</button>
                            </div>
                        </li>`;
            }).join('')}
                </ul>
            </div>`;
        }).join('');
    }
}

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

        // 1. Edit Miles
        const newMilesStr = prompt("Enter new miles for this walk:", currentLog.miles);
        if (newMilesStr === null) return;
        const newMiles = parseFloat(newMilesStr);
        if (isNaN(newMiles) || newMiles < 0) {
            alert("Please enter a valid mileage.");
            return;
        }

        // 2. Edit Trail Name
        const newTrailName = prompt("Which trail was this on? (e.g. Grand Canyon, Bright Angel):", currentLog.trailName || "Expedition");
        if (newTrailName === null) return;

        // 3. Edit Date
        const currentDateStr = new Date(currentLog.ts).toISOString().slice(0, 16);
        const newDateStr = prompt("Edit Date/Time (YYYY-MM-DDTHH:MM):", currentDateStr);
        if (newDateStr === null) return;
        const newTs = new Date(newDateStr).getTime();
        if (isNaN(newTs)) {
            alert("Invalid date format.");
            return;
        }

        const oldMiles = currentLog.miles;
        const oldTrail = currentLog.trailName;
        const diff = newMiles - oldMiles;

        // Update Log Entry
        history[logIndex].miles = newMiles;
        history[logIndex].trailName = newTrailName;
        history[logIndex].ts = newTs;

        // Sort history by timestamp descending
        history.sort((a, b) => b.ts - a.ts);

        // Update Current Trail Progress (If Trail Migration occurs or miles change on active trail)
        let currentProgress = data.virtual_expedition.miles_logged || 0;

        if (oldTrail === activeTrailName && newTrailName === activeTrailName) {
            currentProgress += diff;
        } else if (oldTrail === activeTrailName && newTrailName !== activeTrailName) {
            currentProgress -= oldMiles;
        } else if (oldTrail !== activeTrailName && newTrailName === activeTrailName) {
            currentProgress += newMiles;
        }

        if (currentProgress < 0) currentProgress = 0;
        const maxMiles = data.virtual_expedition.trail_total_miles || 10;
        if (currentProgress > maxMiles) currentProgress = maxMiles;

        await userRef.update({
            "virtual_expedition.history": history,
            "virtual_expedition.miles_logged": currentProgress,
            "lifetime_miles": firebase.firestore.FieldValue.increment(diff),
            "walkPoints": firebase.firestore.FieldValue.increment(diff)
        });

        // 🏆 LEADERBOARD SYNC: Update in-memory walkPoints and push to leaderboard
        window.currentWalkPoints = (window.currentWalkPoints || 0) + diff;
        await syncScoreToLeaderboard();

        showTripToast("Walk log updated ✏️");
    } catch (e) {
        console.error(e);
        alert("Failed to update walk.");
    }
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
        // Only subtract from progress if the deleted walk was on the ACTIVE trail
        if (walkTrail === activeTrail) {
            currentProgress -= milesToRemove;
        }

        if (currentProgress < 0) currentProgress = 0;

        await userRef.update({
            "virtual_expedition.history": history,
            "virtual_expedition.miles_logged": currentProgress,
            "lifetime_miles": firebase.firestore.FieldValue.increment(-milesToRemove),
            // Note: We subtract from walkPoints too to maintain parity with lifetime_miles,
            // as 'walkPoints' is the leaderboard currency.
            "walkPoints": firebase.firestore.FieldValue.increment(-milesToRemove)
        });

        // 🏆 LEADERBOARD SYNC: Update in-memory walkPoints and push to leaderboard
        window.currentWalkPoints = Math.max(0, (window.currentWalkPoints || 0) - milesToRemove);
        await syncScoreToLeaderboard();

        showTripToast("Walk removed 🗑️");
    } catch (e) {
        console.error(e);
        alert("Failed to delete walk.");
    }
};

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

        // Dynamic points: 1 PT per 2 miles of trail length, minimum 1
        const pointsEarned = Math.max(1, Math.round(trailMiles / 2));

        // 1. Create the Trophy Object
        const completedTrail = {
            id: userData.virtual_expedition.active_trail,
            name: currentTrailName,
            miles: trailMiles,
            points_earned: pointsEarned,
            date_completed: Date.now()
        };

        const completedArray = userData.completed_expeditions || [];

        // 🔥 THE DUPLICATE LOCK: Check if they already have this badge
        const existingIndex = completedArray.findIndex(exp => exp.id === completedTrail.id);

        if (existingIndex > -1) {
            // They beat it again on Prestige Mode! Just update the date.
            completedArray[existingIndex].date_completed = Date.now();
        } else {
            // Brand new badge, add it to the array.
            completedArray.push(completedTrail);
        }

        // 2. Database Update — now includes walkPoints increment!
        await userRef.update({
            "completed_expeditions": completedArray,
            "virtual_expedition.active_trail": null,
            "virtual_expedition.trail_name": null,
            "virtual_expedition.miles_logged": 0,
            "virtual_expedition.trail_total_miles": 0,
            "walkPoints": firebase.firestore.FieldValue.increment(pointsEarned)
        });

        // 🏆 LEADERBOARD SYNC: Update in-memory walkPoints and push to leaderboard
        window.currentWalkPoints = (window.currentWalkPoints || 0) + pointsEarned;
        await syncScoreToLeaderboard();

        showTripToast(`🏆 +${pointsEarned} PTS! Reward Claimed: ${currentTrailName}`);
    } catch (e) {
        console.error(e);
        alert("Failed to claim reward.");
    }
};

function renderCompletedExpeditions(expeditionsArray) {
    const grid = document.getElementById('completed-expeditions-grid');
    const caseEl = document.getElementById('expedition-trophy-case');
    if (!grid || !caseEl) return;

    if (!expeditionsArray || expeditionsArray.length === 0) {
        caseEl.style.display = 'none';
        return;
    }

    caseEl.style.display = 'block';

    // Use robust fallbacks for property names to support older logs
    grid.innerHTML = expeditionsArray.map(exp => {
        const name = exp.name || exp.trail_name || "Expedition";
        const rawDate = exp.date_completed || exp.ts || Date.now();
        const dateStr = new Date(rawDate).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

        return `
        <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; display: flex; align-items: center; gap: 10px; flex: 0 0 180px; scroll-snap-align: start;">
            <div style="font-size: 24px; filter: drop-shadow(0 2px 2px rgba(0,0,0,0.1));">🏅</div>
            <div style="display: flex; flex-direction: column;">
                <span style="font-size: 12px; font-weight: 800; color: #1e293b; line-height: 1.2; white-space: normal;">${name}</span>
                <span style="font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 2px;">${dateStr}</span>
            </div>
        </div>`;
    }).join('');
}

// --- DRAFT TRIP VISUALS ENGINE ---
let draftTripLines = [];

function showTripToast(message) {
    let toast = document.getElementById('trip-action-toast');
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

window.draftBookendMarkers = window.draftBookendMarkers || [];
window.draftCustomMarkers = window.draftCustomMarkers || []; // Tracks custom town pins

function updateTripMapVisuals() {
    // 1. Clear old badges, draft lines, bookends, and custom pins
    document.querySelectorAll('.trip-stop-badge').forEach(el => el.remove());
    draftTripLines.forEach(line => map.removeLayer(line));
    draftTripLines = [];
    window.draftBookendMarkers.forEach(m => map.removeLayer(m));
    window.draftBookendMarkers = [];
    window.draftCustomMarkers.forEach(m => map.removeLayer(m));
    window.draftCustomMarkers = [];

    // 2. Determine Bookend Math
    let startLatLng = window.tripStartNode ? [window.tripStartNode.lat, window.tripStartNode.lng] : null;
    let endLatLng = window.tripEndNode ? [window.tripEndNode.lat, window.tripEndNode.lng] : null;
    let isRoundTrip = startLatLng && endLatLng && haversineDistance(startLatLng[0], startLatLng[1], endLatLng[0], endLatLng[1]) < 0.5;

    // 3. Draw Bookend Map Markers
    if (startLatLng) {
        let bg = isRoundTrip ? '#8b5cf6' : '#22c55e';
        let iconText = isRoundTrip ? '🔄' : 'A';
        let startIcon = L.divIcon({ className: 'bookend-icon', html: `<div style="background:${bg}; color:white; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:2px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.5); font-size:12px; z-index: 1000;">${iconText}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
        window.draftBookendMarkers.push(L.marker(startLatLng, { icon: startIcon }).addTo(map));
    }
    if (endLatLng && !isRoundTrip) {
        let endIcon = L.divIcon({ className: 'bookend-icon', html: `<div style="background:#ef4444; color:white; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:2px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.5); font-size:12px; z-index: 1000;">B</div>`, iconSize: [24, 24], iconAnchor: [12, 12] });
        window.draftBookendMarkers.push(L.marker(endLatLng, { icon: endIcon }).addTo(map));
    }

    // 4. Decorate map pins and draw continuous dotted lines
    tripDays.forEach((day, dayIdx) => {
        const latlngs = [];
        if (dayIdx === 0 && startLatLng) latlngs.push(startLatLng);
        if (dayIdx > 0 && tripDays[dayIdx - 1].stops.length > 0) {
            const prevLast = tripDays[dayIdx - 1].stops[tripDays[dayIdx - 1].stops.length - 1];
            latlngs.push([prevLast.lat, prevLast.lng]);
        }

        day.stops.forEach((stop, stopIdx) => {
            latlngs.push([stop.lat, stop.lng]);
            const point = allPoints.find(p => p.id === stop.id && p.id !== undefined);

            let badgeContainer;
            if (point && point.marker && point.marker._icon) {
                badgeContainer = point.marker._icon;
            } else {
                // 🔥 THE FIX: It's a custom town, draw a dark grey temporary pin!
                const customIcon = L.divIcon({
                    className: 'custom-trip-pin',
                    html: `<div style="background: #475569; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.4); position: relative;"></div>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                });
                const customMarker = L.marker([stop.lat, stop.lng], { icon: customIcon, interactive: false }).addTo(map);
                window.draftCustomMarkers.push(customMarker);
                // Strict check: Leaflet may not create the icon if it's off-screen
                if (customMarker._icon) badgeContainer = customMarker._icon.firstChild;
            }

            if (badgeContainer) {
                const badge = document.createElement('div');
                badge.className = 'trip-stop-badge';
                badge.style.background = day.color;
                badge.textContent = stopIdx + 1;
                badgeContainer.appendChild(badge);
            }
        });

        if (dayIdx === tripDays.length - 1 && endLatLng) latlngs.push(endLatLng);

        if (latlngs.length >= 2) {
            const line = L.polyline(latlngs, { color: day.color, weight: 3, dashArray: '5, 10', opacity: 0.6 }).addTo(map);
            draftTripLines.push(line);
        }
    });
}

// --- LOCAL NEAREST NEIGHBOR OPTIMIZATION ---
window.autoSortDay = function () {
    const day = tripDays[activeDayIdx];
    if (day.stops.length <= 2) {
        alert('You need at least 3 stops to sort a route!');
        return;
    }

    const sorted = [day.stops[0]]; // Lock the starting point
    const unvisited = day.stops.slice(1); // The rest to be sorted

    let currentStop = sorted[0];

    while (unvisited.length > 0) {
        let nearestIdx = 0;
        let minDist = Infinity;

        for (let i = 0; i < unvisited.length; i++) {
            const dist = haversineDistance(currentStop.lat, currentStop.lng, unvisited[i].lat, unvisited[i].lng);
            if (dist < minDist) {
                minDist = dist;
                nearestIdx = i;
            }
        }

        currentStop = unvisited.splice(nearestIdx, 1)[0];
        sorted.push(currentStop);
    }

    tripDays[activeDayIdx].stops = sorted;
    updateTripUI();
    showTripToast('✨ Route Optimized!');
};

// --- GLOBAL TRIP OPTIMIZER ---
window.executeSmartOptimization = function () {
    // 1. Setup & User Inputs
    const userMaxStops = parseInt(document.getElementById('opt-max-stops').value) || 5;
    const userMaxHours = parseFloat(document.getElementById('opt-max-hours').value) || 4;

    const totalStops = tripDays.reduce((sum, d) => sum + d.stops.length, 0);
    if (totalStops < 2) {
        alert('Add at least two stops before optimizing!');
        return;
    }

    // 2. Flatten all unique stops (Deduplication)
    let allUniqueStops = [];
    tripDays.forEach(day => {
        day.stops.forEach(stop => {
            if (allUniqueStops.length === 0) {
                allUniqueStops.push(stop);
            } else {
                const lastStop = allUniqueStops[allUniqueStops.length - 1];
                const isDuplicate = stop.id && lastStop.id
                    ? stop.id === lastStop.id
                    : (stop.lat === lastStop.lat && stop.lng === lastStop.lng);
                if (!isDuplicate) {
                    allUniqueStops.push(stop);
                }
            }
        });
    });

    // 3. Nearest Neighbor Sort
    let sorted = [];
    let unvisited = [...allUniqueStops];
    let currentStop;

    if (window.tripStartNode) {
        currentStop = window.tripStartNode;
    } else {
        currentStop = unvisited.shift();
        sorted.push(currentStop);
    }

    while (unvisited.length > 0) {
        let nearestIdx = 0;
        let minDist = Infinity;
        for (let i = 0; i < unvisited.length; i++) {
            const dist = haversineDistance(currentStop.lat, currentStop.lng, unvisited[i].lat, unvisited[i].lng);
            if (dist < minDist) {
                minDist = dist;
                nearestIdx = i;
            }
        }
        currentStop = unvisited.splice(nearestIdx, 1)[0];
        sorted.push(currentStop);
    }

    // 4. Heuristic Chunking Engine (Pace-Based)
    let newTripDays = [];
    let currentDayStops = [];
    let currentDayHours = 0;
    let dayColorIndex = 0;

    for (let i = 0; i < sorted.length; i++) {
        const stop = sorted[i];

        // Calculate drive time from previous stop
        if (currentDayStops.length > 0) {
            const prev = currentDayStops[currentDayStops.length - 1];
            const distKm = haversineDistance(prev.lat, prev.lng, stop.lat, stop.lng);
            const distMiles = distKm * 0.621371;
            const driveHours = distMiles / 55; // Heuristic: 55mph average
            currentDayHours += driveHours;
        }

        currentDayStops.push(stop);

        const isLastStop = i === sorted.length - 1;
        const hitStopLimit = currentDayStops.length >= userMaxStops;
        const hitHourLimit = currentDayHours >= userMaxHours;

        if (isLastStop || hitStopLimit || hitHourLimit) {
            newTripDays.push({
                color: DAY_COLORS[dayColorIndex % DAY_COLORS.length],
                stops: [...currentDayStops],
                notes: tripDays[dayColorIndex] ? tripDays[dayColorIndex].notes : ""
            });
            dayColorIndex++;

            if (!isLastStop) {
                // Carry-Over: The next day starts exactly where this day ended
                currentDayStops = [{ ...stop }];
                currentDayHours = 0; // Reset hours for the new day
            }
        }
    }

    // 5. Apply & Cleanup
    tripDays = newTripDays;
    activeDayIdx = 0;
    document.getElementById('optimizer-modal').style.display = 'none';
    updateTripUI();
    showTripToast('✨ Smart Optimization Complete!');
};

// --- EXPORT DAY TO GOOGLE MAPS ---
window.exportDayToMaps = function (dayIdx) {
    const day = tripDays[dayIdx];
    const waypoints = [];

    // 1. Add Start Node if it's Day 1
    if (dayIdx === 0 && window.tripStartNode) {
        waypoints.push(`${window.tripStartNode.lat},${window.tripStartNode.lng}`);
    }

    // 2. Add Carry-over from previous day if it's Day 2+
    if (dayIdx > 0 && tripDays[dayIdx - 1].stops.length > 0) {
        const prevLast = tripDays[dayIdx - 1].stops[tripDays[dayIdx - 1].stops.length - 1];
        waypoints.push(`${prevLast.lat},${prevLast.lng}`);
    }

    // 3. Add the day's actual stops
    day.stops.forEach(stop => {
        waypoints.push(`${stop.lat},${stop.lng}`);
    });

    // 4. Add End Node if it's the last day
    if (dayIdx === tripDays.length - 1 && window.tripEndNode) {
        waypoints.push(`${window.tripEndNode.lat},${window.tripEndNode.lng}`);
    }

    if (waypoints.length < 2) {
        alert('Not enough stops to generate a driving route for this day!');
        return;
    }

    // Generate native Google Maps multi-stop URL
    const mapsUrl = `https://www.google.com/maps/dir/${waypoints.join('/')}`;
    window.open(mapsUrl, '_blank');
};

// ====== TRIP BUILDER LOGIC ======
const tripQueueList = document.getElementById('trip-queue-list');
const plannerBadge = document.getElementById('planner-badge');
const clearTripBtn = document.getElementById('clear-trip-btn');
const startRouteBtn = document.getElementById('start-route-btn');

function getTotalStops() {
    return tripDays.reduce((sum, d) => sum + d.stops.length, 0);
}

// --- GLOBAL AUTO-SPILLOVER ENGINE ---
window.addStopToTrip = function (stopData) {
    // 1. Prevent duplicates across the ENTIRE trip, not just the current day
    for (let i = 0; i < tripDays.length; i++) {
        if (tripDays[i].stops.find(s => s.lat === stopData.lat && s.lng === stopData.lng)) {
            alert(`This location is already in your trip on Day ${i + 1}!`);
            return false;
        }
    }

    // 2. Auto-Spillover & Carry-Over Logic
    if (tripDays[activeDayIdx].stops.length >= 10) {
        const lastStopOfCurrentDay = tripDays[activeDayIdx].stops[tripDays[activeDayIdx].stops.length - 1];

        if (activeDayIdx + 1 < tripDays.length) {
            activeDayIdx++;
        } else {
            const nextColor = DAY_COLORS[tripDays.length % DAY_COLORS.length];
            // 🔥 CARRY-OVER LOGIC: Inject the end point of the previous day as Stop 1
            tripDays.push({ color: nextColor, stops: [{ ...lastStopOfCurrentDay }], notes: "" });
            activeDayIdx = tripDays.length - 1;
        }
        showTripToast(`Day full! Auto-moved to Day ${activeDayIdx + 1} 🚐`);
    }

    // 3. Inject the stop and render
    tripDays[activeDayIdx].stops.push(stopData);
    updateTripUI();

    // Slight delay so the toast doesn't get instantly overwritten by the auto-move toast
    setTimeout(() => showTripToast(`Added to Day ${activeDayIdx + 1}!`), 50);
    return true;
};

// --- INTERACTIVE BOOKEND CONTROLLER ---
window.editBookend = function (type) {
    const el = document.getElementById(type === 'start' ? 'ui-start-node' : 'ui-end-node');
    const currentName = type === 'start' ? (window.tripStartNode ? window.tripStartNode.name : '') : (window.tripEndNode ? window.tripEndNode.name : '');
    const color = type === 'start' ? '#22c55e' : '#ef4444';
    const bg = type === 'start' ? '#f0fdf4' : '#fef2f2';

    // Transform the bookend into an inline search bar
    el.innerHTML = `
    <div style="background: ${bg}; border: 2px solid ${color}; border-radius: 12px; padding: 12px; margin-top: ${type === 'end' ? '15px' : '0'}; margin-bottom: 15px; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="font-size: 11px; font-weight: 900; color: ${color}; margin-bottom: 8px; text-transform: uppercase;">📍 Set Trip ${type}</div>
        <div style="display: flex; gap: 5px;">
            <input type="text" id="inline-${type}-input" value="${currentName}" placeholder="Search town or 'My location'" style="flex: 1; padding: 10px; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); font-size: 13px; outline: none; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);">
            <button onclick="processInlineSearch('${type}')" class="glass-btn primary-btn" style="padding: 10px 15px; border-radius: 8px; font-size: 12px; font-weight: 800;">🔍</button>
            <button onclick="updateTripUI()" class="glass-btn" style="padding: 10px; border-radius: 8px; font-size: 12px; font-weight: 800; color: #666;">✕</button>
        </div>
        <div id="inline-suggest-${type}" style="display: none; background: white; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; margin-top: 8px; max-height: 200px; overflow-y: auto; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"></div>
        ${currentName ? `<div style="text-align:right; margin-top: 8px;"><button onclick="window.trip${type === 'start' ? 'Start' : 'End'}Node=null; updateTripUI()" style="background: transparent; color: #dc2626; border: none; font-size: 11px; font-weight: 800; cursor: pointer; text-decoration: underline;">Remove ${type.toUpperCase()}</button></div>` : ''}
    </div>`;

    // Auto-focus the input box so the user can just start typing
    setTimeout(() => {
        const input = document.getElementById(`inline-${type}-input`);
        if (input) { input.focus(); input.select(); }
    }, 50);

    // Allow the Enter key to submit the search
    document.getElementById(`inline-${type}-input`).addEventListener('keypress', function (e) {
        if (e.key === 'Enter') { processInlineSearch(type); }
    });
};

window.processInlineSearch = function (type) {
    const input = document.getElementById(`inline-${type}-input`);
    if (input && input.value.trim() !== '') {
        const suggestBox = document.getElementById(`inline-suggest-${type}`);
        if (suggestBox) {
            suggestBox.style.display = 'block';
            suggestBox.innerHTML = '<p style="padding: 10px; font-size: 12px; color: #666; text-align: center;">Searching...</p>';
        }
        executeGeocode(input.value.trim(), type);
    }
};

// --- DAY MANAGEMENT ENGINE ---
window.shiftDayLeft = function () {
    if (activeDayIdx === 0) return;
    const temp = tripDays[activeDayIdx - 1];
    tripDays[activeDayIdx - 1] = tripDays[activeDayIdx];
    tripDays[activeDayIdx] = temp;
    activeDayIdx--;
    updateTripUI();
    updateTripMapVisuals();
};

window.shiftDayRight = function () {
    if (activeDayIdx === tripDays.length - 1) return;
    const temp = tripDays[activeDayIdx + 1];
    tripDays[activeDayIdx + 1] = tripDays[activeDayIdx];
    tripDays[activeDayIdx] = temp;
    activeDayIdx++;
    updateTripUI();
    updateTripMapVisuals();
};

window.insertDayAfter = function () {
    if (tripDays.length >= 5) return;
    const nextColor = DAY_COLORS[tripDays.length % DAY_COLORS.length];
    tripDays.splice(activeDayIdx + 1, 0, { color: nextColor, stops: [], notes: "" });
    activeDayIdx++; // Focus the newly created empty day
    updateTripUI();
};

function updateTripUI() {
    const list = document.getElementById('trip-queue-list');
    if (!list) return;

    const total = getTotalStops();
    if (plannerBadge) {
        if (total > 0) {
            plannerBadge.style.display = 'block';
            plannerBadge.textContent = total;
        } else {
            plannerBadge.style.display = 'none';
        }
    }

    // 1. FRESH LOOKUP FOR CONTAINERS
    let tabContainer = document.getElementById('trip-day-tabs');
    if (!tabContainer && list.parentElement) {
        tabContainer = document.createElement('div');
        tabContainer.id = 'trip-day-tabs';
        tabContainer.style.cssText = 'display:flex; gap:6px; flex-wrap: wrap; margin-bottom:14px; align-items:center;';
        list.parentElement.insertBefore(tabContainer, list);
    }
    if (tabContainer) tabContainer.innerHTML = '';

    // 2. START BOOKEND PROTECTION
    let startEl = document.getElementById('ui-start-node');
    if (!startEl && tabContainer && tabContainer.parentElement) {
        startEl = document.createElement('div');
        startEl.id = 'ui-start-node';
        tabContainer.parentElement.insertBefore(startEl, tabContainer);
    }

    if (startEl && window.tripStartNode) {
        startEl.innerHTML = `
        <div onclick="editBookend('start')" class="trip-node-card" style="background: #f0fdf4; cursor: pointer; padding: 10px; margin-bottom: 10px; border-radius: 8px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="background: #22c55e; color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; justify-content: center; align-items: center; font-size: 11px; font-weight: 800;">A</span> 
                <div>
                    <div class="planner-metadata" style="color: #15803d; font-size: 10px;">Trip Start</div>
                    <div style="font-weight: 700; color: #333; font-size: 13px;">${window.tripStartNode.name}</div>
                </div>
            </div>
            <div class="planner-metadata" style="opacity: 0.6; font-size: 10px;">Edit</div>
        </div>`;
    } else if (startEl) {
        startEl.innerHTML = `
        <button onclick="editBookend('start')" class="glass-btn" style="width: 100%; height: 36px; background: #fff; border: 1px dashed #22c55e; color: #15803d; font-weight: 800; font-size: 11px; margin-bottom: 10px; border-radius: 8px; display: flex; align-items: center; justify-content: center; gap: 8px;">
            <span>➕</span> SET TRIP START
        </button>`;
    }

    // 3. RENDER THE REST OF THE TABS

    tripDays.forEach((day, di) => {
        const tab = document.createElement('div');
        tab.style.cssText = `display:inline-flex; align-items:center; gap:5px; padding:6px 12px; border-radius:20px; cursor:pointer; font-size:13px; font-weight:600; border: 2px solid ${di === activeDayIdx ? day.color : '#ddd'}; background:${di === activeDayIdx ? day.color : '#f5f5f5'}; color:${di === activeDayIdx ? 'white' : '#555'}; transition: all 0.2s;`;

        // Color picker swatch
        const swatch = document.createElement('input');
        swatch.type = 'color';
        swatch.value = day.color;
        swatch.title = 'Change day color';
        swatch.style.cssText = 'width:14px; height:14px; border:none; padding:0; background:none; cursor:pointer; border-radius:50%; outline:none;';
        swatch.onclick = (e) => e.stopPropagation();
        swatch.oninput = (e) => {
            tripDays[di].color = e.target.value;
            updateTripUI();
        };

        const label = document.createElement('span');
        label.textContent = `Day ${di + 1} (${day.stops.length})`;

        tab.appendChild(swatch);
        tab.appendChild(label);

        // Delete day button (only if > 1 day and day is empty)
        if (tripDays.length > 1 && day.stops.length === 0) {
            const delBtn = document.createElement('span');
            delBtn.textContent = '×';
            delBtn.title = 'Remove day';
            delBtn.style.cssText = 'font-size:14px; cursor:pointer; margin-left:2px;';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                tripDays.splice(di, 1);
                if (activeDayIdx >= tripDays.length) activeDayIdx = tripDays.length - 1;
                updateTripUI();
            };
            tab.appendChild(delBtn);
        }

        tab.onclick = () => { activeDayIdx = di; updateTripUI(); };
        tabContainer.appendChild(tab);
    });

    // Add Day button
    if (true) {
        const addDayBtn = document.createElement('button');
        addDayBtn.textContent = '+ Add Day';
        addDayBtn.style.cssText = 'padding:6px 12px; border-radius:20px; border:2px dashed #bbb; background:none; color:#888; font-size:13px; font-weight:600; cursor:pointer;';

        addDayBtn.onclick = () => {
            const prevDay = tripDays[tripDays.length - 1];
            const initialStops = [];

            // 🔥 CARRY-OVER LOGIC: Clone the last stop of the previous day
            if (prevDay && prevDay.stops.length > 0) {
                const lastStop = prevDay.stops[prevDay.stops.length - 1];
                initialStops.push({ ...lastStop });
            }

            tripDays.push({ color: DAY_COLORS[tripDays.length % DAY_COLORS.length], stops: initialStops, notes: "" });
            activeDayIdx = tripDays.length - 1;
            updateTripUI();
        };
        tabContainer.appendChild(addDayBtn);
    }


    // --- DAY MANAGEMENT ACTION BAR (HIDDEN BEHIND EDIT MODE) ---
    let dayManager = document.getElementById('day-management-bar');
    if (!dayManager) {
        dayManager = document.createElement('div');
        dayManager.id = 'day-management-bar';
        list.parentElement.insertBefore(dayManager, list);
    }

    if (window.isTripEditMode) {
        const canMoveLeft = activeDayIdx > 0;
        const canMoveRight = activeDayIdx < tripDays.length - 1;
        const canAddDay = true;

        dayManager.innerHTML = `
            <div style="display: flex; gap: 8px; margin-bottom: 10px; padding: 8px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;">
                <button onclick="window.shiftDayLeft()" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 6px; color: #475569; border: 1px solid #cbd5e1; background: white;" ${!canMoveLeft ? 'disabled' : ''}>← Shift Day</button>
                <button onclick="window.insertDayAfter()" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 6px; color: #15803d; border: 1px solid #bbf7d0; background: #f0fdf4;" ${!canAddDay ? 'disabled' : ''}>+ Insert Day</button>
                <button onclick="window.shiftDayRight()" style="flex: 1; padding: 6px; font-size: 11px; font-weight: 700; border-radius: 6px; color: #475569; border: 1px solid #cbd5e1; background: white;" ${!canMoveRight ? 'disabled' : ''}>Shift Day →</button>
            </div>
        `;
        dayManager.style.display = 'block';
    } else {
        dayManager.style.display = 'none';
    }

    // ── Render Stops for Active Day ──
    const activeDay = tripDays[activeDayIdx];

    // 🔥 STATE: Track if the user is editing the list
    if (typeof window.isTripEditMode === 'undefined') window.isTripEditMode = false;
    window.toggleTripEditMode = () => {
        window.isTripEditMode = !window.isTripEditMode;
        updateTripUI();
    };

    // Clear list FIRST, then build fresh content
    list.innerHTML = '';

    // 🔥 EDIT TOGGLE (High density)
    if (activeDay.stops.length > 0) {
        const actionBar = document.createElement('div');
        actionBar.style.cssText = 'display: flex; justify-content: flex-end; align-items: center; margin-bottom: 12px; padding: 0 4px;';

        let rightHtml = `<button onclick="toggleTripEditMode()" class="glass-btn" style="background: ${window.isTripEditMode ? '#e8f5e9' : '#f8fafc'}; border: 1px solid ${window.isTripEditMode ? '#4CAF50' : '#cbd5e1'}; color: ${window.isTripEditMode ? '#2E7D32' : '#64748b'}; font-size: 11px; font-weight: 800; padding: 6px 16px; border-radius: 8px; cursor: pointer; transition: all 0.2s;">${window.isTripEditMode ? '✅ Done Editing' : '✏️ Edit Stops & Days'}</button>`;

        actionBar.innerHTML = rightHtml;
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

        // ONLY render the messy controls if the user clicked "Edit Stops"
        if (window.isTripEditMode) {
            const moveToDayOptions = tripDays
                .map((d, di) => di !== activeDayIdx ? `<option value="${di}">Day ${di + 1}</option>` : '')
                .join('');
            const moveSelect = moveToDayOptions
                ? `<select class="move-to-day-select" data-index="${index}" style="border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px; background: white; font-size: 11px; cursor:pointer; color:#475569; outline:none; font-weight:600;">
                     <option value="">↳ Move</option>${moveToDayOptions}
                   </select>`
                : '';

            controlsHtml = `
            <div style="display: flex; gap: 6px; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(0,0,0,0.05); width: 100%;">
                ${moveSelect}
                <div style="flex: 1;"></div>
                <button class="move-up-btn" data-index="${index}" style="background:#f1f5f9; border:none; border-radius:6px; cursor:pointer; font-size:14px; color:#475569; padding:4px 10px; transition: background 0.2s; ${index === 0 ? 'visibility:hidden;' : ''}" title="Move Up">↑</button>
                <button class="move-down-btn" data-index="${index}" style="background:#f1f5f9; border:none; border-radius:6px; cursor:pointer; font-size:14px; color:#475569; padding:4px 10px; transition: background 0.2s; ${index === activeDay.stops.length - 1 ? 'visibility:hidden;' : ''}" title="Move Down">↓</button>
                <button class="remove-stop-btn" data-index="${index}" style="background:#fee2e2; border:none; border-radius:6px; color:#ef4444; font-weight:900; font-size:12px; cursor:pointer; padding:6px 12px; margin-left: 4px; transition: background 0.2s;" title="Remove">✕</button>
            </div>`;
        }

        // The base list item is now beautifully clean and readable
        li.innerHTML = `
            <div style="display: flex; flex-direction: column; width: 100%; padding: ${window.isTripEditMode ? '8px' : '12px 4px'}; background: ${window.isTripEditMode ? '#f8fafc' : 'transparent'}; border-radius: 10px; border: ${window.isTripEditMode ? '1px solid #e2e8f0' : '1px solid transparent'}; transition: all 0.2s;">
                <div style="display: flex; align-items: center; width: 100%;">
                    <span style="background:${activeDay.color}; color:white; border-radius: 6px; width: 24px; height: 24px; min-width: 24px; display: inline-flex; justify-content: center; align-items: center; font-size: 12px; font-weight:900; margin-right: 12px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">${index + 1}</span>
                    <span style="font-weight: 700; color: #1e293b; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;" title="${stop.name}">${stop.name}</span>
                </div>
                ${controlsHtml}
            </div>
        `;
        list.appendChild(li);
    });

    // 🔥 GHOST BUTTON: Add Stop to Day (Empty Slot Pattern)
    const ghostBtn = document.createElement('div');
    ghostBtn.style.cssText = `margin: 10px 4px; padding: 12px; border: 2px dashed #e2e8f0; border-radius: 10px; color: #94a3b8; font-size: 12px; font-weight: 800; text-align: center; cursor: pointer; transition: all 0.2s; text-transform: uppercase; letter-spacing: 0.5px;`;
    ghostBtn.innerHTML = `➕ Add Stop to Day ${activeDayIdx + 1}`;
    ghostBtn.onmouseover = () => { ghostBtn.style.borderColor = activeDay.color; ghostBtn.style.color = activeDay.color; ghostBtn.style.background = `${activeDay.color}05`; };
    ghostBtn.onmouseout = () => { ghostBtn.style.borderColor = '#e2e8f0'; ghostBtn.style.color = '#94a3b8'; ghostBtn.style.background = 'transparent'; };
    ghostBtn.onclick = () => {
        const globalSearch = document.getElementById('park-search');
        if (globalSearch) {
            globalSearch.focus();
            globalSearch.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Flash the search bar to draw the eye
            globalSearch.style.boxShadow = `0 0 0 4px ${activeDay.color}44`;
            setTimeout(() => globalSearch.style.boxShadow = '', 1500);

            // Auto-switch to map if they are looking at the planner
            document.querySelector('[data-target="map-view"]')?.click();
        }
    };
    list.appendChild(ghostBtn);

    // ── Render Notes for Active Day ──
    const notesContainer = document.getElementById('day-notes-container');
    if (notesContainer) {
        notesContainer.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <label style="font-size:11px; font-weight:800; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin:0;">📋 Day ${activeDayIdx + 1} Notes</label>
                <button onclick="exportDayToMaps(${activeDayIdx})" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe; font-size:10px; font-weight:800; padding:4px 8px; border-radius:6px; cursor:pointer; display:flex; align-items:center; gap:4px; transition:all 0.2s;" onmouseover="this.style.background='#dbeafe'" onmouseout="this.style.background='#eff6ff'">🗺️ Drive Day ${activeDayIdx + 1}</button>
            </div>
            <textarea id="day-notes-textarea" 
                placeholder="Hiking trails, confirmation #s, lunch spots..." 
                style="width:100%; height:60px; padding:10px; border-radius:8px; border:none; background:#f8fafc; font-size:13px; outline:none; transition:box-shadow 0.2s; resize:none; font-family:inherit; color:#334155; box-shadow: inset 0 2px 4px rgba(0,0,0,0.02);"
                onfocus="this.style.boxShadow='inset 0 0 0 2px ${activeDay.color}'"
                onblur="this.style.boxShadow='inset 0 2px 4px rgba(0,0,0,0.02)'"
            >${activeDay.notes || ""}</textarea>
            <div style="text-align:right; font-size:10px; color:#cbd5e1; margin-top:4px;">
                <span id="char-count">${(activeDay.notes || "").length}</span> / 1000
            </div>
        `;

        const textarea = document.getElementById('day-notes-textarea');
        const charCount = document.getElementById('char-count');
        textarea.oninput = (e) => {
            let val = e.target.value;
            if (val.length > 1000) {
                val = val.substring(0, 1000);
                e.target.value = val;
            }
            activeDay.notes = val;
            charCount.textContent = val.length;
        };
    }

    // Wire up buttons
    document.querySelectorAll('.remove-stop-btn').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            tripDays[activeDayIdx].stops.splice(idx, 1);
            updateTripUI();
        };
    });
    document.querySelectorAll('.move-up-btn').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            if (idx > 0) {
                const stops = tripDays[activeDayIdx].stops;
                [stops[idx], stops[idx - 1]] = [stops[idx - 1], stops[idx]];
                updateTripUI();
            }
        };
    });
    document.querySelectorAll('.move-down-btn').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-index'));
            const stops = tripDays[activeDayIdx].stops;
            if (idx < stops.length - 1) {
                [stops[idx], stops[idx + 1]] = [stops[idx + 1], stops[idx]];
                updateTripUI();
            }
        };
    });
    document.querySelectorAll('.move-to-day-select').forEach(sel => {
        sel.onchange = (e) => {
            const fromIdx = parseInt(e.currentTarget.getAttribute('data-index'));
            const toDayIdx = parseInt(e.target.value);
            if (isNaN(toDayIdx)) return;
            const stop = tripDays[activeDayIdx].stops.splice(fromIdx, 1)[0];
            tripDays[toDayIdx].stops.push(stop);
            updateTripUI();
        };
    });

    // --- GLOBAL END BOOKEND ---
    let endEl = document.getElementById('ui-end-node');
    if (!endEl) {
        const wrapper = document.getElementById('itinerary-timeline-wrapper');
        if (wrapper) {
            endEl = document.createElement('div');
            endEl.id = 'ui-end-node';
            wrapper.appendChild(endEl);
        }
    }

    if (endEl && window.tripEndNode) {
        endEl.innerHTML = `<div onclick="editBookend('end')" style="cursor:pointer; background: #fef2f2; border: 2px solid #ef4444; border-radius: 8px; padding: 10px; margin-top: 10px; margin-bottom: 0; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 6px rgba(239,68,68,0.05); transition: transform 0.1s;">
                <div style="font-size: 13px; font-weight: 900; color: #b91c1c; display: flex; align-items: center; gap: 8px;">
                    <span style="background: #ef4444; color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; justify-content: center; align-items: center; font-size: 11px;">B</span> 
                    TRIP END: <span style="font-weight:600; color:#333; margin-left: 4px;">${window.tripEndNode.name}</span>
                </div>
                <div style="font-size:10px; color:#ef4444; font-weight:800; text-transform:uppercase;">Edit</div>
            </div>`;
    } else if (endEl) {
        endEl.innerHTML = `<button onclick="editBookend('end')" style="width:100%; cursor:pointer; background: #fff; border: 1px dashed #ef4444; color:#b91c1c; border-radius: 8px; padding: 10px; margin-top: 10px; margin-bottom: 0; font-weight:800; text-transform:uppercase; font-size:11px;">+ Set Trip End</button>`;
    }

    // Always attempt to update map visuals even if UI elements had issues
    try {
        updateTripMapVisuals();
    } catch (e) {
        console.error("Map visuals update failed:", e);
    }
}

// Add Current Location Handler
const addCurrentLocBtn = document.getElementById('add-current-loc-btn');
if (addCurrentLocBtn) {
    addCurrentLocBtn.onclick = () => {
        const addLocStop = (lat, lng) => {
            window.addStopToTrip({ name: "My Current Location", lat, lng });
        };
        if (userLocationMarker) {
            const ll = userLocationMarker.getLatLng();
            addLocStop(ll.lat, ll.lng);
        } else {
            alert("Getting your location... please wait.");
            map.locate({ setView: false });
            map.once('locationfound', (e) => addLocStop(e.latlng.lat, e.latlng.lng));
            map.once('locationerror', () => alert("Could not find your location. Please ensure GPS is active."));
        }
    };
}

// --- UNIVERSAL GEOCODER FOR START/STOP/END ---
const townSearchInput = document.getElementById('town-search-input');

// --- SMART UNIVERSAL GEOCODER ---
// --- SMART UNIVERSAL GEOCODER ---
async function executeGeocode(query, targetType) {
    if (!query) return;
    const lowerQ = query.trim().toLowerCase();

    // 🔥 SMART INTERCEPT: GPS Routing
    if (lowerQ === 'my location' || lowerQ === 'current location') {
        const mainSearch = document.getElementById('park-search');
        if (targetType === 'stop' && mainSearch) mainSearch.value = 'Locating GPS...';
        else {
            const inlineInput = document.getElementById(`inline-${targetType}-input`);
            if (inlineInput) inlineInput.value = 'Locating GPS...';
        }

        navigator.geolocation.getCurrentPosition((pos) => {
            const node = { name: "My Current Location", lat: pos.coords.latitude, lng: pos.coords.longitude };
            if (targetType === 'start') window.tripStartNode = node;
            else if (targetType === 'end') window.tripEndNode = node;
            else window.addStopToTrip(node);

            if (targetType === 'stop' && mainSearch) {
                mainSearch.value = '';
                activeSearchQuery = '';
            }
            updateTripUI();
        }, () => {
            alert("Could not get GPS location. Please check browser permissions.");
            if (targetType === 'stop' && mainSearch) mainSearch.value = '';
        }, { enableHighAccuracy: true });
        return;
    }

    // Standard API Search
    try {
        incrementRequestCount();
        const hardcodedApiKey = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImQ0YTM5ZTM2NTQ2NDRhNThhOWUxNDNjMmQyYTYzZDRkIiwiaCI6Im11cm11cjY0In0=";
        const url = `https://api.openrouteservice.org/geocode/search?api_key=${hardcodedApiKey}&text=${encodeURIComponent(query)}&size=5&boundary.country=US`;

        const response = await fetch(url);
        const data = await response.json();

        // 🔥 THE FIX: Dynamically target where the suggestions should render
        const disambiguationContainer = (targetType === 'stop')
            ? document.getElementById('search-suggestions')
            : document.getElementById(targetType === 'start' ? 'inline-suggest-start' : 'inline-suggest-end');

        if (data.features && data.features.length > 0) {
            if (data.features.length === 1) {
                const coords = data.features[0].geometry.coordinates;
                const node = { name: data.features[0].properties.label || query, lat: coords[1], lng: coords[0] };
                if (targetType === 'start') window.tripStartNode = node;
                else if (targetType === 'end') window.tripEndNode = node;
                else window.addStopToTrip(node);

                // Complete Omni-Search Reset & Map Pan
                const mainSearch = document.getElementById('park-search');
                const clearBtn = document.getElementById('clear-search-btn');

                if (mainSearch) mainSearch.value = '';
                if (typeof activeSearchQuery !== 'undefined') activeSearchQuery = '';
                if (clearBtn) clearBtn.style.display = 'none';

                // Restore the normal map pins
                if (typeof updateMarkers === 'function') updateMarkers();

                // Pan map to the new custom location
                if (typeof map !== 'undefined') map.setView([node.lat, node.lng], 10, { 
                    animate: !instantNav,
                    duration: instantNav ? 0 : 0.4
                });

                updateTripUI();
            } else {
                if (disambiguationContainer) {
                    // Match the "Backend" style from the user's screenshot
                    let actionText = targetType === 'start' ? '🟢 TRIP START' : (targetType === 'end' ? '🔴 TRIP END' : '➕ ADD STOP');
                    disambiguationContainer.innerHTML = `
                        <div style="background: #f0fdf4; border-bottom: 1px solid #bbf7d0; padding: 10px; font-size: 11px; color: #15803d; font-weight: 800; text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
                            📍 SELECT FOR ${actionText}
                        </div>`;

                    data.features.forEach(f => {
                        const div = document.createElement('div');
                        div.className = 'suggestion-item';
                        div.style.cssText = 'padding: 12px; border-bottom: 1px solid #f1f5f9; cursor: pointer; transition: background 0.2s;';
                        div.innerHTML = `<span style="font-weight: 700; color: #1e293b;">${f.properties.label}</span>`;

                        div.onclick = () => {
                            const coords = f.geometry.coordinates;
                            const node = { name: f.properties.label, lat: coords[1], lng: coords[0] };
                            if (targetType === 'start') window.tripStartNode = node;
                            else if (targetType === 'end') window.tripEndNode = node;
                            else window.addStopToTrip(node);

                            // Complete Omni-Search Reset & Map Pan
                            const mainSearch = document.getElementById('park-search');
                            const clearBtn = document.getElementById('clear-search-btn');

                            if (mainSearch) mainSearch.value = '';
                            if (typeof activeSearchQuery !== 'undefined') activeSearchQuery = '';
                            if (clearBtn) clearBtn.style.display = 'none';

                            // Restore the normal map pins
                            if (typeof updateMarkers === 'function') updateMarkers();

                            // Pan map to the new custom location
                            if (typeof map !== 'undefined') map.setView([node.lat, node.lng], 10, { 
                                animate: !instantNav,
                                duration: instantNav ? 0 : 0.4
                            });

                            disambiguationContainer.style.display = 'none';
                            updateTripUI();
                        };
                        disambiguationContainer.appendChild(div);
                    });

                    disambiguationContainer.style.display = 'block';
                }
            }
        } else {
            if (disambiguationContainer) {
                disambiguationContainer.innerHTML = `<p style="padding: 10px; font-size: 12px; color: #dc2626; text-align: center; font-weight: bold;">Location not found.</p>`;
            }
        }
    } catch (err) {
        alert("Search service unavailable.");
    }
}

// Note: planner robust listeners removed as planner search is now global.

// Helper: save current tripDays to Firestore without routing
async function saveCurrentTrip() {
    const user = (typeof firebase !== 'undefined') ? firebase.auth().currentUser : null;
    if (!user) {
        alert('Please sign in to save routes. Tap the Profile tab to log in.');
        return false;
    }
    incrementRequestCount(); // Track Firestore Write
    if (getTotalStops() === 0) {
        alert('Nothing to save — add some stops first!');
        return false;
    }

    const nameInput = document.getElementById('tripNameInput');
    const tripName = nameInput ? nameInput.value.trim() : "";
    if (!tripName) {
        alert('Please enter a name for your trip.');
        if (nameInput) nameInput.focus();
        return false;
    }

    try {
        const routeData = {
            tripName: tripName,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            tripDays: tripDays.map(d => ({
                color: d.color,
                stops: d.stops.map(s => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng })),
                notes: d.notes || ""
            }))
        };
        await firebase.firestore()
            .collection('users').doc(user.uid)
            .collection('savedRoutes').add(routeData);
        // Refresh the saved routes panel immediately
        loadSavedRoutes(user.uid);
        return true;
    } catch (err) {
        console.error('Save failed:', err);
        alert('Could not save route: ' + err.message);
        return false;
    }
}

const optimizeTripBtn = document.getElementById('optimize-trip-btn');
if (optimizeTripBtn) {
    optimizeTripBtn.onclick = () => {
        document.getElementById('optimizer-modal').style.display = 'flex';
    };
}

if (clearTripBtn) {
    clearTripBtn.onclick = () => {
        if (getTotalStops() > 0) {
            const proceed = confirm("Are you sure you want to clear your trip? Make sure you've saved your route first if you want to keep it!");
            if (!proceed) return;
        }

        // Wipe local state
        tripDays = [{ color: DAY_COLORS[0], stops: [] }];
        activeDayIdx = 0;
        window.tripStartNode = null;
        window.tripEndNode = null;

        // Remove map layers
        currentRouteLayers.forEach(layer => map.removeLayer(layer));
        currentRouteLayers = [];
        draftTripLines.forEach(line => map.removeLayer(line)); // 🔥 Clear draft lines too
        draftTripLines = [];

        // Clear name input
        const nameInput = document.getElementById('tripNameInput');
        if (nameInput) nameInput.value = '';

        // Clear telemetry
        const telemetryEl = document.getElementById('route-telemetry');
        if (telemetryEl) {
            telemetryEl.style.display = 'none';
            telemetryEl.innerHTML = '';
        }

        updateTripUI();
    };
}

const saveRouteBtn = document.getElementById('save-route-btn');
if (saveRouteBtn) {
    saveRouteBtn.onclick = async () => {
        saveRouteBtn.textContent = 'Saving...';
        saveRouteBtn.disabled = true;
        const saved = await saveCurrentTrip();
        saveRouteBtn.textContent = '💾 Save';
        saveRouteBtn.disabled = false;
        if (saved) alert('✅ Trip saved! Check Profile → Saved Routes.');
    };
}

let currentRouteLayers = [];

async function generateAndRenderTripRoute() {
    // ── Auth Gate ──
    const user = (typeof firebase !== 'undefined') ? firebase.auth().currentUser : null;
    if (!user) {
        alert("Please sign in to generate and save routes. Tap the Profile tab to log in.");
        return;
    }
    incrementRequestCount(); // Track High-Cost Routing Request


    const daysWithStops = tripDays.filter(d => d.stops.length >= 2);

    if (daysWithStops.length === 0) {
        alert("Each day needs at least 2 stops to generate a route. Days with a single stop are skipped.");
        return;
    }

    // Clear old route layers AND draft lines
    currentRouteLayers.forEach(layer => map.removeLayer(layer));
    currentRouteLayers = [];
    draftTripLines.forEach(line => map.removeLayer(line)); // 🔥 Add this line
    draftTripLines = []; // 🔥 Add this line

    if (startRouteBtn) {
        startRouteBtn.textContent = 'Calculating...';
        startRouteBtn.disabled = true;
    }

    const hardcodedApiKey = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImQ0YTM5ZTM2NTQ2NDRhNThhOWUxNDNjMmQyYTYzZDRkIiwiaCI6Im11cm11cjY0In0=";
    const allBounds = [];
    let anySucceeded = false;
    let totalDistMeters = 0;
    let totalDurSeconds = 0;

    for (let i = 0; i < daysWithStops.length; i++) {
        const day = daysWithStops[i];
        let dayStops = [...day.stops];

        // 🔥 THE MAGIC: Secretly inject the Bookends before hitting the Routing API
        if (i === 0 && window.tripStartNode) {
            dayStops.unshift(window.tripStartNode);
        }
        if (i === daysWithStops.length - 1 && window.tripEndNode) {
            dayStops.push(window.tripEndNode);
        }

        try {
            const orsCoordinates = dayStops.map(s => [Number(s.lng), Number(s.lat)]);
            // console.log(`Routing Day (${day.color})...`, orsCoordinates);

            const response = await fetch("https://api.openrouteservice.org/v2/directions/driving-car/geojson", {
                method: "POST",
                headers: {
                    "Authorization": hardcodedApiKey,
                    "Content-Type": "application/json",
                    "Accept": "application/json, application/geo+json; charset=utf-8"
                },
                body: JSON.stringify({
                    coordinates: orsCoordinates,
                    radiuses: new Array(orsCoordinates.length).fill(-1)
                })
            });

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error?.message || "ORS error");
            }

            const geoJSONData = await response.json();
            const layer = L.geoJSON(geoJSONData, {
                style: () => ({ color: day.color, weight: 5, opacity: 0.85, dashArray: '10, 8' })
            }).addTo(map);

            currentRouteLayers.push(layer);
            allBounds.push(layer.getBounds());
            anySucceeded = true;

            const summary = geoJSONData.features[0].properties.summary;
            if (summary) {
                totalDistMeters += summary.distance;
                totalDurSeconds += summary.duration;
            }

        } catch (err) {
            console.error(`Route failed for day (${day.color}):`, err);
            alert(`A day's route failed: ${err.message}`);
        }
    }

    if (allBounds.length > 0) {
        const combined = allBounds.reduce((acc, b) => acc.extend(b), allBounds[0]);
        map.fitBounds(combined, { 
            padding: [50, 50],
            animate: !instantNav,
            duration: instantNav ? 0 : 0.5
        });
    }

    const telemetryEl = document.getElementById('route-telemetry');
    if (telemetryEl) {
        if (anySucceeded) {
            const miles = (totalDistMeters * 0.000621371).toFixed(1);
            const hrs = Math.floor(totalDurSeconds / 3600);
            const mins = Math.floor((totalDurSeconds % 3600) / 60);
            telemetryEl.style.display = 'block';
            telemetryEl.innerHTML = `<span style="font-weight: 700; color: #1976D2;">Total Drive:</span> ${miles} Miles | ${hrs}h ${mins}m`;
        } else {
            telemetryEl.style.display = 'none';
        }
    }

    if (anySucceeded) {
        // Automatically switch back to the map to see the new route
        document.querySelector('[data-target="map-view"]')?.click();
    }

    if (startRouteBtn) {
        startRouteBtn.textContent = 'Generate Route';
        startRouteBtn.disabled = false;
    }
}

if (startRouteBtn) {
    startRouteBtn.onclick = () => {
        if (getTotalStops() === 0) return;
        generateAndRenderTripRoute();
    };
}


// --- BULLETPROOF MODAL LOGIC ---
document.addEventListener('click', (e) => {
    const modal = document.getElementById('scoring-modal');
    if (!modal) return;

    // Open Modal
    if (e.target.closest('#scoring-info-btn')) {
        modal.style.display = 'flex';
    }

    // Close Modal (clicking X button or the dark background overlay)
    if (e.target.closest('#close-scoring-modal') || e.target === modal) {
        modal.style.display = 'none';
    }
});

// --- UPDATED VAULT SHARE (Now with Global #1 Logic & Web-to-Canvas Fix) ---
window.shareVaultCard = async function () {
    const btn = document.getElementById('share-vault-btn');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '📸 Generating...';
    btn.disabled = true;

    try {
        const visitedArray = Array.from(userVisitedPlaces.values());
        const uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
        const achievements = await gamificationEngine.evaluateAndStoreAchievements(uid, visitedArray, null, window.currentWalkPoints || 0);

        // Check if user is GLOBAL #1 (Alpha Dog Unlocked)
        const isGlobalNumberOne = achievements.mysteryFeats.some(f => f.id === 'alphaDog' && f.status === 'unlocked');

        let allUnlocked = [
            ...achievements.mysteryFeats, ...achievements.rareFeats, ...achievements.paws, ...achievements.stateBadges
        ].filter(b => b.status === 'unlocked');

        allUnlocked.sort((a, b) => {
            if (a.isMystery !== b.isMystery) return a.isMystery ? -1 : 1;
            if (a.tier !== b.tier) return a.tier === 'verified' ? -1 : 1;
            return (b.dateEarnedTs || 0) - (a.dateEarnedTs || 0);
        });

        const top3 = allUnlocked.slice(0, 3);

        // Inject Title. If #1, add the massive Crown Flex.
        const titleEl = document.getElementById('export-title');
        titleEl.innerHTML = isGlobalNumberOne ? `👑 GLOBAL #1<br><span style="font-size: 50px; color: #94a3b8;">${achievements.title}</span>` : achievements.title;

        document.getElementById('export-score').textContent = `${achievements.totalScore} PTS`;

        const badgeContainer = document.getElementById('export-badges-container');
        badgeContainer.innerHTML = '';

        top3.forEach(b => {
            let bg = b.tier === 'verified' ? 'linear-gradient(135deg, #FFDF00, #DAA520, #B8860B)' : 'linear-gradient(135deg, #A0522D, #8B4513)';
            let border = b.tier === 'verified' ? '#996515' : '#5C4033';
            let textColor = b.tier === 'verified' ? '#3b2f00' : '#fffaf0';

            if (b.isMystery) {
                bg = 'linear-gradient(135deg, #312e81, #7e22ce, #c026d3)';
                border = '#e879f9';
                textColor = '#ffffff';
            }

            let subtitle = b.desc || b.hint || '';
            if (!subtitle && b.id.includes('Paw')) subtitle = 'Verified Check-ins';
            if (!subtitle && b.id.includes('state')) subtitle = '100% Region Cleared';

            badgeContainer.innerHTML += `
                <div style="width: 240px; height: 340px; background: ${bg}; border: 6px solid ${border}; border-radius: 30px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); text-align: center; flex-shrink: 0;">
                    <div style="font-size: 60px; margin-bottom: 12px;">${b.icon}</div>
                    <div style="font-size: 20px; font-weight: 900; color: ${textColor}; text-transform: uppercase; line-height: 1.1; margin-bottom: 12px;">${b.name}</div>
                    <div style="font-size: 13px; font-weight: 600; color: ${textColor}; opacity: 0.85; line-height: 1.4; padding: 0 10px;">${subtitle}</div>
                </div>
            `;
        });

        const canvas = await html2canvas(document.getElementById('vault-export-template'), { scale: 2, useCORS: true, backgroundColor: '#0f172a' });
        canvas.toBlob(async (blob) => {
            const file = new File([blob], "My_Bark_Ranger_Vault.png", { type: "image/png" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file] }); } catch (err) { }
            } else {
                const link = document.createElement('a'); link.download = 'My_Bark_Ranger_Vault.png'; link.href = canvas.toDataURL('image/png'); link.click();
            }
            btn.innerHTML = originalText; btn.disabled = false;
        }, 'image/png');
    } catch (e) { alert('Export failed.'); btn.innerHTML = originalText; btn.disabled = false; }
};

// --- NEW: THE SINGLE MILESTONE FLEX ---
window.shareSingleBadge = async function (name, icon, tier, isMystery, subtitle) {
    try {
        let bg = tier === 'verified' ? 'linear-gradient(135deg, #FFDF00, #DAA520, #B8860B)' : 'linear-gradient(135deg, #A0522D, #8B4513)';
        let border = tier === 'verified' ? '#996515' : '#5C4033';
        let textColor = tier === 'verified' ? '#3b2f00' : '#fffaf0';

        if (isMystery === 'true' || isMystery === true) {
            bg = 'linear-gradient(135deg, #312e81, #7e22ce, #c026d3)';
            border = '#e879f9';
            textColor = '#ffffff';
        }

        const container = document.getElementById('single-export-card-container');
        container.innerHTML = `
            <div style="width: 500px; height: 600px; background: ${bg}; border: 12px solid ${border}; border-radius: 50px; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px; box-shadow: 0 40px 80px rgba(0,0,0,0.6); text-align: center;">
                <div style="font-size: 150px; margin-bottom: 30px; filter: drop-shadow(0 10px 10px rgba(0,0,0,0.4));">${icon}</div>
                <div style="font-size: 48px; font-weight: 900; color: ${textColor}; text-transform: uppercase; line-height: 1.1; margin-bottom: 20px;">${name}</div>
                <div style="font-size: 24px; font-weight: 600; color: ${textColor}; opacity: 0.9; line-height: 1.4; padding: 0 20px;">${subtitle || ''}</div>
            </div>
        `;

        const canvas = await html2canvas(document.getElementById('single-export-template'), { scale: 2, useCORS: true, backgroundColor: '#0f172a' });
        canvas.toBlob(async (blob) => {
            const file = new File([blob], `Unlocked_${name.replace(/\s+/g, '_')}.png`, { type: "image/png" });
            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                try { await navigator.share({ files: [file] }); } catch (err) { }
            } else {
                const link = document.createElement('a'); link.download = file.name; link.href = canvas.toDataURL('image/png'); link.click();
            }
        }, 'image/png');
    } catch (e) { alert('Export failed.'); }
};

// --- THE OUT-AND-BACK VERIFICATION ENGINE ---
function getDistanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
    const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ====== ADVANCED TRACKING ENGINE ======
const WalkTracker = {
    watchId: null,
    wakeLock: null,
    points: [],
    totalMiles: 0,
    lastValidLocation: null,
    isBlackedOut: false,
    blackoutStartTime: 0,
    boundVisibilityHandler: null,

    async start() {
        if (!navigator.geolocation) return alert('GPS not supported');
        
        this.points = [];
        this.totalMiles = 0;
        this.lastValidLocation = null;

        // 1. Request Wake Lock to stop iOS from sleeping
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
            }
        } catch (err) {
            console.warn('Wake Lock failed/denied:', err);
        }

        // 2. Start continuous high-fidelity tracking
        const btn = document.getElementById('training-action-btn');
        if (btn) {
            btn.textContent = 'Tracking Active 🟢';
            btn.className = 'glass-btn training-btn active';
            // We overwrite the onclick to stop; initTrainingUI will restore it later
            btn.onclick = () => this.stopAndSave();
        }
        
        const cancelBtn = document.getElementById('cancel-training-btn');
        if (cancelBtn) cancelBtn.style.display = 'block';

        this.watchId = navigator.geolocation.watchPosition(
            (pos) => this.processGpsPing(pos),
            (err) => console.error("GPS Error:", err),
            { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );

        // Show the global banner
        this.showFloatingBanner();

        // 3. Set up Blackout Detection with bound context
        this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
        document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    },

    processGpsPing(pos) {
        if (this.isBlackedOut) return; // Ignore stale pings queuing up during sleep

        const accMeters = pos.coords.accuracy;
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;

        // FILTER 1: Ignore garbage data (radius > 25 meters means weak signal)
        if (accMeters > 25) return; 

        if (!this.lastValidLocation) {
            this.lastValidLocation = { lat, lng, ts: Date.now() };
            this.points.push(this.lastValidLocation);
            return;
        }

        const distMeters = getDistanceMeters(this.lastValidLocation.lat, this.lastValidLocation.lng, lat, lng);

        // FILTER 2: Anti-Drift. Only count movement if it's > 5 meters from the last point.
        if (distMeters > 5) {
            const miles = distMeters * 0.000621371;
            this.totalMiles += miles;
            this.lastValidLocation = { lat, lng, ts: Date.now() };
            this.points.push(this.lastValidLocation);
            
            // Update UI real-time
            this.updateDistanceUI();
        }
    },

    handleVisibilityChange() {
        if (document.hidden) {
            // App went to background
            this.isBlackedOut = true;
            this.blackoutStartTime = Date.now();
        } else {
            // App came back to foreground
            this.isBlackedOut = false;
            const blackoutDurationMins = (Date.now() - this.blackoutStartTime) / 60000;
            
            // Re-acquire Wake Lock if it was dropped (iOS Safari quirk)
            if ('wakeLock' in navigator) {
                navigator.wakeLock.request('screen').then(wl => this.wakeLock = wl).catch(()=>{});
            }

            // If they were locked out for more than 2 minutes, we likely missed a chunk of the loop
            if (blackoutDurationMins > 2) {
                this.triggerBlackoutFallback(blackoutDurationMins);
            }
        }
    },

    triggerBlackoutFallback(minutesLost) {
        const manualMiles = prompt(`Welcome back! iOS paused your GPS for ${Math.round(minutesLost)} minutes while your screen was off.\n\nWe successfully tracked ${this.totalMiles.toFixed(2)} miles before the pause. How many missing miles did you walk while the screen was off? (Enter 0 if none)`);
        
        const parsed = parseFloat(manualMiles);
        if (!isNaN(parsed) && parsed > 0) {
            this.totalMiles += parsed;
            this.updateDistanceUI();
        }
    },

    async stopAndSave() {
        const finalMiles = this.totalMiles;
        this.cleanup();

        if (finalMiles < 0.05) {
            alert("Not enough distance recorded to log an expedition.");
        } else {
            alert(`Expedition Complete! You logged ${finalMiles.toFixed(2)} miles.`);
            await processMileageAddition(finalMiles, 'GPS Active Track');
        }
        
        initTrainingUI(); // Resets UI and restores original onclick
    },

    cancel() {
        this.cleanup();
        initTrainingUI();
    },

    cleanup() {
        if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
        if (this.boundVisibilityHandler) document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
        if (this.wakeLock) {
            this.wakeLock.release().catch(()=>{});
            this.wakeLock = null;
        }
        
        // Hide the global banner
        this.hideFloatingBanner();

        this.watchId = null;
        this.boundVisibilityHandler = null;
        this.points = [];
        this.totalMiles = 0;
        this.lastValidLocation = null;
        this.isBlackedOut = false;
    },

    showFloatingBanner() {
        let banner = document.getElementById('live-walk-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'live-walk-banner';
            banner.style.cssText = `
                position: fixed;
                top: 20px; 
                left: 50%;
                transform: translateX(-50%);
                background: rgba(15, 23, 42, 0.95);
                color: white;
                padding: 10px 24px;
                border-radius: 30px;
                z-index: 10000;
                display: flex;
                align-items: center;
                gap: 8px;
                box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                border: 1px solid #10b981;
                cursor: pointer;
                font-size: 14px;
                transition: all 0.3s ease;
            `;
            banner.onclick = () => {
                const profileTab = document.querySelector('.nav-item[data-target="profile-view"]');
                if (profileTab) profileTab.click();
            };
            document.body.appendChild(banner);
            
            const style = document.createElement('style');
            style.innerHTML = `
                @keyframes pulse {
                    0% { opacity: 1; }
                    50% { opacity: 0.5; }
                    100% { opacity: 1; }
                }
            `;
            document.head.appendChild(style);
        }
        banner.innerHTML = `<span style="animation: pulse 2s infinite;">🟢</span> <strong><span id="floating-distance">0.00</span> mi</strong>`;
        banner.style.display = 'flex';
    },

    hideFloatingBanner() {
        const banner = document.getElementById('live-walk-banner');
        if (banner) banner.style.display = 'none';
    },

    updateDistanceUI() {
        // Update the main UI on the Profile Tab
        const descEl = document.getElementById('training-desc');
        if (descEl) {
            descEl.innerHTML = `Distance: <strong style="color: #10b981;">${this.totalMiles.toFixed(2)} mi</strong>`;
        }

        // Update the Global Floating Banner
        const floatDistEl = document.getElementById('floating-distance');
        if (floatDistEl) floatDistEl.textContent = this.totalMiles.toFixed(2);
    }
};

// The Live GPS Action
window.handleTrainingClick = function () {
    const btn = document.getElementById('training-action-btn');
    if (btn && btn.textContent.includes('Start')) {
        WalkTracker.start();
    } else {
        WalkTracker.stopAndSave();
    }
};

window.cancelTrainingWalk = function () {
    if (confirm("Are you sure you want to cancel your walk? You won't earn any points.")) {
        WalkTracker.cancel();
    }
};

function initTrainingUI() {
    const btn = document.getElementById('training-action-btn');
    const cancelBtn = document.getElementById('cancel-training-btn');
    const descEl = document.getElementById('training-desc');

    if (!WalkTracker.watchId) {
        if (btn) {
            btn.textContent = 'Start Walk';
            btn.className = 'glass-btn training-btn';
            btn.onclick = window.handleTrainingClick; // Restore original handler
        }
        if (cancelBtn) cancelBtn.style.display = 'none';
        if (descEl) descEl.innerHTML = 'Start walking away from home. Log your turnaround point to calculate total distance and earn <strong style="color: #f59e0b;">+0.5 PTS</strong>.';
    } else {
        if (btn) {
            btn.textContent = 'Tracking Active 🟢';
            btn.className = 'glass-btn training-btn active';
            btn.onclick = () => WalkTracker.stopAndSave();
        }
        if (cancelBtn) cancelBtn.style.display = 'block';
        if (descEl) descEl.innerHTML = `Distance: <strong style="color: #10b981;">${WalkTracker.totalMiles.toFixed(2)} mi</strong>`;
    }
}

// Run on page load
initTrainingUI();

// Force the planner UI to render immediately on load
setTimeout(() => updateTripUI(), 500);

// --- SHARE ENGINE LOGIC ---

window.shareSingleExpedition = async function () {
    const trailName = document.getElementById('celebration-trail-name').textContent;
    const template = document.getElementById('single-export-template');
    const container = document.getElementById('single-export-card-container');

    // Inject custom design into your existing export template
    container.innerHTML = `
        <div style="background: rgba(255,255,255,0.05); border: 2px solid rgba(255,255,255,0.1); border-radius: 24px; padding: 40px; text-align: center;">
            <div style="font-size: 80px; margin-bottom: 20px;">🎒</div>
            <div style="font-size: 24px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">EXPEDITION CONQUERED</div>
            <div style="font-size: 60px; font-weight: 900; color: #f59e0b;">${trailName}</div>
        </div>
    `;

    await executeCanvasExport(template, `Conquered_${trailName.replace(/\s+/g, '_')}.png`);
};

window.shareAllExpeditions = async function () {
    const template = document.getElementById('single-export-template');
    const container = document.getElementById('single-export-card-container');
    const grid = document.getElementById('completed-expeditions-grid');
    if (!grid) return;

    // Clone the UI badges into the export template layout
    container.innerHTML = `
        <div style="font-size: 24px; font-weight: 700; color: #cbd5e1; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 40px; text-align: center;">My Expedition Trophy Case</div>
        <div style="display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; max-width: 900px;">
            ${grid.innerHTML}
        </div>
    `;

    // Remove the scroll properties from the clone so it renders as a grid on the image
    const clonedElements = container.querySelectorAll('div[style*="flex: 0 0 180px"]');
    clonedElements.forEach(el => {
        el.style.flex = '1 1 calc(33% - 20px)';
        el.style.color = '#1e293b'; // Ensure text is visible
    });

    await executeCanvasExport(template, 'My_Expedition_Trophy_Case.png');
};

async function executeCanvasExport(element, filename) {
    if (!element) return;
    // Briefly move the template on-screen for rendering
    element.style.left = '0';
    element.style.zIndex = '9999';

    try {
        const canvas = await html2canvas(element, { scale: 2, backgroundColor: '#0f172a' });
        const dataUrl = canvas.toDataURL('image/png');

        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
    } catch (e) {
        console.error("Export failed", e);
        alert("Could not generate image. Please try again.");
    } finally {
        // Hide the template again
        element.style.left = '-9999px';
    }
}

// --- RANK-UP CELEBRATION SYSTEM ---
function showRankUpCelebration(oldTitle, newTitle) {
    // Create a full-screen celebration overlay
    const overlay = document.createElement('div');
    overlay.id = 'rank-up-overlay';
    overlay.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(15, 23, 42, 0.92); z-index: 99999;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        animation: fadeInOverlay 0.3s ease-out;
        backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    `;

    overlay.innerHTML = `
        <style>
            @keyframes fadeInOverlay { from { opacity: 0; } to { opacity: 1; } }
            @keyframes rankBounce { 0% { transform: scale(0.3); opacity: 0; } 50% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
            @keyframes shimmer { 0% { background-position: -200% center; } 100% { background-position: 200% center; } }
            @keyframes confettiFall { 0% { transform: translateY(-100vh) rotate(0deg); opacity: 1; } 100% { transform: translateY(100vh) rotate(720deg); opacity: 0; } }
        </style>
        <div style="text-align: center; animation: rankBounce 0.6s ease-out; max-width: 340px; padding: 0 20px;">
            <div style="font-size: 72px; margin-bottom: 16px; filter: drop-shadow(0 4px 12px rgba(245, 158, 11, 0.5));">🎖️</div>
            <div style="font-size: 12px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">RANK UP!</div>
            <div style="font-size: 14px; color: #64748b; margin-bottom: 4px; font-weight: 600; text-decoration: line-through; opacity: 0.6;">${oldTitle}</div>
            <div style="font-size: 10px; color: #f59e0b; margin-bottom: 8px;">▼</div>
            <div style="font-size: 28px; font-weight: 900; background: linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b); background-size: 200% auto; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: shimmer 2s linear infinite; margin-bottom: 20px; line-height: 1.3;">${newTitle}</div>
            <p style="font-size: 13px; color: #cbd5e1; line-height: 1.5; margin-bottom: 24px;">Congratulations, Ranger! Keep exploring to unlock the next rank.</p>
            <button onclick="document.getElementById('rank-up-overlay').remove()" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; border: none; padding: 14px 40px; border-radius: 12px; font-size: 14px; font-weight: 900; cursor: pointer; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);">
                🐾 Awesome!
            </button>
        </div>
    `;

    document.body.appendChild(overlay);

    // Spawn confetti particles
    const confettiColors = ['#f59e0b', '#3b82f6', '#10b981', '#ef4444', '#8b5cf6', '#ec4899'];
    if (!lowGfxEnabled) {
        for (let i = 0; i < 40; i++) {
            const particle = document.createElement('div');
        const color = confettiColors[Math.floor(Math.random() * confettiColors.length)];
        const left = Math.random() * 100;
        const delay = Math.random() * 2;
        const duration = 2 + Math.random() * 3;
        const size = 6 + Math.random() * 8;
        particle.style.cssText = `
            position: fixed; top: -20px; left: ${left}%; width: ${size}px; height: ${size}px;
            background: ${color}; border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
            z-index: 100000; pointer-events: none;
            animation: confettiFall ${duration}s ease-in ${delay}s forwards;
        `;
        overlay.appendChild(particle);
    }
    }

    // Auto-dismiss after 8 seconds
    setTimeout(() => {
        const el = document.getElementById('rank-up-overlay');
        if (el) el.remove();
    }, 8000);
}

// 🎯 CUSTOM ONE-FINGER ZOOM (Google Maps Style — Crash-Proof)
// Only activates on touch devices — desktop mouse/trackpad is never affected
if ('ontouchstart' in window) {
    const mapContainer = document.getElementById('map');
    let lastTap = 0;
    let isOneFingerZooming = false;
    let zoomStartY = 0;
    let initialZoom = 0;
    let holdTimer = null;
    let pendingDoubleTap = false;
    let zoomRAF = null; // requestAnimationFrame throttle

    // Disable Leaflet's built-in double-tap zoom to prevent conflicts
    map.doubleClickZoom.disable();

    // Centralized cleanup — bulletproof against state corruption
    function resetZoomState() {
        clearTimeout(holdTimer);
        holdTimer = null;
        pendingDoubleTap = false;
        if (zoomRAF) { cancelAnimationFrame(zoomRAF); zoomRAF = null; }

        if (isOneFingerZooming) {
            isOneFingerZooming = false;

            // Snap zoom to nearest 0.5 to prevent jarring jumps on next panTo
            const snappedZoom = Math.round(map.getZoom() * 2) / 2;
            map.setZoom(snappedZoom, { animate: false });
        }

        // ALWAYS restore these — safety net
        map.options.zoomSnap = 0.5;
        map.dragging.enable();
    }

    mapContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;

        // Detect Double-Tap, but WAIT for a hold before activating
        if (tapLength < 300 && tapLength > 0) {
            pendingDoubleTap = true;
            const startY = e.touches[0].clientY;

            // Only activate zoom if finger stays down for 150ms (hold gate)
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
        lastTap = currentTime;
    }, { passive: false });

    mapContainer.addEventListener('touchmove', (e) => {
        // If we're in the hold-wait period, finger movement confirms zoom intent
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
        const targetZoom = Math.min(19, Math.max(2, initialZoom + deltaY / 150));

        // 🛡️ RAF THROTTLE: Only update zoom once per animation frame (~60fps)
        // Prevents canvas renderer overload that causes freezes
        if (!zoomRAF) {
            zoomRAF = requestAnimationFrame(() => {
                map.setZoom(targetZoom, { animate: false });
                zoomRAF = null;
            });
        }
    }, { passive: false });

    // Normal touch end
    mapContainer.addEventListener('touchend', resetZoomState);
    // Touch cancelled by browser (switching apps, gesture conflict, etc.)
    mapContainer.addEventListener('touchcancel', resetZoomState);
}
