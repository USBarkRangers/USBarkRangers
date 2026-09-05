# Offline startup and reload — beta 0.143

Devices with a prepared offline copy now reveal saved park pins without waiting for cloud sign-in. Startup dependencies are bundled locally, and requests for uncached app files, navigation, and map tiles have deadlines. A recovery message appears after about four seconds even when startup scripts or styles are stalled. Google Sheets errors preserve the last accepted catalog; the validated 0.142 fallback snapshot remains available when a device has no saved catalog.

The worker continues to install releases atomically and serve their matching saved HTML. It retains one previous shell for already-open clients, maps legacy CDN dependency requests to the matching local libraries, and prevents stalled response bodies from hanging catalog polling or startup downloads. Release checks still use the network with a cached fallback. No visit journals, account logic, cloud functions, rules, or production deployment changed.

Beta's landing page opens the immutable `index.v143.html` entry. Once controlled by a service worker, the page restores the canonical app URL so later reloads can select newer releases. Legacy public and private release files remain unchanged to protect existing worker caches. Firebase Hosting's existing 0.142 redirects are unchanged; update those during a separately authorized production promotion.

Validation:

- Full unit suite: 456 passed, including catalog fallback, atomic installation, response-body deadlines, and durable visit checks.
- Browser checks: Chromium and WebKit both pass cold cached startup while real HTTP sockets remain open, blue Reload, Sheets HTTP 429, park-card interaction, and recovery when service returns. Chromium additionally passes emulated airplane-mode reload.
- Network isolation includes an external-request proxy because WebKit worker requests can bypass page-level test routing. This prevents successful live catalog refreshes from invalidating the saved-catalog outage fixture.
- Both engines show the early recovery message if a first-visit startup script stalls, and Retry works after service returns.
- Existing tests pass for pending visit add/delete journals across reload, map identity, loader coverage in portrait/landscape, cold catalog fallback, installed offline shell, and cached high-zoom tiles.
- Phone viewport inspected at 390 × 844; 393 fallback parks loaded with no horizontal overflow.

These are browser-engine tests, not physical-device tests. Existing installations need a usable connection once to download the complete 0.143 release. An interrupted update leaves the last complete version active. Background imagery remains limited to previously viewed cached tiles; pins use a separate saved catalog.

Vendored dependency source URLs, checksums, and upstream license files are under `01-code/app/vendor/`. Package versions match the existing startup libraries (Turf's existing major-6 URL is pinned to 6.5.0).
