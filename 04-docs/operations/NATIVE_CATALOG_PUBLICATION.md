# Native catalog publication runbook

Phase 2 implements and locally tests this pipeline; **no functions, bucket permissions, spreadsheet triggers or live configuration have been deployed**. Bark's sole production project remains `barkrangermap-auth`. Read [ownership](../FIREBASE_PROJECT_OWNERSHIP.md) first. User transfer and production rollout are separate later work.

## Contract and ownership

- `sourceSheet.js`: a single authenticated read of approved rows. Case-insensitive header aliases share the same normalization as the reproducible CSV bundle build. Row data remains server-side until reduced to the explicitly allowed public fields.
- `catalogSchema.js`: all canonical display fields, exact string IDs, explicit aliases, physical-site identity, coordinate bounds, category/swag precedence, state/territory codes, HTTP(S) links and cumulative retirement history. Empty cells do not imply false fees or permissions. The current source's `Missippi`/`Virignia` spellings are preserved for display and recognized as MS/VA codes.
- `publishCatalog.js`: coalesce in-process requests; acquire a 120-second Firestore lease; capture the accepted pointer and source; validate; write immutable bytes; compare-and-swap the manifest using its exact storage generation. Failure, stale ownership or a concurrent promotion retains the accepted pointer. Orphan immutable payloads do not affect clients.
- `catalogTriggers.js`: HMAC/timestamp/replay validation, admin authorization, disabled-by-default configuration, source read adapter and six-hour reconciliation. No phone calls these functions for ordinary refreshes.
- Existing `syncToSpreadsheet`: after a successful update/append, call `afterAcceptedSheetWrite`. A publication failure returns pending internally without changing the already successful admin write result, preventing duplicate appends.
- Separate Apps Script: direct edit signals plus bounded retry; no live trigger installation in phase 2.

The existing CSV endpoint, `catalogSnapshot` function and weekly Firestore fallback retain their existing owners and schedules. The native publisher does **not** add a second writer to the old fallback. No old function exports, ORS, authentication, payment or support paths are removed.

## Wire format

The v1 manifest contains `schemaVersion`, positive integer `revision`, ISO `publishedAt`, source content SHA-256 `sourceRevision`, `count`, `bytes`, byte SHA-256 `sha256` and a relative `revisions/<revision>-<sha256>.json` path. The payload contains matching metadata, `parks` and cumulative `retiredParkIDs`. Payloads are limited to 12 MiB; manifests to 16 KiB; accepted full catalogs contain at least 300 records. All 393 bundled IDs are preserved. The number of displayed active parks is derived, never fixed at 399.

`siteID` uses an explicit source Site ID when supplied; current unique rows default to their stable Park ID. A repeated named physical location must use one shared Site ID. Identity changes require explicit pipe-separated `Park ID Aliases`/`Aliases`; removed rows must remain as `Retired=true` records or appear in explicitly reviewed cumulative retirement metadata. The ordinary sheet publisher retains prior retirement metadata and rejects silent deletion. No automatic migration or coordinate-derived replacement IDs exist.

Any disappearance of an existing identity is rejected unless declared through aliases/retirement, even when the change is below the old 10% shrink threshold. Unchanged source content does not create a new revision or object. Revisions are monotonically increasing publisher milliseconds, advanced beyond the prior revision when clocks tie.

Objects under `native-catalog/v1/revisions/` have `public,max-age=31536000,immutable`; the pointer has `public,max-age=0,must-revalidate`. A phone makes conditional public-asset GETs with an ETag; only a supported, fully validated accepted response establishes freshness. No per-park Firestore reads or private Sheets API calls occur on the phone.

## Reproduce locally

```sh
npm ci --prefix 01-code/functions --ignore-scripts
node 05-tools/scripts/build-ios-catalog.js
NODE_ENV=test node --test 01-code/functions/tests/native-catalog.test.js 01-code/functions/tests/catalog-publication-script.test.js
node --test 03-tests/firebase-project-isolation.test.cjs
node 05-tools/scripts/serve-ios-catalog.js
```

The fixture server defaults to `http://127.0.0.1:8787/active/manifest.json`, initially unchanged. In Xcode, edit **BarkRanger scheme → Run → Arguments → Environment Variables** and add `BARK_CATALOG_URL` with that URL. Run again. The override is compiled into Debug builds only; it is never a release settings control.

Change the active scenario without restarting the app:

```sh
curl -X POST 'http://127.0.0.1:8787/__scenario?name=valid'
```

