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
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 18
}).addTo(map);

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
            ctx.clearRect(0,0,wmCanvas.width,wmCanvas.height);
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

        // Store park data directly on the marker so it never goes stale
        marker._parkData = { name, state, cost, swagType, info, website, pics, video, lat, lng };

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
            `;

            slidePanel.classList.add('open');
        });

        allPoints.push({
            name: name || '',
            state: state || '',
            swagType: swagType,
            category: parkCategory,
            marker: marker
        });
    });
    updateMarkers();

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
        complete: function(results) {
            processParsedResults(results);
            isRendering = false;
            // Process the most recent pending CSV, if any
            if (pendingCSV) {
                const next = pendingCSV;
                pendingCSV = null;
                parseCSVString(next);
            }
        },
        error: function(err) {
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

        if (matchesSwag && matchesSearch && matchesType) {
            markerLayer.addLayer(item.marker);
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
const loginForm = document.getElementById('login-form');
const loginContainer = document.getElementById('login-container');
const offlineStatusContainer = document.getElementById('offline-status-container');
const logoutBtn = document.getElementById('logout-btn');
const loginError = document.getElementById('login-error');

function updateAuthUI() {
    const isPremium = localStorage.getItem('premiumLoggedIn') === 'true';
    if (loginContainer && offlineStatusContainer) {
        if (isPremium) {
            loginContainer.style.display = 'none';
            offlineStatusContainer.style.display = 'block';
        } else {
            loginContainer.style.display = 'block';
            offlineStatusContainer.style.display = 'none';
        }
    }
}

if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const user = document.getElementById('username-input').value;
        const pass = document.getElementById('password-input').value;
        if (user === 'USBarkRangers' && pass === 'Password') {
            localStorage.setItem('premiumLoggedIn', 'true');
            if (loginError) loginError.style.display = 'none';
            updateAuthUI();
            
            if (localStorage.getItem('barkCSV')) {
                parseCSVString(localStorage.getItem('barkCSV'));
            }
        } else {
            if (loginError) loginError.style.display = 'block';
        }
    });
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('premiumLoggedIn');
        const userInput = document.getElementById('username-input');
        const passInput = document.getElementById('password-input');
        if (userInput) userInput.value = '';
        if (passInput) passInput.value = '';
        updateAuthUI();
        
        if (!navigator.onLine) {
             markerLayer.clearLayers();
             alert("Logged out. Network disconnected.");
        }
    });
}

updateAuthUI();

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