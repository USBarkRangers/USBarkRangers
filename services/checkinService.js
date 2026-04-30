/**
 * checkinService.js - GPS check-in validation and visit record construction.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

function getLocationCoords(userLocation) {
    const source = userLocation && userLocation.coords ? userLocation.coords : userLocation;
    if (!source) return null;

    const latitude = Number(source.latitude);
    const longitude = Number(source.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return { latitude, longitude };
}

function getFirebaseService() {
    return window.BARK.services && window.BARK.services.firebase;
}

function getCurrentVisitedPlaces(userVisitedPlaces) {
    const liveVisitedPlaces = window.BARK && window.BARK.userVisitedPlaces;
    if (liveVisitedPlaces && typeof liveVisitedPlaces.has === 'function') {
        return liveVisitedPlaces;
    }
    return userVisitedPlaces;
}

function refreshVisitedVisualState(firebaseService) {
    if (firebaseService && typeof firebaseService.refreshVisitedVisualState === 'function') {
        firebaseService.refreshVisitedVisualState();
    }
}

function createVisitRecord(parkData, verified) {
    return {
        id: parkData.id,
        name: parkData.name,
        lat: parkData.lat,
        lng: parkData.lng,
        verified,
        ts: Date.now()
    };
}

function getCurrentPosition(options) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            resolve({ error: 'GEOLOCATION_UNSUPPORTED' });
            return;
        }

        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
}

function queueDailyStreakIncrement(firebaseService) {
    if (firebaseService && typeof firebaseService.attemptDailyStreakIncrement === 'function') {
        firebaseService.attemptDailyStreakIncrement()
            .catch(error => console.error('[checkinService] daily streak increment failed:', error));
    }
}

function verifyAndProcessCheckin(parkData, userLocation, userVisitedPlaces) {
    const result = {
        success: false,
        distance: 0,
        visitRecord: null,
        error: null
    };

    try {
        const coords = getLocationCoords(userLocation);
        if (!coords) {
            result.error = 'INVALID_USER_LOCATION';
            return result;
        }

        if (!parkData) {
            result.error = 'MISSING_PARK_DATA';
            return result;
        }

        const parkLat = Number(parkData.lat);
        const parkLng = Number(parkData.lng);
        if (!Number.isFinite(parkLat) || !Number.isFinite(parkLng)) {
            result.error = 'INVALID_PARK_LOCATION';
            return result;
        }

        const haversine = window.BARK.utils && window.BARK.utils.geo && window.BARK.utils.geo.haversine;
        if (typeof haversine !== 'function') {
            result.error = 'GEO_UTIL_UNAVAILABLE';
            return result;
        }

        const radiusKm = window.BARK.config ? Number(window.BARK.config.CHECKIN_RADIUS_KM) : NaN;
        if (!Number.isFinite(radiusKm)) {
            result.error = 'CHECKIN_RADIUS_UNAVAILABLE';
            return result;
        }

        const distance = haversine(coords.latitude, coords.longitude, parkLat, parkLng);
        result.distance = distance;

        if (distance > radiusKm) {
            result.error = 'OUT_OF_RANGE';
            return result;
        }

        result.success = true;
        result.visitRecord = createVisitRecord(parkData, true);
        return result;
    } catch (error) {
        console.error('[checkinService] verifyAndProcessCheckin failed:', error);
        result.error = 'CHECKIN_FAILED';
        return result;
    }
}

async function verifyGpsCheckin(parkData, userVisitedPlaces) {
    const firebaseService = getFirebaseService();

    if (!firebaseService || typeof firebaseService.updateCurrentUserVisitedPlaces !== 'function') {
        return { success: false, error: 'SERVICE_UNAVAILABLE' };
    }

    let position;
    try {
        position = await getCurrentPosition({ enableHighAccuracy: true });
    } catch (error) {
        if (error && error.code === error.PERMISSION_DENIED) {
            return { success: false, error: 'PERMISSION_DENIED' };
        }

        return { success: false, error: 'LOCATION_FAILED' };
    }

    if (position && position.error) return { success: false, error: position.error };

    let previousVisitedPlaces = null;
    try {
        const visitedPlaces = getCurrentVisitedPlaces(userVisitedPlaces);
        if (!visitedPlaces) return { success: false, error: 'VISITED_PLACES_UNAVAILABLE' };

        previousVisitedPlaces = new Map(visitedPlaces);
        const checkinResult = verifyAndProcessCheckin(parkData, position.coords, visitedPlaces);
        if (!checkinResult.success) return checkinResult;

        const existingEntry = typeof window.BARK.getVisitedPlaceEntry === 'function'
            ? window.BARK.getVisitedPlaceEntry(parkData)
            : null;
        if (existingEntry && existingEntry.id !== parkData.id) {
            visitedPlaces.delete(existingEntry.id);
            if (typeof firebaseService.stageVisitedPlaceDelete === 'function') {
                firebaseService.stageVisitedPlaceDelete(existingEntry.id);
            }
        }

        visitedPlaces.set(parkData.id, checkinResult.visitRecord);
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(checkinResult.visitRecord);
        }
        if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
            window.BARK.invalidateVisitedIdsCache();
        }
        refreshVisitedVisualState(firebaseService);
        if (typeof window.syncState === 'function') {
            window.syncState();
        }
        await firebaseService.updateCurrentUserVisitedPlaces(Array.from(visitedPlaces.values()));
        queueDailyStreakIncrement(firebaseService);

        return {
            ...checkinResult,
            action: 'verified'
        };
    } catch (error) {
        if (parkData && typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
            firebaseService.clearVisitedPlacePendingMutation(parkData.id);
        }
        if (typeof firebaseService.replaceLocalVisitedPlaces === 'function' && previousVisitedPlaces) {
            firebaseService.replaceLocalVisitedPlaces(previousVisitedPlaces);
        }
        console.error('[checkinService] verifyGpsCheckin failed:', error);
        return { success: false, error: 'CHECKIN_FAILED' };
    }
}

async function markAsVisited(parkData, userVisitedPlaces) {
    const firebaseService = getFirebaseService();

    if (!firebaseService) return { success: false, error: 'SERVICE_UNAVAILABLE' };

    let previousVisitedPlaces = null;
    try {
        const visitedPlaces = getCurrentVisitedPlaces(userVisitedPlaces);
        if (!visitedPlaces) return { success: false, error: 'VISITED_PLACES_UNAVAILABLE' };

        previousVisitedPlaces = new Map(visitedPlaces);
        const visitedEntries = typeof window.BARK.getVisitedPlaceEntries === 'function'
            ? window.BARK.getVisitedPlaceEntries(parkData)
            : (visitedPlaces.has(parkData.id) ? [{ id: parkData.id, record: visitedPlaces.get(parkData.id) }] : []);

        if (visitedEntries.length > 0) {
            if (visitedEntries.some(entry => entry.record && entry.record.verified)) {
                return { success: false, error: 'ALREADY_VERIFIED' };
            }
            if (!window.allowUncheck) return { success: false, error: 'UNCHECK_LOCKED' };
            if (typeof firebaseService.updateCurrentUserVisitedPlaces !== 'function') {
                return { success: false, error: 'SERVICE_UNAVAILABLE' };
            }

            visitedEntries.forEach(entry => {
                visitedPlaces.delete(entry.id);
                if (typeof firebaseService.stageVisitedPlaceDelete === 'function') {
                    firebaseService.stageVisitedPlaceDelete(entry.id);
                }
            });
            if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
                window.BARK.invalidateVisitedIdsCache();
            }
            refreshVisitedVisualState(firebaseService);
            if (typeof window.syncState === 'function') {
                window.syncState();
            }
            await firebaseService.updateCurrentUserVisitedPlaces(Array.from(visitedPlaces.values()));
            return { success: true, action: 'removed' };
        }

        const canSyncProgress = typeof firebaseService.syncUserProgress === 'function';
        const canUpdateVisitedPlaces = typeof firebaseService.updateCurrentUserVisitedPlaces === 'function';
        if (!canSyncProgress && !canUpdateVisitedPlaces) {
            return { success: false, error: 'SERVICE_UNAVAILABLE' };
        }

        const visitRecord = createVisitRecord(parkData, false);
        visitedPlaces.set(parkData.id, visitRecord);
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(visitRecord);
        }
        if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
            window.BARK.invalidateVisitedIdsCache();
        }
        refreshVisitedVisualState(firebaseService);
        if (typeof window.syncState === 'function') {
            window.syncState();
        }

        if (canSyncProgress) {
            await firebaseService.syncUserProgress();
        } else {
            await firebaseService.updateCurrentUserVisitedPlaces(Array.from(visitedPlaces.values()));
        }

        queueDailyStreakIncrement(firebaseService);
        return { success: true, action: 'added', visitRecord };
    } catch (error) {
        if (parkData && typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
            firebaseService.clearVisitedPlacePendingMutation(parkData.id);
        }
        if (typeof firebaseService.replaceLocalVisitedPlaces === 'function' && previousVisitedPlaces) {
            firebaseService.replaceLocalVisitedPlaces(previousVisitedPlaces);
        }
        console.error('[checkinService] markAsVisited failed:', error);
        return { success: false, error: 'VISIT_UPDATE_FAILED' };
    }
}

window.BARK.services.checkin = {
    verifyAndProcessCheckin,
    verifyGpsCheckin,
    markAsVisited
};
