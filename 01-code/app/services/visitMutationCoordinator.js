/**
 * visitMutationCoordinator.js
 *
 * Serializes visited-place document writes and keeps intentional deletions in a
 * small, per-account local journal. Firestore transactions cannot run offline,
 * so a deletion must be recoverable before the UI is allowed to remove it.
 */
window.BARK = window.BARK || {};

(function initVisitMutationCoordinator() {
    const DELETE_JOURNAL_PREFIX = 'bark.pendingVisitDeletes.';
    const DEFAULT_RETRY_MS = 5000;
    const DEFAULT_DEBOUNCE_MS = 75;
    const liveCoordinators = new Set();

    function journalKey(uid) {
        return uid ? `${DELETE_JOURNAL_PREFIX}${uid}` : null;
    }

    function loadDeleteJournal(uid) {
        const key = journalKey(uid);
        if (!key) return {};
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            console.warn('[visitMutationCoordinator] unable to read delete journal:', error);
            return {};
        }
    }

    function saveDeleteJournal(uid, journal) {
        const key = journalKey(uid);
        if (!key) return false;
        try {
            if (!journal || Object.keys(journal).length === 0) {
                localStorage.removeItem(key);
            } else {
                localStorage.setItem(key, JSON.stringify(journal));
            }
            return true;
        } catch (error) {
            console.warn('[visitMutationCoordinator] unable to persist delete journal:', error);
            return false;
        }
    }

    function normalizeIds(ids) {
        return Array.from(new Set((Array.isArray(ids) ? ids : [ids])
            .map(value => value && typeof value === 'object' ? value.id : value)
            .filter(value => value !== undefined && value !== null && String(value).trim() !== '')
            .map(String)));
    }

    function stageDeletes(uid, entries) {
        const normalizedEntries = Array.isArray(entries) ? entries : [];
        const journal = loadDeleteJournal(uid);
        const stagedAt = Date.now();
        normalizedEntries.forEach(entry => {
            const id = entry && typeof entry === 'object' ? entry.id : entry;
            if (!id) return;
            journal[String(id)] = {
                id: String(id),
                stagedAt,
                record: entry && entry.record && typeof entry.record === 'object'
                    ? { ...entry.record }
                    : null
            };
        });

        if (!saveDeleteJournal(uid, journal)) return false;
        const persisted = loadDeleteJournal(uid);
        return normalizeIds(normalizedEntries).every(id => Boolean(persisted[id]));
    }

    function clearDeletes(uid, ids) {
        const normalizedIds = normalizeIds(ids);
        if (normalizedIds.length === 0) return;
        const journal = loadDeleteJournal(uid);
        let changed = false;
        normalizedIds.forEach(id => {
            if (!journal[id]) return;
            delete journal[id];
            changed = true;
        });
        if (changed) saveDeleteJournal(uid, journal);
    }

    function getPendingDeleteIds(uid) {
        return Object.freeze(Object.keys(loadDeleteJournal(uid)));
    }

    function reconcileCommittedDeletes(uid, committedVisits) {
        const committedIds = new Set((Array.isArray(committedVisits) ? committedVisits : [])
            .filter(visit => visit && visit.id)
            .map(visit => String(visit.id)));
        const confirmedDeletes = getPendingDeleteIds(uid).filter(id => !committedIds.has(id));
        clearDeletes(uid, confirmedDeletes);
        return Object.freeze(confirmedDeletes);
    }

    function createCoordinator(options = {}) {
        if (typeof options.capture !== 'function' || typeof options.commit !== 'function') {
            throw new Error('Visit mutation coordinator requires capture and commit functions.');
        }

        const retryMs = Number.isFinite(options.retryMs) ? Math.max(25, options.retryMs) : DEFAULT_RETRY_MS;
        const debounceMs = Number.isFinite(options.debounceMs) ? Math.max(0, options.debounceMs) : DEFAULT_DEBOUNCE_MS;
        let requestedRevision = 0;
        let committedRevision = 0;
        let running = false;
        let scheduledTimer = null;
        let retryTimer = null;
        let consecutiveRetryCount = 0;
        const waiters = [];

        function clearTimer(name) {
            const handle = name === 'scheduled' ? scheduledTimer : retryTimer;
            if (handle !== null) clearTimeout(handle);
            if (name === 'scheduled') scheduledTimer = null;
            else retryTimer = null;
        }

        function settleThrough(revision, method, value) {
            for (let index = waiters.length - 1; index >= 0; index--) {
                const waiter = waiters[index];
                if (waiter.revision > revision) continue;
                waiters.splice(index, 1);
                waiter[method](value);
            }
        }

        function schedule(delayMs = debounceMs) {
            if (running || scheduledTimer !== null || retryTimer !== null) return;
            scheduledTimer = setTimeout(() => {
                scheduledTimer = null;
                drain();
            }, delayMs);
        }

        function scheduleRetry(delayMs = retryMs) {
            if (retryTimer !== null) return;
            retryTimer = setTimeout(() => {
                retryTimer = null;
                drain();
            }, Math.max(25, Number(delayMs) || retryMs));
        }

        async function drain() {
            if (running || committedRevision >= requestedRevision) return;
            running = true;
            const targetRevision = requestedRevision;
            try {
                let committed;
                try {
                    const captured = options.capture();
                    committed = await options.commit(captured, targetRevision);
                } catch (error) {
                    const retryable = typeof options.isRetryable === 'function' && options.isRetryable(error);
                    if (retryable) {
                        consecutiveRetryCount++;
                        if (typeof options.onDeferred === 'function') options.onDeferred(error, targetRevision);
                        const requestedDelay = typeof options.getRetryDelay === 'function'
                            ? options.getRetryDelay(error, consecutiveRetryCount, retryMs)
                            : retryMs;
                        scheduleRetry(requestedDelay);
                    } else {
                        consecutiveRetryCount = 0;
                        committedRevision = Math.max(committedRevision, targetRevision);
                        settleThrough(targetRevision, 'reject', error);
                    }
                    return;
                }

                // Crossing this line means the provider commit succeeded. A
                // cache, renderer, or other local acknowledgement failure must
                // never turn that durable server result into a rejected write
                // or trigger a destructive client rollback.
                consecutiveRetryCount = 0;
                committedRevision = Math.max(committedRevision, targetRevision);
                if (typeof options.onCommitted === 'function') {
                    try {
                        await options.onCommitted(committed, targetRevision);
                    } catch (error) {
                        if (typeof options.onPostCommitError === 'function') {
                            try {
                                options.onPostCommitError(error, committed, targetRevision);
                            } catch (handlerError) {
                                console.error('[visitMutationCoordinator] post-commit error handler failed:', handlerError);
                            }
                        } else {
                            console.error('[visitMutationCoordinator] post-commit reconciliation failed:', error);
                        }
                    }
                }
                settleThrough(targetRevision, 'resolve', committed);
            } finally {
                running = false;
                if (committedRevision < requestedRevision && retryTimer === null) schedule(0);
            }
        }

        function request() {
            requestedRevision++;
            const revision = requestedRevision;
            const promise = new Promise((resolve, reject) => waiters.push({ revision, resolve, reject }));
            schedule();
            return promise;
        }

        function wake() {
            clearTimer('retry');
            consecutiveRetryCount = 0;
            if (committedRevision < requestedRevision) schedule(0);
        }

        function dispose(reason = 'disposed') {
            clearTimer('scheduled');
            clearTimer('retry');
            const error = new Error(`Visit mutation coordinator ${reason}.`);
            settleThrough(Number.POSITIVE_INFINITY, 'reject', error);
            liveCoordinators.delete(api);
        }

        const api = Object.freeze({
            request,
            wake,
            dispose,
            snapshot() {
                return Object.freeze({
                    requestedRevision,
                    committedRevision,
                    running,
                    waiting: waiters.length,
                    retryScheduled: retryTimer !== null,
                    consecutiveRetryCount
                });
            }
        });
        liveCoordinators.add(api);
        return api;
    }

    if (typeof window.addEventListener === 'function' && !window._barkVisitMutationWakeBound) {
        window._barkVisitMutationWakeBound = true;
        ['online', 'focus', 'pageshow'].forEach(eventName => {
            window.addEventListener(eventName, () => liveCoordinators.forEach(coordinator => coordinator.wake()));
        });
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState !== 'hidden') {
                    liveCoordinators.forEach(coordinator => coordinator.wake());
                }
            });
        }
    }

    window.BARK.visitMutationCoordinator = Object.freeze({
        createCoordinator,
        stageDeletes,
        clearDeletes,
        getPendingDeleteIds,
        reconcileCommittedDeletes
    });
})();
