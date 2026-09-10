// Installable triggers are configured later, never installed by opening this script.
// Script Properties: BARK_SHEET_ID, BARK_SHEET_NAME, BARK_SIGNAL_URL, BARK_SIGNAL_SECRET.
function catalogEdited(event) {
    const properties = PropertiesService.getScriptProperties();
    if (!event || event.source.getId() !== properties.getProperty('BARK_SHEET_ID') ||
        event.range.getSheet().getName() !== properties.getProperty('BARK_SHEET_NAME')) return;
    properties.setProperty('BARK_PENDING', Utilities.getUuid());
    flushCatalogSignal();
}

// A later one-minute trigger retries throttled/failed signals. Backend reconciliation covers formula/API edits.
function flushCatalogSignal() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(1000)) return;
    try {
        const props = PropertiesService.getScriptProperties();
        const pending = props.getProperty('BARK_PENDING');
        if (!pending) return;
        const now = Date.now();
        if (now - Number(props.getProperty('BARK_LAST_SENT') || 0) < 10000) return;
        const url = props.getProperty('BARK_SIGNAL_URL');
        const secret = props.getProperty('BARK_SIGNAL_SECRET');
        if (!url || !secret || !/^https:\/\/[a-z0-9-]+-barkrangermap-auth\.cloudfunctions\.net\/nativeCatalogEditSignal$/.test(url)) throw new Error('Catalog signal is not configured for Bark Ranger.');
        const nonce = Utilities.getUuid();
        const signature = Utilities.computeHmacSha256Signature(now + '.' + nonce, secret)
            .map(value => ('0' + (value & 255).toString(16)).slice(-2)).join('');
        const response = UrlFetchApp.fetch(url, { method: 'post', contentType: 'application/json',
            payload: JSON.stringify({ timestamp: now, nonce: nonce }),
            headers: { 'X-Bark-Catalog-Signature': signature }, muteHttpExceptions: true });
        props.setProperty('BARK_LAST_SENT', String(now));
        // 202 means another publisher holds the lease: keep pending and retry after the debounce.
        if (response.getResponseCode() === 200 && props.getProperty('BARK_PENDING') === pending) props.deleteProperty('BARK_PENDING');
    } finally { lock.releaseLock(); }
}
