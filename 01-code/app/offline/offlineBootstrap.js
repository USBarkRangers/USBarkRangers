/**
 * offlineBootstrap.js — installs and warms the minimum offline application shell.
 *
 * Visit/add/delete durability remains owned by checkinService and
 * visitMutationCoordinator. This module only makes the static SPA available
 * soon enough for those existing journals to run without a network.
 */
(function initOfflineBootstrap() {
    window.BARK = window.BARK || {};

    const state = {
        supported: 'serviceWorker' in navigator,
        registered: false,
        ready: false,
        error: null
    };

    function collectLoadedStaticResources() {
        const urls = new Set();
        document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="manifest"][href], link[rel~="icon"][href]')
            .forEach(element => {
                const raw = element.getAttribute('src') || element.getAttribute('href');
                if (!raw) return;
                try { urls.add(new URL(raw, document.baseURI).href); }
                catch (_error) { /* malformed optional resource; ignore it */ }
            });
        return Array.from(urls);
    }

    function warmActiveWorker(registration) {
        const worker = navigator.serviceWorker.controller || registration.active;
        if (!worker) return;
        worker.postMessage({
            type: 'BARK_CACHE_URLS',
            urls: collectLoadedStaticResources()
        });
    }

    async function registerOfflineWorker() {
        if (!state.supported || window.location.protocol === 'file:') return null;

        try {
            const registration = await navigator.serviceWorker.register('./sw.js?v=1', {
                scope: './',
                updateViaCache: 'none'
            });
            state.registered = true;

            const readyRegistration = await navigator.serviceWorker.ready;
            state.ready = true;
            warmActiveWorker(readyRegistration || registration);

            // Check for an updated shell without reloading or interrupting the
            // current map/card. The normal blue reload flow remains in charge.
            if (navigator.onLine !== false) registration.update().catch(() => {});
            return registration;
        } catch (error) {
            state.error = error;
            console.warn('[offlineBootstrap] Offline startup could not be prepared:', error);
            return null;
        }
    }

    window.addEventListener('online', () => {
        navigator.serviceWorker?.getRegistration('./')
            .then(registration => {
                if (!registration) return registerOfflineWorker();
                warmActiveWorker(registration);
                return registration.update();
            })
            .catch(() => {});
    });

    window.BARK.offline = Object.freeze({
        register: registerOfflineWorker,
        getStatus: () => ({ ...state })
    });

    registerOfflineWorker();
})();
