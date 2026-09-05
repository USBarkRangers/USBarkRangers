# Earlier saved green visits — beta 0.144

Saved confirmed visits now have an independent one-second startup grace period after the public park catalog becomes available. When cloud identity or visit loading stalls, the existing local recovery functions restore the last confirmed baseline, pending additions, and pending removals together. Normal cloud initialization continues. If a fresh server snapshot arrives first, the delayed restoration is skipped.

This changes startup display timing. It reuses the existing account-scoped baseline and mutation journals without a storage migration, additional network reads/writes, or new sync requests. Pending mutations remain orange and require the existing server proof before confirmation. Early display does not grant Premium access; eligible offline Premium restoration keeps its existing later startup deadline.

The timer checks the remembered account, current Firebase identity, resolved sign-out state, account-chooser state, and fresh snapshot flag before restoration. Sign-out/switch-account clicks cancel it and clear only the remembered account pointer, preserving durable journals. The existing auth callback clears an early projection if another account signs in. A completed timer cannot replay over a later server update.

Validation on September 5, 2026:

- Full unit suite: 468 passed. New cases cover the one-second grace, stalled Firebase, Firebase setup returning before auth, fast server response, same-account cached auth, sign-out, account changes, missing identity, and repeated catalog refresh.
- Mobile Chromium and WebKit checks: saved green restoration measured approximately 1,001–1,003 ms after park data became available, including reload. Pending adds/removals retained their orange marker styles and unchanged durable storage. Later server reconciliation replaced the old baseline, and account cleanup preserved journals.
- Both engines passed real open-socket network stalls with a prepared service-worker cache, cold reopen, blue Reload, Sheets rejection, and recovery. Chromium additionally passed emulated airplane-mode reload with saved green visits. WebKit's emulated-offline navigation does not exercise service workers, so its cold recovery check uses actual stalled sockets instead.
- Installed offline shell, cached high-zoom tiles, durable server-proof smoke test, and first-load stalled-file recovery passed. Nine focused browser cases passed across the selected files.
- Prior published startup assets and Firebase production hosting configuration remain unchanged. Beta uses new immutable HTML, core bootstrap, and cache manifest paths.

Accepted tradeoff: the saved green baseline can briefly reflect older cross-device progress until a newer server snapshot arrives. Devices need a usable connection once to prepare the complete 0.144 shell; an interrupted update retains the previous complete release. Browser timing does not guarantee the same timing on a busy or suspended physical phone. Physical iPhone/Android testing remains necessary before production promotion.
