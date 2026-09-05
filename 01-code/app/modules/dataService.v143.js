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
let pendingCSVResolve = null;

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
const LAT_COLUMNS = ['lat', 'Lat', 'LAT', 'Latitude', 'latitude'];
const LNG_COLUMNS = ['lng', 'Lng', 'LNG', 'Long', 'long', 'Longitude', 'longitude'];
const STATIC_FALLBACK_CSV_URL = 'assets/data/bark-fallback-0.142.csv';
const REMOTE_CATALOG_SNAPSHOT_URL = 'https://us-central1-barkrangermap-auth.cloudfunctions.net/catalogSnapshot';
const CATALOG_FETCH_TIMEOUT_MS = 6000;
const MIN_CATALOG_PARK_COUNT = 300;
let staticFallbackLoadInFlight = null;
let remoteSnapshotLoadInFlight = null;

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
    const explicitLat = getFirstPresentCSVValue(row, LAT_COLUMNS);
    const explicitLng = getFirstPresentCSVValue(row, LNG_COLUMNS);

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
        lat: explicitLat.found ? explicitLat.value : getCSVValue(row, CSV_COLUMNS.LAT),
        lng: explicitLng.found ? explicitLng.value : getCSVValue(row, CSV_COLUMNS.LNG),
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

function processParsedResults(results, options = {}) {
    const newAllPoints = [];
    const seenParkIds = new Set();
    let missingParkIdCount = 0;
    let duplicateParkIdCount = 0;
    let missingCoordinateCount = 0;
    let invalidCoordinateCount = 0;
    let missingNameCount = 0;
    const missingCoordinateSamples = [];

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
            const id = getParkId(item);

            if (lat === '' || lng === '') {
                missingCoordinateCount++;
                if (missingCoordinateSamples.length < 5) {
                    missingCoordinateSamples.push({ rowNumber: rowIndex + 2, id, name });
                }
                return;
            }

            const numericLat = Number(lat);
            const numericLng = Number(lng);
            if (!Number.isFinite(numericLat)
                || !Number.isFinite(numericLng)
                || numericLat < -90
                || numericLat > 90
                || numericLng < -180
                || numericLng > 180) {
                invalidCoordinateCount++;
                return;
            }

            if (!name) {
                missingNameCount++;
                return;
            }

            const swagType = item.swagType;
            const parkCategory = window.BARK.getParkCategory(category);

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
    if (missingCoordinateCount > 0) {
        console.warn(`[dataService] Skipped ${missingCoordinateCount} row(s) without coordinates. Add lat/lng before publishing new parks.`, {
            sampleRows: missingCoordinateSamples
        });
    }

    const parseErrorCount = Array.isArray(results.errors) ? results.errors.length : 0;
    const integrityFailure = options.requireCatalogIntegrity === true && (
        parseErrorCount > 0
        || missingParkIdCount > 0
        || duplicateParkIdCount > 0
        || missingCoordinateCount > 0
        || invalidCoordinateCount > 0
        || missingNameCount > 0
        || newAllPoints.length < MIN_CATALOG_PARK_COUNT
    );

    if (newAllPoints.length === 0 || integrityFailure) {
        console.warn('[dataService] Rejected CSV refresh because it did not contain a complete, usable park catalog. Keeping existing data or falling back to the validated snapshot.', {
            parsedRows: results.data.length,
            usableRows: newAllPoints.length,
            parseErrorCount,
            missingCoordinateCount,
            invalidCoordinateCount,
            missingNameCount,
            missingParkIdCount
        });
        return false;
    }

    const parkRepo = window.BARK.repos && window.BARK.repos.ParkRepo;
    if (!parkRepo || typeof parkRepo.replaceAll !== 'function') {
        throw new Error('ParkRepo is required before dataService can publish park data.');
    }

    const replaceResult = parkRepo.replaceAll(newAllPoints, { debug: window.BARK.debugDataRefresh === true });
    if (!replaceResult.accepted) return false;

    const loadState = window.BARK.loadState;
    if (loadState && typeof loadState.markParkDataReady === 'function' && newAllPoints.length > 0) {
        loadState.markParkDataReady();
    }

    // Hydrate canonical counts for gamification
    if (window.gamificationEngine && newAllPoints.length > 0) {
        window.gamificationEngine.updateCanonicalCountsFromPoints(newAllPoints);
    }

    const firebaseService = window.BARK.services && window.BARK.services.firebase;
    if (firebaseService && typeof firebaseService.normalizeLocalVisitedPlacesToCanonical === 'function') {
        firebaseService.normalizeLocalVisitedPlacesToCanonical({ writeBack: false, source: 'park-data-load' })
            .catch(error => console.error('[dataService] visited-place canonicalization failed:', error));
    }

    window.syncState();
    return true;
}

