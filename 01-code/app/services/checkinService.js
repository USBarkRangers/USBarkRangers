/**
 * checkinService.js - GPS check-in validation and visit record construction.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

const FREE_VISIT_LIMIT = 5;

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

function getVaultRepo() {
    return window.BARK.repos && window.BARK.repos.VaultRepo;
}

function getPremiumService() {
    return window.BARK.services && window.BARK.services.premium;
}

function refreshVisitedCache(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedCache === 'function') {
        coordinator.refreshVisitedCache(reason);
        return true;
    }

    if (window.BARK && typeof window.BARK.invalidateVisitedIdsCache === 'function') {
        window.BARK.invalidateVisitedIdsCache();
        return true;
    }

    return false;
}

function refreshVisitedVisuals(reason, firebaseService = null) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.refreshVisitedVisuals === 'function') {
        coordinator.refreshVisitedVisuals(reason);
        return true;
    }

    const fallbackFirebaseService = firebaseService || (window.BARK.services && window.BARK.services.firebase);
    if (fallbackFirebaseService && typeof fallbackFirebaseService.refreshVisitedVisualState === 'function') {
        fallbackFirebaseService.refreshVisitedVisualState();
        return true;
    }

    return false;
}

function requestVisitStateSync(reason) {
    const coordinator = window.BARK && window.BARK.refreshCoordinator;
    if (coordinator && typeof coordinator.requestVisitStateSync === 'function') {
        coordinator.requestVisitStateSync(reason);
        return true;
    }

    if (typeof window.syncState === 'function') {
        window.syncState();
        return true;
    }

    return false;
}

function getCheckinVisitedPlacesArray() {
    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.getVisits === 'function') {
        return vaultRepo.getVisits();
    }

    return [];
}

function getCheckinVisitedPlaceEntries(parkData) {
    if (typeof window.BARK.getVisitedPlaceEntries === 'function') {
        return window.BARK.getVisitedPlaceEntries(parkData);
    }

    const vaultRepo = getVaultRepo();
    if (vaultRepo && typeof vaultRepo.hasVisit === 'function' && typeof vaultRepo.getVisit === 'function') {
        return vaultRepo.hasVisit(parkData)
            ? [{ id: parkData.id, record: vaultRepo.getVisit(parkData) }]
            : [];
    }

    return [];
}

function getCurrentFirebaseUser() {
    return typeof firebase !== 'undefined' && firebase.auth
        ? firebase.auth().currentUser
        : null;
}

function canRestoreVaultSnapshot(token, expectedUid) {
    const user = getCurrentFirebaseUser();
    return Boolean(user && token && (!expectedUid || user.uid === expectedUid));
}

function getCurrentFirebaseUid() {
    const user = getCurrentFirebaseUser();
    return user ? user.uid : null;
}

function isCurrentUserPremium() {
    const premiumService = getPremiumService();
    return Boolean(
        premiumService &&
        typeof premiumService.isPremium === 'function' &&
        premiumService.isPremium()
    );
}

function getCurrentVisitCount() {
    return getCheckinVisitedPlacesArray()
        .filter(place => place && place.id !== undefined && place.id !== null && place.id !== '')
        .length;
}

function getFreeVisitLimitBlock(visitedEntries) {
    if (!getCurrentFirebaseUser()) return null;
    if (isCurrentUserPremium()) return null;
    if (Array.isArray(visitedEntries) && visitedEntries.length > 0) return null;

    const currentCount = getCurrentVisitCount();
    if (currentCount < FREE_VISIT_LIMIT) return null;

    return {
        success: false,
        error: 'FREE_VISIT_LIMIT',
        limit: FREE_VISIT_LIMIT,
        currentCount
    };
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

function verifyAndProcessCheckin(parkData, userLocation) {
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

async function verifyGpsCheckin(parkData) {
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

    let token = null;
    let tokenUid = null;
    let rollbackToken = null;
    try {
        const checkinResult = verifyAndProcessCheckin(parkData, position.coords);
        if (!checkinResult.success) return checkinResult;

        const vaultRepo = getVaultRepo();
        if (!vaultRepo) return { success: false, error: 'VISITED_PLACES_UNAVAILABLE' };
        tokenUid = getCurrentFirebaseUid();
        token = vaultRepo.snapshot();

        const visitedEntries = getCheckinVisitedPlaceEntries(parkData);
        const limitBlock = getFreeVisitLimitBlock(visitedEntries);
        if (limitBlock) return limitBlock;

        const existingEntry = visitedEntries.length > 0 ? visitedEntries[0] : null;
        const touchedIds = [parkData.id];
        if (existingEntry && existingEntry.id !== parkData.id) {
            touchedIds.push(existingEntry.id);
            vaultRepo.removeVisit(existingEntry.id);
            if (typeof firebaseService.stageVisitedPlaceDelete === 'function') {
                firebaseService.stageVisitedPlaceDelete(existingEntry.id);
            }
        }

        vaultRepo.addVisit(checkinResult.visitRecord);
        if (typeof vaultRepo.createRollbackToken === 'function') {
            rollbackToken = vaultRepo.createRollbackToken(token, touchedIds);
        }
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(checkinResult.visitRecord);
        }
        refreshVisitedCache('checkin-verified-add');
        refreshVisitedVisuals('checkin-verified-add', firebaseService);
        requestVisitStateSync('checkin-verified-add');
        await firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray());
        queueDailyStreakIncrement(firebaseService);

        return {
            ...checkinResult,
            action: 'verified'
        };
    } catch (error) {
        const vaultRepo = getVaultRepo();
        if (vaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof vaultRepo.restore === 'function') {
            vaultRepo.restore(rollbackToken || token);
        } else if (parkData && typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
            firebaseService.clearVisitedPlacePendingMutation(parkData.id);
        }
        console.error('[checkinService] verifyGpsCheckin failed:', error);
        return { success: false, error: 'CHECKIN_FAILED' };
    }
}

async function markAsVisited(parkData) {
    const firebaseService = getFirebaseService();

    if (!firebaseService) return { success: false, error: 'SERVICE_UNAVAILABLE' };

    let token = null;
    let tokenUid = null;
    let rollbackToken = null;
    try {
        const vaultRepo = getVaultRepo();
        if (!vaultRepo) return { success: false, error: 'VISITED_PLACES_UNAVAILABLE' };
        tokenUid = getCurrentFirebaseUid();
        token = vaultRepo.snapshot();

        const visitedEntries = getCheckinVisitedPlaceEntries(parkData);

        if (visitedEntries.length > 0) {
            if (visitedEntries.some(entry => entry.record && entry.record.verified)) {
                return { success: false, error: 'ALREADY_VERIFIED' };
            }
            if (!window.allowUncheck) return { success: false, error: 'UNCHECK_LOCKED' };
            if (typeof firebaseService.updateCurrentUserVisitedPlaces !== 'function') {
                return { success: false, error: 'SERVICE_UNAVAILABLE' };
            }

            const entryIds = visitedEntries.map(entry => entry.id);
            vaultRepo.removeVisits(entryIds);
            if (typeof vaultRepo.createRollbackToken === 'function') {
                rollbackToken = vaultRepo.createRollbackToken(token, entryIds);
            }
            if (typeof firebaseService.stageVisitedPlaceDelete === 'function') {
                entryIds.forEach(firebaseService.stageVisitedPlaceDelete);
            }
            refreshVisitedCache('checkin-unmark-remove');
            refreshVisitedVisuals('checkin-unmark-remove', firebaseService);
            requestVisitStateSync('checkin-unmark-remove');
            await firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray());
            return { success: true, action: 'removed' };
        }

        const limitBlock = getFreeVisitLimitBlock(visitedEntries);
        if (limitBlock) return limitBlock;

        const canSyncProgress = typeof firebaseService.syncUserProgress === 'function';
        const canUpdateVisitedPlaces = typeof firebaseService.updateCurrentUserVisitedPlaces === 'function';
        if (!canSyncProgress && !canUpdateVisitedPlaces) {
            return { success: false, error: 'SERVICE_UNAVAILABLE' };
        }

        const visitRecord = createVisitRecord(parkData, false);
        vaultRepo.addVisit(visitRecord);
        if (typeof vaultRepo.createRollbackToken === 'function') {
            rollbackToken = vaultRepo.createRollbackToken(token, [parkData.id]);
        }
        if (typeof firebaseService.stageVisitedPlaceUpsert === 'function') {
            firebaseService.stageVisitedPlaceUpsert(visitRecord);
        }
        refreshVisitedCache('checkin-mark-add');
        refreshVisitedVisuals('checkin-mark-add', firebaseService);
        requestVisitStateSync('checkin-mark-add');

        if (canSyncProgress) {
            await firebaseService.syncUserProgress();
        } else {
            await firebaseService.updateCurrentUserVisitedPlaces(getCheckinVisitedPlacesArray());
        }

        queueDailyStreakIncrement(firebaseService);
        return { success: true, action: 'added', visitRecord };
    } catch (error) {
        const vaultRepo = getVaultRepo();
        if (vaultRepo && canRestoreVaultSnapshot(token, tokenUid) && typeof vaultRepo.restore === 'function') {
            vaultRepo.restore(rollbackToken || token);
        } else if (parkData && typeof firebaseService.clearVisitedPlacePendingMutation === 'function') {
            firebaseService.clearVisitedPlacePendingMutation(parkData.id);
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
