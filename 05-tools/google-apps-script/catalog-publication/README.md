# Native catalog edit signals

This source is **not installed**. It does not create triggers, change the spreadsheet, or deploy a function. The existing admin and web catalog flows remain available.

`catalogEdited(event)` accepts edits only in the configured spreadsheet/tab, records pending work and asks `flushCatalogSignal()` to send a signed timestamp/nonce. The latter holds a short script lock, debounces requests for ten seconds and retains pending work on failures or busy publications. An edit arriving during a request is not cleared by the older acknowledgement. No park rows or private cell contents are sent in the signal.

Eventual setup requires separate authorization: deploy the native publisher in `barkrangermap-auth`, configure its public asset location, create the shared signing secret, add this source as a bound script and configure these Script Properties:

| Property | Value |
|---|---|
| `BARK_SHEET_ID` | The approved Bark spreadsheet's ID. |
| `BARK_SHEET_NAME` | Exact approved catalog tab name. |
| `BARK_SIGNAL_URL` | The deployed Bark `nativeCatalogEditSignal` HTTPS endpoint. |
| `BARK_SIGNAL_SECRET` | Same value as the function's `BARK_CATALOG_EDIT_SECRET`; never commit it. |

Then install an **on-edit** trigger for `catalogEdited` and a **one-minute** trigger for `flushCatalogSignal`. Script/API/formula changes may not emit edit events: accepted admin API writes call the same publisher directly, and the backend's six-hour reconciliation covers missed events. Coalesced/failed edits can take longer than a direct edit; publishing within seconds is a target under healthy conditions, not a guarantee for Sheets, cellular service or arbitrary background execution.

Run local tests (no Apps Script account or network delivery):

```sh
NODE_ENV=test node --test 01-code/functions/tests/catalog-publication-script.test.js
```

See the [publication runbook](../../../04-docs/operations/NATIVE_CATALOG_PUBLICATION.md) before configuring any live resource.