function commitCSVCache(csvString, options = {}) {
    if (!options.cacheTime) return false;
    try {
        localStorage.setItem('barkCSV', csvString);
        localStorage.setItem('barkCSV_time', String(options.cacheTime));
        return true;
    } catch (error) {
        console.warn('[dataService] Catalog loaded, but its offline cache could not be updated:', error);
        return false;
    }
}

function hasAcceptedParkData() {
    const parkRepo = window.BARK && window.BARK.repos && window.BARK.repos.ParkRepo;
    return Boolean(
        parkRepo &&
        typeof parkRepo.getAll === 'function' &&
        parkRepo.getAll().length > 0
    );
}

function beginParkDataLoadStatus() {
    const loadState = window.BARK && window.BARK.loadState;
    if (loadState && typeof loadState.beginParkLoad === 'function') {
        loadState.beginParkLoad();
    }
}

function settleParkDataLoadStatus() {
    // Papa Parse completes synchronously for a CSV string today, but the short
    // defer keeps this correct if that implementation changes later.
    setTimeout(() => {
        const loadState = window.BARK && window.BARK.loadState;
        if (!loadState) return;
        if (hasAcceptedParkData() && typeof loadState.markParkDataReady === 'function') {
            loadState.markParkDataReady();
        } else if (typeof loadState.markParkDataUnavailable === 'function') {
            loadState.markParkDataUnavailable();
        }
    }, 250);
}

function parseCSVString(csvString, options = {}) {
    return new Promise(resolve => {
        if (options.skipIfDataLoaded && hasAcceptedParkData()) {
            resolve(false);
            return;
        }

        if (isRendering) {
            // Preserve the established last-candidate-wins behavior, but settle
            // the superseded caller so a rejected live parse cannot hang its
            // validated-snapshot fallback.
            if (typeof pendingCSVResolve === 'function') pendingCSVResolve(false);
            pendingCSV = csvString;
            pendingCSVOptions = options;
            pendingCSVResolve = resolve;
            return;
        }

        isRendering = true;
        const parseOperation = typeof window.BARK.perfOperationStart === 'function'
            ? window.BARK.perfOperationStart('spreadsheet-parse', `${Math.round(csvString.length / 1024)}kb`)
            : null;
        if (window.BARK && typeof window.BARK.perfBreadcrumb === 'function') {
            window.BARK.perfBreadcrumb('csv-parse:' + Math.round(csvString.length / 1024) + 'kb');
        }

        function finish(accepted) {
            if (typeof window.BARK.perfOperationEnd === 'function') {
                window.BARK.perfOperationEnd(parseOperation, accepted ? 'accepted' : 'rejected');
            }
            isRendering = false;
            resolve(Boolean(accepted));

            if (pendingCSV !== null) {
                const next = pendingCSV;
                const nextOptions = pendingCSVOptions || {};
                const nextResolve = pendingCSVResolve;
                pendingCSV = null;
                pendingCSVOptions = null;
                pendingCSVResolve = null;
                parseCSVString(next, nextOptions).then(nextResolve);
            }
        }

        Papa.parse(csvString, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: 'greedy',
            transformHeader: header => cleanCSVValue(header),
            transform: value => cleanCSVValue(value),
            complete: function (results) {
                if (results.errors && results.errors.length) {
                    console.warn('[dataService] CSV parse completed with row issues:', results.errors);
                }

                let accepted = false;
                try {
                    accepted = processParsedResults(results, options);
                    if (accepted) {
                        commitCSVCache(csvString, options);
                        if (typeof options.onAccepted === 'function') options.onAccepted();
                    } else if (typeof options.onRejected === 'function') {
                        options.onRejected();
                    }
                } catch (error) {
                    console.error('[dataService] CSV publication failed:', error);
                    if (typeof options.onRejected === 'function') options.onRejected();
                    accepted = false;
                }
                finish(accepted);
            },
            error: function (err) {
                console.error('Error parsing CSV data:', err);
                if (typeof options.onRejected === 'function') options.onRejected();
                finish(false);
            }
        });
    });
}

