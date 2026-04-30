/**
 * dataService.js — CSV Fetching, Parsing, Data Polling
 * Firebase/Auth responsibilities live in /services as of Phase 3.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

// ====== CSV PARSING ENGINE ======
let isRendering = false;
let pendingCSV = null;
let pendingCSVOptions = null;

const CSV_COLUMNS = {
    PARK_ID: 'Park ID',
    LOCATION: 'Location',
    STATE: 'State',
    SWAG_COST: 'Swag Cost',
    TYPE: 'Type',
    INFO: 'Useful/Important/Other Info',
    WEBSITE: 'Website',
    PICS: 'Swag Pics - If available, and may not be current.',
    VIDEO: 'Swearing-In Video. Not all sites do this, and ones that do only do it as time permits.',
    LAT: 'lat',
    LNG: 'lng'
};

const SWAG_TYPE_COLUMNS = ['Swag Type', 'Swag', 'Swag Available'];
const DATA_REFRESH_SAFETY_MIN_PREVIOUS_COUNT = 50;
const DATA_REFRESH_SAFETY_MAX_COUNT_DROP_RATIO = 0.10;
const DATA_REFRESH_SAFETY_MAX_ID_DROP_RATIO = 0.10;
const DATA_REFRESH_SAFETY_MIN_ID_DROP_COUNT = 25;

function cleanCSVValue(value) {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    return value;
}

function getCSVValue(row, columnName) {
    if (!row) return '';
    if (Object.prototype.hasOwnProperty.call(row, columnName)) return cleanCSVValue(row[columnName]);

    const normalizedColumnName = cleanCSVValue(columnName).toLowerCase();
    const matchingKey = Object.keys(row).find(key => cleanCSVValue(key).toLowerCase() === normalizedColumnName);
    return matchingKey ? cleanCSVValue(row[matchingKey]) : '';
}

function getFirstPresentCSVValue(row, columnNames) {
    for (const columnName of columnNames) {
        if (row && Object.prototype.hasOwnProperty.call(row, columnName)) {
            return { found: true, value: cleanCSVValue(row[columnName]) };
        }
        const matchingKey = row && Object.keys(row).find(key => cleanCSVValue(key) === columnName);
        if (matchingKey) return { found: true, value: cleanCSVValue(row[matchingKey]) };
    }
    return { found: false, value: '' };
}

function normalizeSwagType(value) {
    if (!value) return 'Other';
    if (['Tag', 'Bandana', 'Certificate', 'Other'].includes(value)) return value;
    return window.BARK.getSwagType(value);
}

function normalizeCSVRow(rawItem) {
    const row = rawItem && typeof rawItem === 'object' ? rawItem : {};
    const info = getCSVValue(row, CSV_COLUMNS.INFO);
    const explicitSwag = getFirstPresentCSVValue(row, SWAG_TYPE_COLUMNS);

    return {
        parkId: getCSVValue(row, CSV_COLUMNS.PARK_ID),
        name: getCSVValue(row, CSV_COLUMNS.LOCATION),
        state: getCSVValue(row, CSV_COLUMNS.STATE),
        cost: getCSVValue(row, CSV_COLUMNS.SWAG_COST),
        category: getCSVValue(row, CSV_COLUMNS.TYPE),
        info,
        website: getCSVValue(row, CSV_COLUMNS.WEBSITE),
        pics: getCSVValue(row, CSV_COLUMNS.PICS),
        video: getCSVValue(row, CSV_COLUMNS.VIDEO),
        lat: getCSVValue(row, CSV_COLUMNS.LAT),
        lng: getCSVValue(row, CSV_COLUMNS.LNG),
        swagType: explicitSwag.found ? normalizeSwagType(explicitSwag.value) : window.BARK.getSwagType(info)
    };
}

function getParkId(item) {
    const parkId = cleanCSVValue(item && item.parkId);
    return parkId ? String(parkId) : '';
}

function isLegacyParkId(id) {
    return /^-?\d+\.\d{2}_-?\d+\.\d{2}$/.test(cleanCSVValue(id));
}

function isCanonicalParkId(id) {
    const value = cleanCSVValue(id);
    return Boolean(value && value.toLowerCase() !== 'unknown' && !isLegacyParkId(value));
}

function shouldRejectDataRefresh(previousCount, nextCount, droppedIdCount) {
    if (previousCount < DATA_REFRESH_SAFETY_MIN_PREVIOUS_COUNT || droppedIdCount === 0) return false;

    const countDrop = Math.max(0, previousCount - nextCount);
    const rejectedByCountCollapse = (countDrop / previousCount) >= DATA_REFRESH_SAFETY_MAX_COUNT_DROP_RATIO;
    const rejectedByIdCollapse = droppedIdCount >= Math.max(
        DATA_REFRESH_SAFETY_MIN_ID_DROP_COUNT,
        Math.ceil(previousCount * DATA_REFRESH_SAFETY_MAX_ID_DROP_RATIO)
    );

    return rejectedByCountCollapse || rejectedByIdCollapse;
}

function processParsedResults(results) {
    const previousPoints = Array.isArray(window.BARK.allPoints) ? window.BARK.allPoints : [];
    const newAllPoints = [];
    const seenParkIds = new Set();
    let missingParkIdCount = 0;
    let duplicateParkIdCount = 0;

    results.data.forEach((rawItem, rowIndex) => {
        try {
            const item = normalizeCSVRow(rawItem);
            const name = item.name;
            const state = item.state;
            const cost = item.cost;
            const category = item.category;
            const info = item.info;
            const website = item.website;
            const pics = item.pics;
            const video = item.video;
            let lat = item.lat;
            let lng = item.lng;

            if (name && name.includes('War in the Pacific')) {
                lat = 13.402746;
                lng = 144.6632005;
            }

            if (!lat || !lng) return;

            const swagType = item.swagType;
            const parkCategory = window.BARK.getParkCategory(category);

            const id = getParkId(item);
            if (!id) {
                missingParkIdCount++;
                return;
            }
            if (!isCanonicalParkId(id)) {
                missingParkIdCount++;
                return;
            }
            if (seenParkIds.has(id)) {
                duplicateParkIdCount++;
                console.warn('[dataService] Skipped duplicate Park ID row. Production data must have one row per UUID.', {
                    rowNumber: rowIndex + 2,
                    id,
                    name
                });
                return;
            }
            seenParkIds.add(id);

            const parkData = { id, name, state, cost, swagType, info, website, pics, video, lat, lng, parkCategory };

            // v25: Pre-Normalized Name
            parkData._cachedNormalizedName = window.BARK.normalizeText(name);

            parkData.category = parkCategory;
            newAllPoints.push(parkData);
        } catch (error) {
            console.error('[dataService] Failed to process CSV row; skipping row.', {
                rowNumber: rowIndex + 2,
                rawItem,
                error
            });
        }
    });

    if (missingParkIdCount > 0) {
        console.warn(`[dataService] Skipped ${missingParkIdCount} row(s) without Park ID. Production data must be UUID-only.`);
    }
    if (duplicateParkIdCount > 0) {
        console.warn(`[dataService] Skipped ${duplicateParkIdCount} duplicate Park ID row(s). Check the sheet before publishing.`);
    }

    const nextIds = new Set(newAllPoints.map(point => point.id));
    const droppedCanonicalIds = previousPoints
        .map(point => point && point.id)
        .filter(isCanonicalParkId)
        .filter(id => !nextIds.has(id));

    if (shouldRejectDataRefresh(previousPoints.length, newAllPoints.length, droppedCanonicalIds.length)) {
        console.warn('[dataService] Rejected destructive data refresh. A background CSV poll attempted to drop existing Park IDs.', {
            previousCount: previousPoints.length,
            nextCount: newAllPoints.length,
            droppedCount: droppedCanonicalIds.length,
            sampleDroppedIds: droppedCanonicalIds.slice(0, 10)
        });
        return false;
    }

    if (droppedCanonicalIds.length > 0 && window.BARK.debugDataRefresh === true) {
        console.info('[dataService] Accepted data refresh with minor Park ID changes.', {
            previousCount: previousPoints.length,
            nextCount: newAllPoints.length,
            changedCount: droppedCanonicalIds.length,
            sampleChangedIds: droppedCanonicalIds.slice(0, 10)
        });
    }

    window.BARK.allPoints = newAllPoints;

    // Hydrate canonical counts for gamification
    if (window.gamificationEngine && newAllPoints.length > 0) {
        window.gamificationEngine.updateCanonicalCountsFromPoints(newAllPoints);
    }

    window.BARK._markerDataRevision = (window.BARK._markerDataRevision || 0) + 1;

    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    if (firebaseService && typeof firebaseService.normalizeLocalVisitedPlacesToCanonical === 'function') {
        firebaseService.normalizeLocalVisitedPlacesToCanonical({ writeBack: true })
            .catch(error => console.error('[dataService] visited-place canonicalization failed:', error));
    }

    window.syncState();
    return true;
}

function commitCSVCache(csvString, options = {}) {
    if (!options.cacheTime) return;
    localStorage.setItem('barkCSV', csvString);
    localStorage.setItem('barkCSV_time', String(options.cacheTime));
}

function parseCSVString(csvString, options = {}) {
    if (isRendering) {
        pendingCSV = csvString;
        pendingCSVOptions = options;
        return;
    }
    isRendering = true;
    Papa.parse(csvString, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: 'greedy',
        transformHeader: header => cleanCSVValue(header),
        transform: value => cleanCSVValue(value),
        complete: function (results) {
            if (results.errors && results.errors.length) {
                console.warn('[dataService] CSV parse completed with recoverable row issues:', results.errors);
            }
            const accepted = processParsedResults(results);
            if (accepted) {
                commitCSVCache(csvString, options);
                if (typeof options.onAccepted === 'function') options.onAccepted();
            } else if (typeof options.onRejected === 'function') {
                options.onRejected();
            }
            isRendering = false;
            if (pendingCSV) {
                const next = pendingCSV;
                const nextOptions = pendingCSVOptions || {};
                pendingCSV = null;
                pendingCSVOptions = null;
                parseCSVString(next, nextOptions);
            }
        },
        error: function (err) {
            console.error('Error parsing CSV data:', err);
            isRendering = false;
        }
    });
}

window.BARK.parseCSVString = parseCSVString;

// ====== DATA POLLING ======
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
let pollInFlight = false;
let seenHashes = new Map();
const MAX_SEEN_DATA_HASHES = 64;
const DATA_POLL_INTERVAL_MS = 5 * 60 * 1000;
const DATA_POLL_RETRY_INTERVAL_MS = 10 * 60 * 1000;
const DATA_REFOCUS_MIN_INTERVAL_MS = 60 * 1000;
let dataPollTimer = null;
let dataPollLoopStarted = false;
let dataPollStopped = false;
let lastDataPollStartedAt = 0;

function pruneSeenHashes() {
    while (seenHashes.size > MAX_SEEN_DATA_HASHES) {
        const oldestHash = seenHashes.keys().next().value;
        if (oldestHash === lastDataHash && seenHashes.size > 1) {
            const currentHashTime = seenHashes.get(oldestHash);
            seenHashes.delete(oldestHash);
            seenHashes.set(oldestHash, currentHashTime);
            continue;
        }

        seenHashes.delete(oldestHash);
    }
}

function rememberDataHash(hash, revisionTime) {
    if (hash === null || hash === undefined) return;
    if (seenHashes.has(hash)) seenHashes.delete(hash);
    seenHashes.set(hash, revisionTime);
    pruneSeenHashes();
}

function pollForUpdates() {
    if (!navigator.onLine || pollInFlight) return Promise.resolve(false);

    try { window.BARK.incrementRequestCount(); }
    catch (e) { return Promise.reject(e); }

    pollInFlight = true;
    lastDataPollStartedAt = Date.now();

    const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRMM2ZRU5lmT-ncrsil4W3qhrbo8NBxnQ-xC877TNkhLYOpTlnCocYA9gNg-dPRyaQr_8e0CWZ0WB2F/pub?output=csv';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    return fetch(csvUrl + '&t=' + Date.now() + '&r=' + Math.random(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
        signal: controller.signal
    })
        .then(res => {
            if (!res.ok) throw new Error('Network response was not ok');
            return res.text().then(text => ({ newCsv: text, url: res.url }));
        })
        .then(({ newCsv, url }) => {
            if (!newCsv || newCsv.trim().length < 10) return false;
            const newHash = quickHash(newCsv);

            if (!seenHashes.has(newHash)) {
                let revisionTime = Date.now();
                const match = /\/([0-9]{13})\//.exec(url);
                if (match) revisionTime = parseInt(match[1], 10);
                rememberDataHash(newHash, revisionTime);
            }

            if (newHash !== lastDataHash) {
                const newHashTime = seenHashes.get(newHash);
                const currentHashTime = lastDataHash && seenHashes.has(lastDataHash) ? seenHashes.get(lastDataHash) : 0;

                if (lastDataHash !== null && newHashTime < currentHashTime) return false;

                parseCSVString(newCsv, {
                    cacheTime: newHashTime,
                    onAccepted: () => { lastDataHash = newHash; }
                });
            }
            return true;
        })
        .finally(() => {
            clearTimeout(timeoutId);
            pollInFlight = false;
        });
}

let dataPollErrorCount = 0;

function getPollInterval() {
    return dataPollErrorCount > 5 ? DATA_POLL_RETRY_INTERVAL_MS : DATA_POLL_INTERVAL_MS;
}

async function runDataPollCycle() {
    if (window.ultraLowEnabled) {
        console.log("Ultra Low Mode: Background polling disabled.");
        return false;
    }

    try {
        await pollForUpdates();
        dataPollErrorCount = 0;
        return true;
    } catch (err) {
        if (err.message && err.message.includes("Safety Shutdown")) {
            console.error("KILL SWITCH: Terminating Data Poll.");
            dataPollStopped = true;
            clearTimeout(dataPollTimer);
            dataPollTimer = null;
            return false;
        }
        dataPollErrorCount++;
        if (err.name === 'AbortError') {
            console.warn('Data poll timed out after 6s; backing off...');
        } else {
            console.error("Data poll failed, backing off...", err);
        }
        return false;
    }
}

function scheduleNextDataPoll(delay = getPollInterval()) {
    if (window.ultraLowEnabled || dataPollStopped) return;
    clearTimeout(dataPollTimer);
    dataPollTimer = setTimeout(runScheduledDataPoll, delay);
}

async function runScheduledDataPoll() {
    if (dataPollTimer) clearTimeout(dataPollTimer);
    dataPollTimer = null;
    await runDataPollCycle();
    scheduleNextDataPoll();
}

function bindDataPollVisibilityRefresh() {
    if (bindDataPollVisibilityRefresh.bound) return;
    bindDataPollVisibilityRefresh.bound = true;

    document.addEventListener('visibilitychange', () => {
        if (document.hidden || dataPollStopped || window.ultraLowEnabled) return;
        if (Date.now() - lastDataPollStartedAt < DATA_REFOCUS_MIN_INTERVAL_MS) return;
        runScheduledDataPoll();
    });
}

function safeDataPoll() {
    if (dataPollLoopStarted) return;
    dataPollLoopStarted = true;
    bindDataPollVisibilityRefresh();
    scheduleNextDataPoll();
}

function clearLayerSafely(layer, label) {
    if (!layer || typeof layer.clearLayers !== 'function') return false;

    try {
        layer.clearLayers();
        return true;
    } catch (error) {
        console.warn(`[dataService] failed to clear ${label}:`, error);
        return false;
    }
}

function clearMarkerLayersSafely() {
    const markerLayerCleared = clearLayerSafely(window.BARK.markerLayer, 'markerLayer');
    const clusterLayerCleared = clearLayerSafely(window.BARK.markerClusterGroup, 'markerClusterGroup');

    if ((markerLayerCleared || clusterLayerCleared) && window.BARK.markerManager && window.BARK.markerManager.markers instanceof Map) {
        window.BARK.markerManager.markers.clear();
    }

    if (markerLayerCleared || clusterLayerCleared) {
        window.BARK.activePinMarker = null;
    }
}

function loadData() {
    const cachedCsv = localStorage.getItem('barkCSV');
    const cachedTime = localStorage.getItem('barkCSV_time');

    if (cachedCsv) {
        lastDataHash = quickHash(cachedCsv);
        if (cachedTime) {
            rememberDataHash(lastDataHash, parseInt(cachedTime, 10));
        } else {
            rememberDataHash(lastDataHash, Date.now());
        }
        parseCSVString(cachedCsv);
    }

    safeDataPoll();

    if (!navigator.onLine) {
        const isPremium = localStorage.getItem('premiumLoggedIn') === 'true';
        if (!isPremium && !cachedCsv) {
            alert('Network disconnected. Log in via the Profile tab to enable Premium Offline Mode.');
            clearMarkerLayersSafely();
        }
        return;
    }

    runDataPollCycle();
}

window.BARK.loadData = loadData;
window.BARK.safeDataPoll = safeDataPoll;
window.BARK.clearMarkerLayersSafely = clearMarkerLayersSafely;

// ====== VERSION CHECK ======
let pollErrorCount = 0;

async function safePoll() {
    if (document.hidden) {
        setTimeout(safePoll, 10000);
        return;
    }

    try {
        await checkForUpdates();
        pollErrorCount = 0;
    } catch (err) {
        if (err.message && err.message.includes("Safety Shutdown")) {
            console.error("KILL SWITCH: Terminating Version Poll.");
            return;
        }
        pollErrorCount++;
        console.error("Update check failed, backing off...", err);
    }

    const nextInterval = pollErrorCount > 5 ? 60000 : 30000;
    setTimeout(safePoll, nextInterval);
}

async function checkForUpdates() {
    if (!navigator.onLine || window.location.protocol === 'file:') return;

    window.BARK.incrementRequestCount();

    const res = await fetch('version.json?cache_bypass=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('version.json not found');

    const data = await res.json();
    const remoteVersion = parseInt(data.version);
    const seenVersion = parseInt(localStorage.getItem('bark_seen_version') || '0');

    const versionLabel = document.getElementById('settings-app-version');
    if (versionLabel) versionLabel.textContent = remoteVersion;

    if (data.version && remoteVersion !== seenVersion) {
        const toast = document.getElementById('update-toast');
        if (toast) toast.classList.add('show');

        localStorage.setItem('bark_seen_version', remoteVersion);
        window.BARK.setAppVersion(remoteVersion);
    }
}

window.BARK.safePoll = safePoll;