Use **Home → Settings → Check for updates**, return from background, or wait for the next eligible foreground check. Direct scenario paths such as `/slow/manifest.json` and `/stalled/manifest.json` let tests run independently. Available cases: `unchanged`, `valid`, `malformed`, `shrunk`, `hash-mismatch`, `stalled`, `slow`, `recovery`, `large` (5,000 records including the original catalog), and `throttled` (60-second Retry-After). Updating `/__scenario` advances the fixture revision so subsequent good updates remain monotonic. A fixed scenario URL represents one fixed revision. Stop the server with **Control-C**; remove the environment variable to return to bundled/saved-only mode. No source data or cloud resource changes occur.

For a physical iPhone on the same trusted local network, explicitly start with `--host 0.0.0.0` and use the Mac's private IPv4 address instead of `127.0.0.1`. Debug permits loopback and RFC1918 HTTP addresses. The iPhone needs local-network permission and valid development signing/trust. Release permits HTTPS only. Do not expose this fixture server to the internet; it contains a scenario switch intended for local tests.

Startup loads the newest valid current/previous/bundled revision, then gives a network decision up to three seconds. A successful update inside that budget is visible when the cover closes. Otherwise saved parks open and a bounded update can finish in the foreground. Unknown/failed connectivity is never labeled fresh. After regular success, automated checks occur at most once per minute; reconnect can try sooner, subject to failure backoff and any server Retry-After. There is no background-fetch entitlement or promise of refresh while iOS suspends the app.

## Eventual live configuration — not performed

1. Review the approved sheet/tab and its complete columns, preserving header aliases and IDs. Validate the latest source against the existing bundle before choosing a first live revision.
2. Provision and verify a **public-catalog-only** asset location owned by `barkrangermap-auth`. Never make a bucket containing personal records publicly readable. Choose the public URL, review cache metadata, source authorization and public object access. A dedicated catalog bucket in the same project may be appropriate; no bucket/project is created by this code.
3. Configure function variables `BARK_NATIVE_CATALOG_ENABLED=true`, `BARK_NATIVE_CATALOG_BUCKET`, `BARK_CATALOG_SHEET_ID`, `BARK_CATALOG_SHEET_RANGE`; add `BARK_CATALOG_EDIT_SECRET` in the same project. The project check rejects a different Firebase project. The source adapter requests read-only Sheets scope.
4. Deploy only the reviewed new handlers and the reviewed admin hook, with explicit project/predeploy checks. Configure Apps Script as described in its README only after the signed endpoint is verified.
5. Verify immutable object delivery before checking/promoting the manifest. Test HMAC rejection, replay, concurrent publication, failed upload, credentials and object ACLs against the actual cloud configuration. Memory fakes exercise these semantics locally but do not prove cloud IAM, generation behavior or trigger registration.
6. Configure the app's `BARK_CATALOG_MANIFEST_URL` through an untracked `Config/Catalog.local.xcconfig` or the final reviewed build configuration. In xcconfig URLs, use `https:/$()/...` to avoid `//` being parsed as a comment. The checked-in endpoint is intentionally empty until provisioning is authorized.

## Rollback

Do not overwrite immutable payloads or simply point to an older numeric revision: already updated phones reject revision downgrades. Select a previously accepted payload from retained storage generations, validate its records against the current identity history, and republish those records as a **new higher revision** through the same publisher/schema/CAS path. Preserve required retired IDs and aliases. The source sheet must then be corrected or publishing paused so reconciliation does not immediately republish the unwanted source. Keep the current accepted manifest generation as the CAS precondition; any conflict requires rereading and reviewing the now-current pointer. No rollback or source modification has been executed in phase 2.

## Platform sources checked September 10, 2026

- [Apple resource timeouts](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/timeoutintervalforresource): the client additionally enforces a monotonic whole-body deadline and streaming byte cap.
- [Apple Maps handoff](https://developer.apple.com/documentation/mapkit/mkmapitem/openmaps%28with%3Alaunchoptions%3A%29) and the installed Xcode 26.6 SDK headers: native routing is handed to Apple Maps; Bark has no directions backend for this phase.
- [Cloud Storage generation preconditions](https://docs.cloud.google.com/storage/docs/request-preconditions) and [caching](https://cloud.google.com/storage/docs/caching): immutable uploads precede conditional pointer promotion.
- [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/): the bundled land outline is public-domain geometry; its exact URL and hash are in the app's attribution resource.