window.BARK.parseCSVString = parseCSVString;

async function fetchWithDeadline(url, options = {}, timeoutMs = CATALOG_FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    let timeoutId = null;
    const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
            const error = new Error(`Catalog request timed out after ${timeoutMs}ms.`);
            error.name = 'AbortError';
            reject(error);
        }, timeoutMs);
    });

    try {
        return await Promise.race([
            fetch(url, { ...options, signal: controller.signal }).then(async response => {
                // Headers alone do not mean a download succeeded. Keep the deadline
                // active through the body so a half-open connection cannot hold polling.
                const body = await response.text();
                return {
                    ok: response.ok, status: response.status, url: response.url,
                    headers: response.headers,
                    text: async () => body,
                    json: async () => JSON.parse(body)
                };
            }),
            timeout
        ]);
    } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
    }
}

function loadStaticFallbackData(reason = 'unknown') {
    if (hasAcceptedParkData()) return Promise.resolve(false);
    if (staticFallbackLoadInFlight) return staticFallbackLoadInFlight;

    staticFallbackLoadInFlight = fetchWithDeadline(STATIC_FALLBACK_CSV_URL, { cache: 'force-cache' })
        .then(res => {
            if (!res.ok) throw new Error(`Static fallback response was not ok: ${res.status}`);
            return res.text();
        })
        .then(async csvString => {
            if (!csvString || csvString.trim().length < 10 || hasAcceptedParkData()) return false;

            const fallbackHash = quickHash(csvString);
            return parseCSVString(csvString, {
                skipIfDataLoaded: true,
                requireCatalogIntegrity: true,
                onAccepted: () => {
                    rememberAcceptedCatalog(fallbackHash, 1, 'static-fallback');
                    if (window.BARK.debugDataRefresh === true) {
                        console.info(`[dataService] Loaded hosted static fallback data (${reason}).`);
                    }
                }
            });
        })
        .catch(error => {
            console.warn('[dataService] Hosted static fallback data unavailable:', error);
            return false;
        })
        .finally(() => {
            staticFallbackLoadInFlight = null;
        });

    return staticFallbackLoadInFlight;
}

window.BARK.loadStaticFallbackData = loadStaticFallbackData;

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
let lastAcceptedDataRevisionTime = 0;
let lastAcceptedDataSource = 'none';
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

function rememberAcceptedCatalog(hash, revisionTime, source) {
    const normalizedRevision = Number.isFinite(Number(revisionTime))
        ? Number(revisionTime)
        : 0;
    lastDataHash = hash;
    lastAcceptedDataRevisionTime = normalizedRevision;
    lastAcceptedDataSource = source || 'unknown';
    rememberDataHash(hash, normalizedRevision);
}

