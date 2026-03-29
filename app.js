// Initialize map centered on the US
const map = L.map('map', {
    zoomControl: false
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

// Data structure
let allPoints = [];
let activePinMarker = null;
let activeSwagFilters = new Set(['Tag', 'Bandana', 'Certificate']);
let activeSearchQuery = '';
let activeTypeFilter = 'all';

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
const websiteEl = document.getElementById('panel-website');
const costContainer = document.getElementById('panel-swag-cost');
const costValEl = document.getElementById('swag-cost-val');
const picsEl = document.getElementById('panel-pics');
const videoEl = document.getElementById('panel-video');
const filterBtns = document.querySelectorAll('.filter-btn');
const searchInput = document.getElementById('park-search');
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

function loadData() {
    const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRMM2ZRU5lmT-ncrsil4W3qhrbo8NBxnQ-xC877TNkhLYOpTlnCocYA9gNg-dPRyaQr_8e0CWZ0WB2F/pub?output=csv' + '&t=' + Date.now();

    Papa.parse(csvUrl, {
        download: true,
        header: true,
        dynamicTyping: true,
        complete: function(results) {
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
                        item[key] = val; // Do not trim keys so ' Useful...' matches
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
                const lat = item['lat'];
                const lng = item['lng'];

                // Safeguard: Skip blank rows or missing coordinates
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

                marker.on('click', () => {
                    if (activePinMarker && activePinMarker._icon) {
                        activePinMarker._icon.classList.remove('active-pin');
                    }
                    if (marker._icon) {
                        marker._icon.classList.add('active-pin');
                    }
                    activePinMarker = marker;

                    titleEl.textContent = name || 'Unknown Park';
                    locEl.textContent = state || '';
                    typeEl.textContent = swagType;
                    typeEl.className = `badge ${getBadgeClass(swagType)}`;
                    
                    if (cost) {
                        costContainer.style.display = 'block';
                        costValEl.textContent = cost;
                    } else {
                        costContainer.style.display = 'none';
                    }

                    if (info) {
                        infoSection.style.display = 'block';
                        infoEl.innerHTML = info.replace(/\n/g, '<br>');
                    } else {
                        infoSection.style.display = 'none';
                        infoEl.innerHTML = '';
                    }

                    if (pics && typeof pics === 'string') {
                        const formattedPics = formatSwagLinks(pics);
                        if (formattedPics.includes('<a ')) {
                            picsEl.style.display = 'flex';
                            picsEl.innerHTML = formattedPics;
                        } else {
                            picsEl.style.display = 'none';
                        }
                    } else {
                        picsEl.style.display = 'none';
                    }

                    if (video && typeof video === 'string' && video.startsWith('http')) {
                        videoEl.style.display = 'block';
                        videoEl.href = video;
                    } else {
                        videoEl.style.display = 'none';
                    }

                    if (website && typeof website === 'string' && website.startsWith('http')) {
                        websiteEl.style.display = 'block';
                        websiteEl.href = website;
                    } else {
                        websiteEl.style.display = 'none';
                    }

                    // Dynamically inject directions buttons at the bottom of the panel
                    let dirContainer = document.getElementById('panel-directions');
                    if (!dirContainer) {
                        dirContainer = document.createElement('div');
                        dirContainer.id = 'panel-directions';
                        dirContainer.className = 'directions-container';
                        document.querySelector('.panel-content').appendChild(dirContainer);
                    }
                    dirContainer.innerHTML = `
                        <a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" class="dir-btn">🗺️ Google Maps</a>
                        <a href="http://maps.apple.com/?daddr=${lat},${lng}" target="_blank" class="dir-btn">🧭 Apple Maps</a>
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
        },
        error: function(err) {
            console.error("Error loading CSV data:", err);
        }
    });
}

function updateMarkers() {
    markerLayer.clearLayers();
    allPoints.forEach(item => {
        const matchesSwag = activeSwagFilters.has(item.swagType);
        const matchesSearch = String(item.name).toLowerCase().includes(activeSearchQuery.toLowerCase());
        const matchesType = activeTypeFilter === 'all' || item.category === activeTypeFilter;

        if (matchesSwag && matchesSearch && matchesType) {
            markerLayer.addLayer(item.marker);
        }
    });
}

// Event Listeners
searchInput.addEventListener('input', (e) => {
    activeSearchQuery = e.target.value;
    updateMarkers();
});

typeSelect.addEventListener('change', (e) => {
    activeTypeFilter = e.target.value;
    updateMarkers();
});

filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-filter');
        if (activeSwagFilters.has(type)) {
            activeSwagFilters.delete(type);
            btn.classList.remove('active');
        } else {
            activeSwagFilters.add(type);
            btn.classList.add('active');
        }
        updateMarkers();
    });
});

// Initial load
loadData();

// Close panel when clicking on map
map.on('click', () => {
    slidePanel.classList.remove('open');
});
// (Removed outdated modal close handlers)

// Toggle filter panel
document.getElementById('panel-header').addEventListener('click', () => {
    document.getElementById('filter-panel').classList.toggle('collapsed');
});