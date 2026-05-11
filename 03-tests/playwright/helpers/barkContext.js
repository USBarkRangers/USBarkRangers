async function newBarkContext(browser, options = {}) {
    const context = await browser.newContext({
        serviceWorkers: 'block',
        ...options
    });

    await context.addInitScript(() => {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.getRegistrations()
                .then((registrations) => registrations.forEach((registration) => registration.unregister()))
                .catch(() => {});
        }

        if (window.caches && typeof window.caches.keys === 'function') {
            window.caches.keys()
                .then((keys) => keys.forEach((key) => window.caches.delete(key)))
                .catch(() => {});
        }
    });

    return context;
}

async function expectBarkAppIdentity(page, expect) {
    await expect(page).toHaveTitle(/US BARK Rangers/);
    await expect(page.locator('body')).not.toContainText(/Just Dee Dee|JDDM|Music Live Map/i);
    await expect(page.locator('#filter-panel h1')).toContainText(/US BARK RANGERS/i);
}

module.exports = {
    expectBarkAppIdentity,
    newBarkContext
};
