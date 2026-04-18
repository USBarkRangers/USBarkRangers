const APP_VERSION = 1;

// Initialize map centered on the US
const map = L.map('map', {
    zoomControl: false,
    worldCopyJump: true
}).setView([39.8283, -98.5795], 4);

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

    userLocationMarker = L.circleMarker(e.latlng, {
        radius: 8,
        fillColor: '#2196F3',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 1
    }).addTo(map);

    userLocationMarker.bindPopup('You are here!').openPopup();
});

map.on('locationerror', function (e) {
    alert("Could not access your location. Please check your browser permissions.");
});

// Create a marker layer group for easy clearing
const markerLayer = L.layerGroup().addTo(map);

let allPoints = [];
let activePinMarker = null;
let activeSwagFilters = new Set();
let activeSearchQuery = '';
let activeTypeFilter = 'all';

let userVisitedPlaces = new Map();
let tripQueue = [];
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
    const portalConfig = document.getElementById('manage-places-portal');
    
    if (!listEl || !countEl || !portalConfig) return;
    
    countEl.textContent = userVisitedPlaces.size;
    
    if (userVisitedPlaces.size === 0) {
        listEl.innerHTML = '<li style="color: #888; font-style: italic; padding: 10px 0;">You haven\'t marked any places yet. Get exploring!</li>';
        return;
    }
    
    listEl.innerHTML = '';
    
    // Sort alphabetically by name
    const placesArray = Array.from(userVisitedPlaces.values()).sort((a,b) => (a.name || '').localeCompare(b.name || ''));
    
    placesArray.forEach(place => {
        const li = document.createElement('li');
        li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.05);';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = place.verified ? `🐾 ${place.name}` : place.name;
        nameSpan.style.cssText = 'font-weight: 500; color: #444; flex: 1; padding-right: 10px; line-height: 1.4;';
        
        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '&times; Remove';
        removeBtn.style.cssText = 'background: rgba(244, 67, 54, 0.1); color: #D32F2F; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 700; transition: background 0.2s; white-space: nowrap;';
        
        removeBtn.onmouseover = () => removeBtn.style.background = 'rgba(244, 67, 54, 0.2)';
        removeBtn.onmouseout = () => removeBtn.style.background = 'rgba(244, 67, 54, 0.1)';
        
        removeBtn.onclick = () => {
            if (window.confirm(`Are you sure you want to remove "${place.name}" from your visited list?`)) {
                if (firebase.auth().currentUser) {
                    const docRef = firebase.firestore().collection('users').doc(firebase.auth().currentUser.uid);
                    docRef.set({ visitedPlaces: firebase.firestore.FieldValue.arrayRemove(place) }, { merge: true });
                    
                    userVisitedPlaces.delete(place.id);
                    updateMarkers();
                    updateStatsUI();
                    
                    if (activePinMarker && activePinMarker._parkData && activePinMarker._parkData.id === place.id) {
                        const btn = document.getElementById('mark-visited-btn');
                        const btnText = document.getElementById('mark-visited-text');
                        if (btn && btnText) {
                            btn.classList.remove('visited');
                            btnText.textContent = 'Mark as Visited';
                        }
                    }
                }
            }
        };
        
        li.appendChild(nameSpan);
        li.appendChild(removeBtn);
        listEl.appendChild(li);
    });
}