function parseSnapshotRevision(response) {
    if (!response || !response.headers || typeof response.headers.get !== 'function') return 0;
    const candidates = [
        response.headers.get('x-catalog-published-at'),
        response.headers.get('x-bark-catalog-published-at'),
        response.headers.get('last-modified')
    ];
    for (const value of candidates) {
        const parsed = Date.parse(value || '');
        if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 0;
}

function remoteSnapshotCanReplaceCurrent(remoteRevisionTime) {
    if (!hasAcceptedParkData()) return true;
    if (lastAcceptedDataSource === 'static-fallback') return true;
    return remoteRevisionTime > 0 && remoteRevisionTime > lastAcceptedDataRevisionTime;
}

function loadRemoteCatalogSnapshot(reason = 'live catalog unavailable') {
    if (remoteSnapshotLoadInFlight) return remoteSnapshotLoadInFlight;

    remoteSnapshotLoadInFlight = fetchWithDeadline(REMOTE_CATALOG_SNAPSHOT_URL, {
        cache: 'default',
        headers: { Accept: 'text/csv' }
    })
        .then(async response => {
            if (!response.ok) throw new Error(`Validated catalog response was not ok: ${response.status}`);
            const remoteRevisionTime = parseSnapshotRevision(response);
            const csvString = await response.text();
            if (!csvString || csvString.trim().length < 10) return false;

            const snapshotHash = quickHash(csvString);
            if (snapshotHash === lastDataHash && lastAcceptedDataSource !== 'static-fallback') return true;
            if (!remoteSnapshotCanReplaceCurrent(remoteRevisionTime)) {
                if (window.BARK.debugDataRefresh === true) {
                    console.info('[dataService] Ignored an older or undated validated catalog snapshot.', {
                        reason,
                        remoteRevisionTime,
                        currentRevisionTime: lastAcceptedDataRevisionTime,
                        currentSource: lastAcceptedDataSource
                    });
                }
                return false;
            }

            const cacheTime = remoteRevisionTime || Date.now();
            return parseCSVString(csvString, {
                cacheTime,
                requireCatalogIntegrity: true,
                onAccepted: () => {
                    rememberAcceptedCatalog(snapshotHash, cacheTime, 'remote-snapshot');
                    if (window.BARK.debugDataRefresh === true) {
                        console.info(`[dataService] Loaded validated remote catalog fallback (${reason}).`);
                    }
                }
            });
        })
        .catch(error => {
            console.warn('[dataService] Validated remote catalog fallback unavailable:', error);
            return false;
        })
        .finally(() => {
            remoteSnapshotLoadInFlight = null;
        });

    return remoteSnapshotLoadInFlight;
}

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
    if (!navigator.onLine || pollInFlight) return Promise.resolve(null);

    try { window.BARK.incrementRequestCount(); }
    catch (e) { return Promise.reject(e); }

    pollInFlight = true;
    lastDataPollStartedAt = Date.now();
    if (typeof window.BARK.perfBreadcrumb === 'function') {
        window.BARK.perfBreadcrumb('data-poll:start');
    }

    const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRMM2ZRU5lmT-ncrsil4W3qhrbo8NBxnQ-xC877TNkhLYOpTlnCocYA9gNg-dPRyaQr_8e0CWZ0WB2F/pub?output=csv';

    return fetchWithDeadline(csvUrl + '&t=' + Date.now() + '&r=' + Math.random(), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
    })
        .then(res => {
            if (!res.ok) throw new Error('Network response was not ok');
            return res.text().then(text => ({ newCsv: text, url: res.url }));
        })
        .then(async ({ newCsv, url }) => {
            if (!newCsv || newCsv.trim().length < 10) return false;
            const newHash = quickHash(newCsv);
            let revisionTime = seenHashes.get(newHash);

            if (!Number.isFinite(revisionTime)) {
                revisionTime = Date.now();
                const match = /\/([0-9]{13})\//.exec(url);
                if (match) revisionTime = parseInt(match[1], 10);
            }

            if (newHash !== lastDataHash) {
                if (lastDataHash !== null && revisionTime < lastAcceptedDataRevisionTime) return false;

                return parseCSVString(newCsv, {
                    cacheTime: revisionTime,
                    requireCatalogIntegrity: true,
                    onAccepted: () => rememberAcceptedCatalog(newHash, revisionTime, 'live-sheet')
                });
            }

            if (typeof window.BARK.perfBreadcrumb === 'function') {
                window.BARK.perfBreadcrumb('data-poll:unchanged');
            }
            return true;
        })
        .finally(() => {
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
        const liveAccepted = await pollForUpdates();
        if (liveAccepted === null) return false;
        if (liveAccepted === true) {
            dataPollErrorCount = 0;
            return true;
        }

        dataPollErrorCount++;
        console.warn('Live park catalog response was rejected; trying the validated fallback snapshot.');
        return loadRemoteCatalogSnapshot('live sheet response rejected');
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
        return loadRemoteCatalogSnapshot('live sheet request failed');
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

let parkReconnectHandlerBound = false;
let lastParkReconnectAttemptAt = 0;
const PARK_RECONNECT_MIN_INTERVAL_MS = 30000;

function bindParkDataReconnectRecovery() {
    if (parkReconnectHandlerBound) return;
    parkReconnectHandlerBound = true;

    window.addEventListener('online', () => {
        if (hasAcceptedParkData()) return;
        const now = Date.now();
        if (now - lastParkReconnectAttemptAt < PARK_RECONNECT_MIN_INTERVAL_MS) return;
        lastParkReconnectAttemptAt = now;

        beginParkDataLoadStatus();
        Promise.allSettled([
            loadStaticFallbackData('connection restored'),
            runDataPollCycle()
        ]).then(settleParkDataLoadStatus);
    });
}

function loadData() {
    const cachedCsv = localStorage.getItem('barkCSV');
    const cachedTime = localStorage.getItem('barkCSV_time');

    beginParkDataLoadStatus();
    bindParkDataReconnectRecovery();

    let initialFallbackAttempt = Promise.resolve(false);

    if (cachedCsv) {
        const cachedHash = quickHash(cachedCsv);
        const parsedCachedTime = parseInt(cachedTime, 10);
        const cachedRevisionTime = Number.isFinite(parsedCachedTime) ? parsedCachedTime : Date.now();
        initialFallbackAttempt = parseCSVString(cachedCsv, {
            requireCatalogIntegrity: true,
            onAccepted: () => rememberAcceptedCatalog(cachedHash, cachedRevisionTime, 'local-cache')
        }).then(accepted => accepted
            ? true
            : loadStaticFallbackData('cached catalog rejected'));
    } else {
        initialFallbackAttempt = loadStaticFallbackData('cold boot without local cache');
    }

    safeDataPoll();

    if (!navigator.onLine) {
        const premiumService = window.BARK && window.BARK.services && window.BARK.services.premium;
        const isPremium = Boolean(
            premiumService &&
            typeof premiumService.isPremium === 'function' &&
            premiumService.isPremium()
        );
        if (!isPremium && !cachedCsv) {
            alert('Network disconnected. Log in via the Profile tab to enable Premium Offline Mode.');
            clearMarkerLayersSafely();
        }
        initialFallbackAttempt.finally(settleParkDataLoadStatus);
        return;
    }

    const liveAttempt = runDataPollCycle()
        .then(() => hasAcceptedParkData()
            ? false
            : loadStaticFallbackData('live sheet poll returned no data'));

    Promise.allSettled([initialFallbackAttempt, liveAttempt])
        .then(settleParkDataLoadStatus);
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

    const res = await fetchWithDeadline('version.json?cache_bypass=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('version.json not found');

    const data = await res.json();
    const remoteVersion = String(data.version);
    const seenVersion = localStorage.getItem('bark_seen_version') || '';

    const versionLabel = document.getElementById('settings-app-version');
    const displayVersion = window.BARK.getDisplayVersion
        ? window.BARK.getDisplayVersion(remoteVersion)
        : remoteVersion;
    if (versionLabel) versionLabel.textContent = displayVersion;

    if (data.version && remoteVersion !== seenVersion) {
        const toast = document.getElementById('update-toast');
        if (toast) toast.classList.add('show');

        localStorage.setItem('bark_seen_version', remoteVersion);
        window.BARK.setAppVersion(remoteVersion);
    }
}

window.BARK.safePoll = safePoll;
