/**
 * firebaseService.js - Firestore CRUD and Firebase-backed user data helpers.
 * Saved-route DOM rendering lives in renderers/routeRenderer.js.
 *
 * Future personal-data model notes:
 *   `visitedPlaces` is currently the compact progress/check-in record used by
 *   scoring, achievements, profile rendering, and marker visited state. Keep it
 *   small. It should answer "has this user visited this official BARK place?"
 *   and basic timestamp/verification questions only.
 *
 *   Do not expand visitedPlaces into a scrapbook. User photos, personal notes,
 *   dog/BARK gear memories, per-trip notes, and future reviews should move into
 *   separate user-owned records, for example:
 *
 *     users/{uid}/placeMemories/{placeId}
 *       Official-place memories keyed by canonical BARK place id.
 *
 *     users/{uid}/customPlaces/{customPlaceId}
 *       User-created/geocoded towns or other non-BARK places.
 *
 *     users/{uid}/tripStopMemories/{tripStopId}
 *       Notes/photos tied to one stop inside one saved/current route.
 *
 *   Store uploaded image bytes in Firebase Storage, not Firestore. Firestore
 *   should hold metadata only: storage paths, thumbnail URLs, captions,
 *   visibility, createdAt/updatedAt, and ownership. Load these lazily when the
 *   place card opens so map pan/zoom and marker sync never pay photo costs.
 *
 *   Critical future questions before implementing:
 *     - Can one user have both a general memory for a park and a separate note
 *       for the same park inside a specific trip? Recommended answer: yes.
 *     - Are reviews public, private, or moderated? This changes security rules.
 *     - Can custom towns be reused across trips? If yes, give them customPlaceId.
 *     - Can shared trips include private memories? Recommended default: no,
 *       share route geometry/stops separately from personal media.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

function getCurrentUser() {
    if (typeof firebase === 'undefined') return null;
    return firebase.auth().currentUser;
}

function getLocalDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function readCompletedExpeditionsFromUserData(data) {
    if (!data || typeof data !== 'object') return [];

    if (Array.isArray(data.completed_expeditions)) return data.completed_expeditions;
    if (Array.isArray(data.completedExpeditions)) return data.completedExpeditions;
    return [];
}

const pendingVisitedPlaceMutations = new Map();

function cloneVisitedPlace(place) {
    return place && typeof place === 'object' ? { ...place } : place;
}

function hasVisitedPlaceId(place) {
    return place && typeof place === 'object' && place.id !== undefined && place.id !== null;
}

function makeVisitedPlaceMap(placeList) {
    const visitedMap = new Map();
    if (!Array.isArray(placeList)) return visitedMap;

    placeList.forEach(place => {
        if (hasVisitedPlaceId(place)) visitedMap.set(place.id, cloneVisitedPlace(place));
    });
    return visitedMap;
}

function getVisitedPlacesArray() {
    return Array.from((window.BARK.userVisitedPlaces || new Map()).values()).map(cloneVisitedPlace);
}

function stringifyVisitValue(value) {
    if (value && typeof value === 'object') {
        const sorted = {};
        Object.keys(value).sort().forEach(key => { sorted[key] = value[key]; });
        return JSON.stringify(sorted);
    }
    return JSON.stringify(value);
}

function visitedPlaceRecordsMatch(left, right) {
    if (!left || !right) return false;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
        if (stringifyVisitValue(left[key]) !== stringifyVisitValue(right[key])) return false;
    }
    return true;
}

function isAuthoritativeSnapshot(metadata = {}) {
    return metadata.fromCache !== true && metadata.hasPendingWrites !== true;
}

function stageVisitedPlaceUpsert(place) {
    if (!hasVisitedPlaceId(place)) return;
    pendingVisitedPlaceMutations.set(place.id, {
        type: 'upsert',
        place: cloneVisitedPlace(place),
        startedAt: Date.now()
    });
}

function stageVisitedPlaceDelete(placeId) {
    if (placeId === undefined || placeId === null) return;
    pendingVisitedPlaceMutations.set(placeId, {
        type: 'delete',
        startedAt: Date.now()
    });
}

function clearVisitedPlacePendingMutation(placeId) {
    if (placeId !== undefined && placeId !== null) pendingVisitedPlaceMutations.delete(placeId);
}

function clearVisitedPlacePendingMutations() {
    pendingVisitedPlaceMutations.clear();
}

function reconcileVisitedPlacesSnapshot(placeList, metadata = {}) {
    const nextMap = makeVisitedPlaceMap(placeList);
    const snapshotCanConfirm = isAuthoritativeSnapshot(metadata);

    pendingVisitedPlaceMutations.forEach((mutation, placeId) => {
        if (mutation.type === 'delete') {
            if (snapshotCanConfirm && !nextMap.has(placeId)) {
                pendingVisitedPlaceMutations.delete(placeId);
                return;
            }
            nextMap.delete(placeId);
            return;
        }

        const snapshotPlace = nextMap.get(placeId);
        if (snapshotCanConfirm && visitedPlaceRecordsMatch(snapshotPlace, mutation.place)) {
            pendingVisitedPlaceMutations.delete(placeId);
            return;
        }

        nextMap.set(placeId, cloneVisitedPlace(mutation.place));
    });

    return nextMap;
}

function replaceLocalVisitedPlaces(visitedMap) {
    window.BARK.userVisitedPlaces = visitedMap instanceof Map ? visitedMap : new Map();
    if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
        window.BARK.invalidateVisitedIdsCache();
    }
}

async function attemptDailyStreakIncrement() {
    try {
        const user = getCurrentUser();
        if (!user) return { success: false, message: "Not logged in" };

        const today = getLocalDateKey();
        const docRef = firebase.firestore().collection('users').doc(user.uid);
        const doc = await docRef.get();
        const data = doc.exists ? doc.data() : {};

        const lastStreakDate = data.lastStreakDate || localStorage.getItem('lastStreakDate');
        if (lastStreakDate === today) return { success: false, message: "Already incremented today" };

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = getLocalDateKey(yesterday);

        let currentStreak = parseInt(data.streakCount || localStorage.getItem('streakCount') || 0);

        if (lastStreakDate === yesterdayStr) {
            currentStreak += 1;
        } else {
            currentStreak = 1;
        }

        window.BARK.incrementRequestCount();
        await docRef.set({
            streakCount: currentStreak,
            lastStreakDate: today
        }, { merge: true });

        localStorage.setItem('lastStreakDate', today);
        localStorage.setItem('streakCount', currentStreak);

        const streakLabel = document.getElementById('streak-count-label');
        if (streakLabel) streakLabel.textContent = currentStreak;

        return { success: true, count: currentStreak };
    } catch (error) {
        console.error("[firebaseService] attemptDailyStreakIncrement failed:", error);
        return { success: false, message: error.message || "Failed to update streak" };
    }
}

async function syncUserProgress() {
    let visitedArray = [];
    try {
        const user = getCurrentUser();
        if (!user) return;

        const db = firebase.firestore();
        window.BARK.incrementRequestCount();

        visitedArray = getVisitedPlacesArray();
        visitedArray.forEach(stageVisitedPlaceUpsert);
        await db.collection('users').doc(user.uid).set({
            visitedPlaces: visitedArray
        }, { merge: true });

        window.syncState();
    } catch (error) {
        visitedArray.forEach(place => clearVisitedPlacePendingMutation(place && place.id));
        console.error("[firebaseService] syncUserProgress failed:", error);
        throw error;
    }
}

async function updateCurrentUserVisitedPlaces(visitedArray) {
    let nextVisitedArray = [];
    try {
        const user = getCurrentUser();
        if (!user) return;

        nextVisitedArray = Array.isArray(visitedArray) ? visitedArray.map(cloneVisitedPlace) : [];
        nextVisitedArray.forEach(stageVisitedPlaceUpsert);
        window.BARK.incrementRequestCount();
        await firebase.firestore().collection('users').doc(user.uid).update({ visitedPlaces: nextVisitedArray });
    } catch (error) {
        nextVisitedArray.forEach(place => clearVisitedPlacePendingMutation(place && place.id));
        console.error("[firebaseService] updateCurrentUserVisitedPlaces failed:", error);
        throw error;
    }
}

async function updateVisitDate(parkId, newTs) {
    const previousVisitedPlaces = new Map(window.BARK.userVisitedPlaces || new Map());
    try {
        if (window.BARK.userVisitedPlaces.has(parkId)) {
            const nextVisitedPlaces = new Map(window.BARK.userVisitedPlaces);
            const updatedPlace = {
                ...nextVisitedPlaces.get(parkId),
                ts: newTs
            };
            nextVisitedPlaces.set(parkId, updatedPlace);
            replaceLocalVisitedPlaces(nextVisitedPlaces);
            stageVisitedPlaceUpsert(updatedPlace);
            await updateCurrentUserVisitedPlaces(getVisitedPlacesArray());
            window.BARK.renderManagePortal();
        }
    } catch (error) {
        clearVisitedPlacePendingMutation(parkId);
        replaceLocalVisitedPlaces(previousVisitedPlaces);
        console.error("[firebaseService] updateVisitDate failed:", error);
        throw error;
    }
}

function getVisitedPlaceId(placeOrId) {
    if (placeOrId && typeof placeOrId === 'object') return placeOrId.id || null;
    return placeOrId || null;
}

function getLatestVisitedPlace(placeId) {
    const visitedPlaces = window.BARK.userVisitedPlaces;
    if (!visitedPlaces || typeof visitedPlaces.get !== 'function') return null;

    return visitedPlaces.get(placeId) || null;
}

async function removeVisitedPlace(placeOrId) {
    const placeId = getVisitedPlaceId(placeOrId);
    const previousVisitedPlaces = new Map(window.BARK.userVisitedPlaces || new Map());
    try {
        const latestPlace = getLatestVisitedPlace(placeId);
        if (!latestPlace) {
            if (typeof window.BARK.renderManagePortal === 'function') {
                window.BARK.renderManagePortal();
            }
            alert("That visit is no longer in your Manage Portal. The list has been refreshed.");
            return;
        }

        if (window.confirm(`Remove ${latestPlace.name || 'this visit'}?`)) {
            window.BARK.userVisitedPlaces.delete(placeId);
            stageVisitedPlaceDelete(placeId);
            if (typeof window.BARK.invalidateVisitedIdsCache === 'function') {
                window.BARK.invalidateVisitedIdsCache();
            }
            await syncUserProgress();
            window.syncState();
            window.BARK.renderManagePortal();
        }
    } catch (error) {
        clearVisitedPlacePendingMutation(placeId);
        replaceLocalVisitedPlaces(previousVisitedPlaces);
        console.error("[firebaseService] removeVisitedPlace failed:", error);
        throw error;
    }
}

async function loadSavedRoutes(uid, cursor = null, limit = null) {
    try {
        const fetchLimit = limit || (cursor ? 5 : 3);
        window.BARK.incrementRequestCount();

        let query = firebase.firestore()
            .collection('users').doc(uid)
            .collection('savedRoutes')
            .orderBy('createdAt', 'desc');

        if (cursor) query = query.startAfter(cursor);

        const snapshot = await query.limit(fetchLimit).get();
        const routes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        return {
            routes,
            nextCursor: snapshot.empty ? null : snapshot.docs[snapshot.docs.length - 1],
            hasMore: snapshot.size === fetchLimit
        };
    } catch (error) {
        console.error("[firebaseService] loadSavedRoutes failed:", error);
        throw error;
    }
}

async function loadSavedRoute(uid, routeId) {
    try {
        window.BARK.incrementRequestCount();
        const docSnap = await firebase.firestore()
            .collection('users').doc(uid)
            .collection('savedRoutes').doc(routeId).get();
        return docSnap.exists ? { id: docSnap.id, ...docSnap.data() } : null;
    } catch (error) {
        console.error("[firebaseService] loadSavedRoute failed:", error);
        throw error;
    }
}

async function deleteSavedRoute(uid, routeId) {
    try {
        window.BARK.incrementRequestCount();
        await firebase.firestore()
            .collection('users').doc(uid)
            .collection('savedRoutes').doc(routeId).delete();
    } catch (error) {
        console.error("[firebaseService] deleteSavedRoute failed:", error);
        throw error;
    }
}

async function getCompletedExpeditions(uid) {
    try {
        if (!uid) return [];

        window.BARK.incrementRequestCount();
        const docSnap = await firebase.firestore().collection('users').doc(uid).get();
        if (!docSnap.exists) return [];

        return readCompletedExpeditionsFromUserData(docSnap.data());
    } catch (error) {
        console.error("[firebaseService] getCompletedExpeditions failed:", error);
        throw error;
    }
}

async function saveUserSettings(uid, settingsPayload) {
    try {
        if (!uid) throw new Error("Cannot save settings without a user id.");

        window.BARK.incrementRequestCount();
        await firebase.firestore().collection('users').doc(uid).set({ settings: settingsPayload }, { merge: true });
    } catch (error) {
        console.error("[firebaseService] saveUserSettings failed:", error);
        throw error;
    }
}

async function adminEditPoints() {
    if (!window.isAdmin) return alert("Unauthorized: Admin credentials required.");

    const user = getCurrentUser();
    if (!user) return alert("Unauthorized: Admin credentials required.");

    const currentVal = window.currentWalkPoints || 0;
    const newScore = prompt("ADMIN: Manually override your Walk Points?", currentVal);

    if (newScore !== null && !isNaN(newScore)) {
        const finalPoints = parseFloat(newScore);
        try {
            window.BARK.incrementRequestCount();
            await firebase.firestore().collection('users').doc(user.uid).set({ walkPoints: finalPoints }, { merge: true });
            alert(`Admin Success: Walk Points set to ${finalPoints}`);
        } catch (error) {
            console.error("[firebaseService] adminEditPoints failed:", error);
            alert("Failed to override points.");
        }
    }
}

const firebaseService = {
    getCurrentUser,
    attemptDailyStreakIncrement,
    syncUserProgress,
    updateCurrentUserVisitedPlaces,
    updateVisitDate,
    removeVisitedPlace,
    reconcileVisitedPlacesSnapshot,
    replaceLocalVisitedPlaces,
    stageVisitedPlaceUpsert,
    stageVisitedPlaceDelete,
    clearVisitedPlacePendingMutation,
    clearVisitedPlacePendingMutations,
    loadSavedRoutes,
    loadSavedRoute,
    deleteSavedRoute,
    getCompletedExpeditions,
    saveUserSettings,
    adminEditPoints
};

window.BARK.services.firebase = firebaseService;
window.attemptDailyStreakIncrement = attemptDailyStreakIncrement;
window.BARK.syncUserProgress = syncUserProgress;
window.BARK.updateCurrentUserVisitedPlaces = updateCurrentUserVisitedPlaces;
window.BARK.updateVisitDate = updateVisitDate;
window.BARK.removeVisitedPlace = removeVisitedPlace;
window.BARK.getCompletedExpeditions = getCompletedExpeditions;
window.BARK.saveUserSettings = saveUserSettings;
window.adminEditPoints = adminEditPoints;