function evaluateAchievements(visitedPlacesMap) {
    const statesMap = {};
    let totalUniqueStates = 0;
    let maxStateVisits = 0;
    
    allPoints.forEach(p => {
        if (visitedPlacesMap.has(p.id) && p.state) {
            const st = p.state.toString().split(/[,/]/);
            st.forEach(s => {
                const trimmed = s.trim().toUpperCase();
                if (trimmed) statesMap[trimmed] = (statesMap[trimmed] || 0) + 1;
            });
        }
    });
    
    totalUniqueStates = Object.keys(statesMap).length;
    for (let count of Object.values(statesMap)) {
        if (count > maxStateVisits) maxStateVisits = count;
    }
    
    let verifiedVisits = 0;
    visitedPlacesMap.forEach((p) => {
        if (p.verified) verifiedVisits++;
    });
    
    const badges = [
        { id: 'explorer', name: 'The Explorer', icon: '🗺️', desc: 'Visit 5+ unique states', unlocked: totalUniqueStates >= 5 },
        { id: 'local-legend', name: 'The Local Legend', icon: '🏡', desc: 'Visit 3+ parks in a single state', unlocked: maxStateVisits >= 3 },
        { id: 'golden-paw', name: 'The Golden Paw', icon: '🏆', desc: '10+ Verified Check-Ins', unlocked: verifiedVisits >= 10 }
    ];
    
    const grid = document.getElementById('trophy-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    badges.forEach(b => {
        const card = document.createElement('div');
        card.className = `trophy-card ${b.unlocked ? 'unlocked' : 'locked'}`;
        card.innerHTML = `
            <div class="trophy-icon">${b.icon}</div>
            <div class="trophy-info">
                <div class="trophy-name">${b.name} ${b.unlocked ? '' : '🔒'}</div>
                <div class="trophy-desc">${b.desc}</div>
            </div>
        `;
        grid.appendChild(card);
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
    
    totalScore = (verifiedCount * 2) + regularCount;
    
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
    
    // Leaderboard sync
    if (typeof firebase !== 'undefined' && firebase.auth().currentUser && totalScore > 0) {
        const u = firebase.auth().currentUser;
        firebase.firestore().collection('leaderboard').doc(u.uid).set({
            displayName: u.displayName || 'Bark Ranger',
            photoURL: u.photoURL || '',
            totalVisited: totalScore,
            hasVerified: (verifiedCount > 0),
            lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch(err => console.log('Leaderboard sync error:', err));
    }
    
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

// Close panel
closeSlideBtn.addEventListener('click', () => {
    slidePanel.classList.remove('open');
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
let currentPhotoImg = null;
let currentLogoImg = null;

if (wmUpload) {
    currentLogoImg = new Image();
    currentLogoImg.src = 'WatermarkBARK.PNG';

    function drawWatermark(logoScalePercent) {
        if (!currentPhotoImg || !currentLogoImg) return;

        const ctx = wmCanvas.getContext('2d');
        const MAX_WIDTH = 4096;
        let width = currentPhotoImg.width;
        let height = currentPhotoImg.height;

        if (width > MAX_WIDTH) {
            height = height * (MAX_WIDTH / width);
            width = MAX_WIDTH;
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
        ctx.drawImage(currentLogoImg, logoX, logoY, logoWidthPx, logoHeightPx); // Eliminated expensive real-time JPEG encoding to fix slider lag

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

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                currentPhotoImg = img;
                if (wmLogoSize) {
                    wmLogoSize.value = 10;
                    wmLogoSizeVal.textContent = '10%';
                }
                drawWatermark(10);
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });

    wmDownload.addEventListener('click', () => {
        const link = document.createElement('a');
        link.download = 'bark-ranger-swag-polaroid.jpg';
        link.href = wmCanvas.toDataURL('image/jpeg', 1.0);
        link.click();
    });

    const wmClearBtn = document.getElementById('wm-clear');
    if (wmClearBtn) {
        wmClearBtn.addEventListener('click', () => {
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

        const iconFileName = (parkCategory === 'National') ? 'bark-logo.jpeg' : 'bark-tag.jpeg';
        const icon = L.icon({
            iconUrl: iconFileName,
            iconSize: [32, 32],
            iconAnchor: [16, 32]
        });

        const marker = L.marker([lat, lng], { icon });
        const id = generatePinId(lat, lng);

        // Store park data directly on the marker so it never goes stale
        marker._parkData = { id, name, state, cost, swagType, info, website, pics, video, lat, lng };

        marker.on('click', () => {
            if (activePinMarker && activePinMarker._icon) {
                activePinMarker._icon.classList.remove('active-pin');
            }
            if (marker._icon) {
                marker._icon.classList.add('active-pin');
            }
            activePinMarker = marker;

            // Read data from the marker itself, not from a closure
            const d = marker._parkData;
            titleEl.textContent = d.name || 'Unknown Park';
            locEl.textContent = d.state || '';
            typeEl.textContent = d.swagType;
            typeEl.className = `badge ${getBadgeClass(d.swagType)}`;

            const suggestEditBtn = document.getElementById('suggest-edit-btn');
            if (suggestEditBtn) {
                const subject = encodeURIComponent(`B.A.R.K. Map Edit: ${d.name}`);
                const body = encodeURIComponent(`Park Name: ${d.name}\nID: ${d.id}\n\n--- Please describe the update below ---\n`);
                suggestEditBtn.href = `mailto:junior.ranger.423@gmail.com?subject=${subject}&body=${body}`;
            }

            if (d.cost) {
                costContainer.style.display = 'block';
                costValEl.textContent = d.cost;
            } else {
                costContainer.style.display = 'none';
            }

            if (d.info) {
                infoSection.style.display = 'block';
                infoEl.innerHTML = d.info.replace(/\n/g, '<br>');
            } else {
                infoSection.style.display = 'none';
                infoEl.innerHTML = '';
            }

            if (d.pics && typeof d.pics === 'string') {
                const formattedPics = formatSwagLinks(d.pics);
                if (formattedPics.includes('<a ')) {
                    picsEl.style.display = 'flex';
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
                    websitesContainer.style.display = 'flex';
                    urls.forEach((url, index) => {
                        const link = document.createElement('a');
                        // Remove trailing quotes or commas that might be captured by the regex
                        link.href = url.replace(/['",]+$/, '');
                        link.target = '_blank';
                        link.className = 'website-btn';
                        link.style.cssText = 'flex: 1; min-width: 120px;';
                        link.textContent = urls.length > 1 ? `Website ${index + 1}` : 'Visit Official Website';
                        websitesContainer.appendChild(link);
                    });
                } else {
                    websitesContainer.style.display = 'none';
                }
            } else {
                websitesContainer.style.display = 'none';
            }

            let dirContainer = document.getElementById('panel-directions');
            if (!dirContainer) {
                dirContainer = document.createElement('div');
                dirContainer.id = 'panel-directions';
                dirContainer.className = 'directions-container';
                document.querySelector('.panel-content').appendChild(dirContainer);
            }
            dirContainer.innerHTML = `
                <a href="https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}" target="_blank" class="dir-btn">🗺️ Google Maps</a>
                <a href="http://maps.apple.com/?daddr=${d.lat},${d.lng}" target="_blank" class="dir-btn">🧭 Apple Maps</a>
                <button class="glass-btn btn-trip" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 8px; font-weight: 700; color: #1976D2; border: 2px solid #1976D2; background: white; padding: 10px; border-radius: 50px; margin-top: 10px; font-size: 14px; cursor: pointer;">📍 Add to Trip</button>
            `;

            const btnTrip = dirContainer.querySelector('.btn-trip');
            if (btnTrip) {
                btnTrip.onclick = (e) => {
                    e.preventDefault();
                    if (tripQueue.length >= 5) {
                        alert("Trip limit reached! Maximum 5 stops allowed.");
                        return;
                    }
                    if (tripQueue.find(stop => stop.lat === d.lat && stop.lng === d.lng)) {
                        alert("This location is already in your trip!");
                        return;
                    }
                    tripQueue.push({ id: d.id, name: d.name, lat: d.lat, lng: d.lng });
                    updateTripUI();
                };
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
                        markVisitedBtn.disabled = true;
                        markVisitedBtn.style.cursor = 'default';
                        markVisitedBtn.style.opacity = '0.7';
                        
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
                                const newObj = { id: d.id, name: d.name, lat: d.lat, lng: d.lng, verified: true };
                                
                                const docRef = firebase.firestore().collection('users').doc(firebase.auth().currentUser.uid);
                                if (userVisitedPlaces.has(d.id)) {
                                    const oldObj = userVisitedPlaces.get(d.id);
                                    docRef.set({ visitedPlaces: firebase.firestore.FieldValue.arrayRemove(oldObj) }, { merge: true });
                                }
                                
                                userVisitedPlaces.set(d.id, newObj);
                                docRef.set({ visitedPlaces: firebase.firestore.FieldValue.arrayUnion(newObj) }, { merge: true });
                                
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

                    markVisitedBtn.onclick = () => {
                        if (userVisitedPlaces.has(d.id)) return; // Prevent deletion
                        
                        const newObj = { id: d.id, name: d.name, lat: d.lat, lng: d.lng, verified: false };
                        const docRef = firebase.firestore().collection('users').doc(firebase.auth().currentUser.uid);
                        
                        userVisitedPlaces.set(d.id, newObj);
                        docRef.set({ visitedPlaces: firebase.firestore.FieldValue.arrayUnion(newObj) }, { merge: true });
                        
                        markVisitedBtn.classList.add('visited');
                        markVisitedText.textContent = '✓ Visited';
                        markVisitedBtn.disabled = true;
                        markVisitedBtn.style.cursor = 'default';
                        markVisitedBtn.style.opacity = '0.7';
                        
                        updateMarkers();
                        updateStatsUI();
                    };
                } else {
                    visitedSection.style.display = 'none';
                }
            }

            slidePanel.classList.add('open');
        });

        allPoints.push({
            id: id,
            name: name || '',
            state: state || '',
            swagType: swagType,
            category: parkCategory,
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
    if (!navigator.onLine || pollInFlight) return;
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
                    console.log('Ignored stale edge cache (flip-flop detected across reload)');
                    return;
                }

                console.log('Map data changed! Hash:', lastDataHash, '->', newHash);
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

// Poll every 3 seconds for fastest possible Google Sheets sync
setInterval(pollForUpdates, 3000);

function updateMarkers() {
    markerLayer.clearLayers();
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

        if (matchesSwag && matchesSearch && matchesType && matchesVisited) {
            markerLayer.addLayer(item.marker);

            if (item.marker._icon) {
                if (isVisited) {
                    item.marker._icon.classList.add('visited-pin');
                } else {
                    item.marker._icon.classList.remove('visited-pin');
                }
            }
        }
    });
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

        if (topMatches.length > 0 && searchSuggestions) {
            searchSuggestions.innerHTML = '';
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
                        map.setView([match.item.marker._parkData.lat, match.item.marker._parkData.lng], 12, { animate: true });
                        match.item.marker.fire('click');
                    }
                });
                searchSuggestions.appendChild(div);
            });
            searchSuggestions.style.display = 'block';
        } else if (searchSuggestions) {
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
        const profileName = document.getElementById('user-profile-name');

        if (user) {
            if (loginContainer) loginContainer.style.display = 'none';
            if (offlineStatusContainer) offlineStatusContainer.style.display = 'block';
            if (profileName) profileName.textContent = user.displayName || user.email || 'Bark Ranger';

            visitedSnapshotUnsubscribe = firebase.firestore().collection('users').doc(user.uid)
                .onSnapshot((doc) => {
                    if (doc.exists) {
                        const placeList = doc.data().visitedPlaces || [];
                        userVisitedPlaces = new Map();
                        placeList.forEach(obj => {
                            if (obj && obj.id) userVisitedPlaces.set(obj.id, obj);
                        });
                    } else {
                        userVisitedPlaces = new Map();
                    }
                    updateMarkers();
                    updateStatsUI();

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
        } else {
            if (loginContainer) loginContainer.style.display = 'block';
            if (offlineStatusContainer) offlineStatusContainer.style.display = 'none';
            userVisitedPlaces.clear();
            if (visitedSnapshotUnsubscribe) {
                visitedSnapshotUnsubscribe();
                visitedSnapshotUnsubscribe = null;
            }
            updateMarkers();
            updateStatsUI();
        }
    });

    const googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', () => {
            const provider = new firebase.auth.GoogleAuthProvider();
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
map.on('click', () => {
    slidePanel.classList.remove('open');
});
// (Removed outdated modal close handlers)

// Toggle filter panel
document.getElementById('toggle-filter-btn').addEventListener('click', () => {
    document.getElementById('filter-panel').classList.toggle('collapsed');
});

// Update Manager 
function checkForUpdates() {
    if (!navigator.onLine || window.location.protocol === 'file:') return;

    fetch('version.json?cache_bypass=' + Date.now(), { cache: 'no-store' })
        .then(res => {
            if (!res.ok) throw new Error('version.json not found');
            return res.json();
        })
        .then(data => {
            if (data.version && data.version > APP_VERSION) {
                const toast = document.getElementById('update-toast');
                if (toast) {
                    toast.classList.add('show');
                }
            }
        })
        .catch(err => console.log('Skipping version check: ', err.message));
}

setInterval(checkForUpdates, 30000);
setTimeout(checkForUpdates, 2000);

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

// Leaderboard Top 5 Listener
if (typeof firebase !== 'undefined') {
    firebase.firestore().collection('leaderboard')
        .orderBy('totalVisited', 'desc')
        .limit(50)
        .onSnapshot(snapshot => {
            const listEl = document.getElementById('leaderboard-list');
            const rankEl = document.getElementById('personal-rank-display');
            if (!listEl || !rankEl) return;
            
            listEl.innerHTML = '';
            let rank = 1;
            let personalRank = '--';
            const uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
            
            snapshot.forEach(doc => {
                const data = doc.data();
                if (doc.id === uid) personalRank = rank;
                
                if (rank <= 5) {
                    const li = document.createElement('li');
                    li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.05);';
                    
                    const nameSpan = document.createElement('span');
                    nameSpan.style.cssText = 'font-weight: ' + (doc.id === uid ? '800; color: #2196F3;' : '600; color: #444;');
                    nameSpan.textContent = `#${rank} ${data.displayName} ${data.hasVerified ? '🐾' : ''}`;
                    
                    const scoreSpan = document.createElement('span');
                    scoreSpan.style.cssText = 'background: rgba(76, 175, 80, 0.1); color: #2E7D32; padding: 4px 8px; border-radius: 12px; font-size: 11px; font-weight: 700;';
                    scoreSpan.textContent = data.totalVisited;
                    
                    li.appendChild(nameSpan);
                    li.appendChild(scoreSpan);
                    listEl.appendChild(li);
                }
                rank++;
            });
            
            if (snapshot.empty) {
                listEl.innerHTML = '<li style="color: #888; font-style: italic; text-align: center; padding: 10px 0;">No leaders yet. Be the first!</li>';
            }
            
            rankEl.textContent = 'Rank: ' + personalRank;
        }, err => console.log('Leaderboard err:', err));
}

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
        colorDark : "#1976D2",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
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

// ====== TRIP BUILDER LOGIC ======
const tripFab = document.getElementById('trip-fab');
const tripBadge = document.getElementById('trip-badge');
const tripModal = document.getElementById('trip-modal');
const tripQueueList = document.getElementById('trip-queue-list');
const closeTripModal = document.getElementById('close-trip-modal');
const clearTripBtn = document.getElementById('clear-trip-btn');
const startRouteBtn = document.getElementById('start-route-btn');

function updateTripUI() {
    if (!tripFab || !tripBadge || !tripQueueList) return;
    
    if (tripQueue.length > 0) {
        tripFab.style.display = 'flex';
        tripBadge.textContent = `${tripQueue.length}/5`;
    } else {
        tripFab.style.display = 'none';
        if (tripModal) tripModal.style.display = 'none';
    }
    
    tripQueueList.innerHTML = '';
    tripQueue.forEach((stop, index) => {
        const li = document.createElement('li');
        li.style.cssText = 'display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(0,0,0,0.05); padding: 10px 0;';
        li.innerHTML = `
            <div style="display: flex; align-items: center;">
                <span style="background: #1976D2; color: white; border-radius: 50%; width: 22px; height: 22px; display: inline-flex; justify-content: center; align-items: center; font-size: 11px; margin-right: 8px;">${index + 1}</span>
                <span style="font-weight: 600; color: #333; font-size: 13px;">${stop.name}</span>
            </div>
            <button class="remove-stop-btn" data-index="${index}" style="background: none; border: none; color: #d32f2f; font-weight: bold; font-size: 16px; cursor: pointer; padding: 5px;">&times;</button>
        `;
        tripQueueList.appendChild(li);
    });
    
    document.querySelectorAll('.remove-stop-btn').forEach(btn => {
        btn.onclick = (e) => {
            const idx = parseInt(e.target.getAttribute('data-index'));
            tripQueue.splice(idx, 1);
            updateTripUI();
        };
    });
}

if (tripFab) {
    tripFab.onclick = () => {
        tripModal.style.display = 'flex';
    };
}

if (closeTripModal) {
    closeTripModal.onclick = () => {
        tripModal.style.display = 'none';
    };
}

if (clearTripBtn) {
    clearTripBtn.onclick = () => {
        tripQueue = [];
        updateTripUI();
    };
}

if (startRouteBtn) {
    startRouteBtn.onclick = () => {
        if (tripQueue.length === 0) return;
        let routeUrl = "https://www.google.com/maps/dir/";
        tripQueue.forEach(stop => {
            routeUrl += `${stop.lat},${stop.lng}/`;
        });
        window.open(routeUrl, '_blank');
    };
}