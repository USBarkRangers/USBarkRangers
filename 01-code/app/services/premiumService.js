/**
 * premiumService.js - Read-only premium entitlement state normalization.
 */
window.BARK = window.BARK || {};
window.BARK.services = window.BARK.services || {};

(function initPremiumService() {
    const DEFAULT_ENTITLEMENT = Object.freeze({
        premium: false,
        status: 'free',
        source: 'none',
        manualOverride: false,
        currentPeriodEnd: null,
        expiresAt: null,
        autoRenew: null,
        paymentMethodAttached: null,
        accessCodeType: null,
        accessCodeAudience: null,
        reason: null,
        providerCustomerId: null,
        providerSubscriptionId: null,
        lemonSqueezySubscriptionId: null,
        endsAt: null
    });

    const PREMIUM_STATUSES = new Set(['active', 'manual_active', 'past_due', 'paused', 'cancelled_active']);
    const OFFLINE_SESSION_KEY = 'bark.offlinePremiumSession.v1';
    const OFFLINE_SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

    let entitlement = { ...DEFAULT_ENTITLEMENT };
    let offlineSessionActive = false;
    let debugMeta = {
        uid: null,
        reason: 'initial',
        revision: 0,
        updatedAt: null
    };
    const listeners = new Set();

    function cloneEntitlement(value = entitlement) {
        return { ...value };
    }

    function normalizeString(value, fallback) {
        return typeof value === 'string' && value.trim() ? value.trim() : fallback;
    }

    function normalizePeriodEnd(value) {
        if (!value) return null;
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string') return value;
        if (value instanceof Date) return value.toISOString();
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (Number.isFinite(Number(value.seconds))) {
            return (Number(value.seconds) * 1000) + Math.floor(Number(value.nanoseconds || 0) / 1000000);
        }
        return null;
    }

    function getCurrentAuthUid() {
        try {
            if (typeof firebase === 'undefined' || typeof firebase.auth !== 'function') {
                return undefined;
            }
            const auth = firebase.auth();
            if (!auth) return undefined;
            const user = auth.currentUser;
            return user && user.uid ? user.uid : null;
        } catch (error) {
            return undefined;
        }
    }

    function readStoredOfflineSession() {
        try {
            const raw = localStorage.getItem(OFFLINE_SESSION_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;

            const uid = normalizeString(parsed.uid, null);
            const cachedAt = Number(parsed.cachedAt);
            const normalizedEntitlement = normalizeEntitlement(parsed.entitlement);
            const entitlementEnd = normalizePeriodEnd(
                normalizedEntitlement.currentPeriodEnd
                || normalizedEntitlement.endsAt
                || normalizedEntitlement.expiresAt
            );
            const entitlementEndMs = typeof entitlementEnd === 'number'
                ? entitlementEnd
                : typeof entitlementEnd === 'string'
                    ? Date.parse(entitlementEnd)
                    : null;
            const fresh = Number.isFinite(cachedAt)
                && cachedAt > 0
                && Date.now() - cachedAt <= OFFLINE_SESSION_MAX_AGE_MS;
            const notExpired = !Number.isFinite(entitlementEndMs) || entitlementEndMs > Date.now();

            if (!uid || !fresh || !notExpired || normalizedEntitlement.premium !== true) return null;
            return {
                uid,
                displayName: normalizeString(parsed.displayName, null),
                email: normalizeString(parsed.email, null),
                cachedAt,
                entitlement: normalizedEntitlement
            };
        } catch (_error) {
            return null;
        }
    }

    function removeStoredOfflineSession(uid = null) {
        try {
            if (uid) {
                const current = readStoredOfflineSession();
                if (current && current.uid !== uid) return false;
            }
            localStorage.removeItem(OFFLINE_SESSION_KEY);
            return true;
        } catch (_error) {
            return false;
        }
    }

    function rememberAuthoritativeOfflineSession(raw, user) {
        const uid = user && normalizeString(user.uid, null);
        if (!uid) return false;

        const normalizedEntitlement = normalizeEntitlement(raw);
        if (!normalizedEntitlement.premium) {
            removeStoredOfflineSession(uid);
            return false;
        }

        try {
            localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify({
                uid,
                displayName: normalizeString(user.displayName, null),
                email: normalizeString(user.email, null),
                cachedAt: Date.now(),
                entitlement: normalizedEntitlement
            }));
            return true;
        } catch (_error) {
            return false;
        }
    }

    function restoreOfflineSession() {
        const session = readStoredOfflineSession();
        if (!session) {
            removeStoredOfflineSession();
            offlineSessionActive = false;
            return null;
        }

        offlineSessionActive = true;
        setEntitlement(session.entitlement, {
            uid: session.uid,
            reason: 'offline-premium-restore',
            preserveOfflineSession: true
        });
        return {
            uid: session.uid,
            displayName: session.displayName,
            email: session.email,
            cachedAt: session.cachedAt
        };
    }

    function getActiveOfflineSession() {
        if (!offlineSessionActive) return null;
        const session = readStoredOfflineSession();
        if (!session || session.uid !== debugMeta.uid) {
            offlineSessionActive = false;
            return null;
        }
        return {
            uid: session.uid,
            displayName: session.displayName,
            email: session.email,
            cachedAt: session.cachedAt
        };
    }

    function deactivateOfflineSession(options = {}) {
        const activeUid = debugMeta.uid;
        offlineSessionActive = false;
        if (options.clear === true) removeStoredOfflineSession(options.uid || activeUid || null);
    }

    function entitlementMatchesCurrentUser() {
        const currentUid = getCurrentAuthUid();
        if (currentUid === undefined) return true;
        if (!currentUid && offlineSessionActive && window._authStateResolved !== true) {
            const offlineSession = getActiveOfflineSession();
            return Boolean(offlineSession && offlineSession.uid === debugMeta.uid);
        }
        if (!currentUid) return !debugMeta.uid;
        return debugMeta.uid === currentUid;
    }

    function normalizeEntitlement(raw) {
        if (!raw || typeof raw !== 'object') {
            return { ...DEFAULT_ENTITLEMENT };
        }

        let status = normalizeString(raw.status, DEFAULT_ENTITLEMENT.status);
        const source = normalizeString(raw.source, DEFAULT_ENTITLEMENT.source);
        const expiresAt = normalizePeriodEnd(raw.expiresAt);
        const expiresAtMs = typeof expiresAt === 'number'
            ? expiresAt
            : typeof expiresAt === 'string'
                ? Date.parse(expiresAt)
                : null;
        const accessCodeActive = source === 'access_code' &&
            status === 'access_code_active' &&
            Number.isFinite(expiresAtMs) &&
            expiresAtMs > Date.now();
        if (source === 'access_code' && status === 'access_code_active' && !accessCodeActive) {
            status = 'access_code_expired';
        }
        const premium = raw.premium === true && (PREMIUM_STATUSES.has(status) || accessCodeActive);

        return {
            premium,
            status,
            source,
            manualOverride: raw.manualOverride === true,
            currentPeriodEnd: normalizePeriodEnd(raw.currentPeriodEnd),
            expiresAt,
            autoRenew: raw.autoRenew === true ? true : raw.autoRenew === false ? false : null,
            paymentMethodAttached: raw.paymentMethodAttached === true ? true : raw.paymentMethodAttached === false ? false : null,
            accessCodeType: normalizeString(raw.accessCodeType, null),
            accessCodeAudience: normalizeString(raw.accessCodeAudience, null),
            reason: normalizeString(raw.reason, null),
            providerCustomerId: normalizeString(raw.providerCustomerId, null),
            providerSubscriptionId: normalizeString(raw.providerSubscriptionId, null),
            lemonSqueezySubscriptionId: normalizeString(raw.lemonSqueezySubscriptionId, null),
            endsAt: normalizePeriodEnd(raw.endsAt)
        };
    }

    function getStateKey(value) {
        return JSON.stringify(value);
    }

    function notify() {
        const snapshot = cloneEntitlement();
        listeners.forEach(listener => {
            try {
                listener(snapshot);
            } catch (error) {
                console.error('[premiumService] subscriber failed:', error);
            }
        });
    }

    function setEntitlement(raw, options = {}) {
        const nextEntitlement = normalizeEntitlement(raw);
        const changed = getStateKey(nextEntitlement) !== getStateKey(entitlement);

        entitlement = nextEntitlement;
        debugMeta = {
            uid: options.uid || null,
            reason: options.reason || null,
            revision: changed ? debugMeta.revision + 1 : debugMeta.revision,
            updatedAt: new Date().toISOString()
        };
        if (options.preserveOfflineSession !== true) offlineSessionActive = false;

        if (changed) notify();
        return cloneEntitlement();
    }

    function reset(options = {}) {
        return setEntitlement(null, {
            uid: options.uid || null,
            reason: options.reason || 'reset'
        });
    }

    function getEntitlement() {
        return cloneEntitlement();
    }

    function isPremium() {
        return entitlement.premium === true && entitlementMatchesCurrentUser();
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') {
            throw new TypeError('premiumService.subscribe requires a listener function.');
        }
        listeners.add(listener);
        return function unsubscribePremiumListener() {
            listeners.delete(listener);
        };
    }

    function getDebugState() {
        return {
            entitlement: cloneEntitlement(),
            meta: { ...debugMeta },
            offlineSessionActive,
            subscriberCount: listeners.size
        };
    }

    const service = {
        reset,
        normalizeEntitlement,
        setEntitlement,
        getEntitlement,
        isPremium,
        rememberAuthoritativeOfflineSession,
        restoreOfflineSession,
        getActiveOfflineSession,
        deactivateOfflineSession,
        subscribe,
        getDebugState
    };

    window.BARK.services.premium = service;
    window.BARK.premiumService = service;
})();
