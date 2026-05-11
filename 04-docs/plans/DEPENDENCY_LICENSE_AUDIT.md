# Dependency License Audit

Date: 2026-05-09
Branch audited: `codex/promo-access-code-premium`
Commit audited: `1699a921928086b5b81e6bb48bee6be0691cfa88`

This audit uses installed package metadata and lockfiles. It is not legal advice.

## Method

Inspected:

- `package.json`
- `package-lock.json`
- `functions/package.json`
- `functions/package-lock.json`
- installed `node_modules/*/package.json` metadata
- installed `functions/node_modules/*/package.json` metadata

Commands:

```bash
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm ls --depth=0
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions ls --depth=0
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm ls --all --json > plans/root-npm-ls-all.json
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions ls --all --json > plans/functions-npm-ls-all.json
```

`license-checker` was not installed and was not added.

Project metadata note: the root `package.json` does not define a clear project license field, and no repo-level `LICENSE` or `NOTICE` file was found outside dependencies.

## Direct Dependency Table

| Package | Version | Direct/transitive | Scope | License field | Repository/homepage | Purpose | Risk | Notes |
|---|---:|---|---|---|---|---|---|---|
| `@firebase/rules-unit-testing` | 4.0.1 | Direct devDependency | root | Apache-2.0 | `firebase/firebase-js-sdk` | Firestore rules tests | Low | Test/dev only. |
| `@google/generative-ai` | 0.24.1 | Direct dependency | root/functions | Apache-2.0 | `google-gemini/generative-ai-js` | Gemini/admin AI-assisted app workflows | Low license, medium privacy/terms | Review API terms and data sent to Gemini. |
| `@playwright/test` | 1.59.1 | Direct devDependency | root | Apache-2.0 | `microsoft/playwright` | E2E/browser testing | Low | Dev/test only. |
| `axios` | 1.15.2 | Direct dependency | root/functions | MIT | `axios/axios` | HTTP requests from functions/tests | Low | Common permissive license. |
| `firebase` | 11.10.0 | Direct devDependency/root browser dependency | root | Apache-2.0 | `firebase/firebase-js-sdk` | Firebase client SDK/tests | Low | Browser also loads Firebase compat SDKs from CDN in `index.html`. |
| `firebase-admin` | 13.8.0 | Direct dependency | root/functions | Apache-2.0 | `firebase/firebase-admin-node` | Cloud Functions/admin Firestore/Auth | Low | Backend service SDK. |
| `firebase-functions` | 7.2.5 | Direct dependency | root/functions | MIT | `firebase/firebase-functions` | Cloud Functions runtime | Low | Backend runtime SDK. |
| `firebase-tools` | 14.26.0 | Direct devDependency | root | MIT | `firebase/firebase-tools` | Emulator/deploy/testing CLI | Low license, medium operational | Dev/deploy tool; Java 21 requirement warning was noted in prior QA. |
| `googleapis` | 171.4.0 | Direct dependency | root/functions | Apache-2.0 | `googleapis/google-api-nodejs-client` | Google Sheets/admin/API integrations | Low license, medium privacy/terms | Review scopes and data sent to Google APIs. |
| `nock` | 13.5.6 | Direct devDependency | root | MIT | `nock/nock` | HTTP mocking in tests | Low | Dev/test only. |

## Full Tree Summary

| Scope | Packages in tree | Low | Medium | High | Unknown |
|---|---:|---:|---:|---:|---:|
| Root | 766 | 762 | 2 | 1 | 1 |
| Functions | 247 | 246 | 0 | 1 | 0 |

Common low-risk license families found:

- MIT
- Apache-2.0
- ISC
- BSD-2-Clause
- BSD-3-Clause
- BlueOak-1.0.0
- CC0-1.0

## Flagged Transitive Packages

| Package | Version | Scope | License field | Repository/homepage | Risk | Notes |
|---|---:|---|---|---|---|---|
| `node-forge` | 1.4.0 | root/functions transitive | `(BSD-3-Clause OR GPL-2.0)` | `digitalbazaar/forge` | High review | Dual-license includes GPL option. Confirm permissive BSD-3-Clause election and notices. |
| `valid-url` | 1.0.9 | root transitive | `UNKNOWN` | `git://github.com/ogt/valid-url.git` | Unknown | Installed metadata did not provide a clear license. Inspect upstream before public release. |
| package with `BSD` metadata | transitive | root | `BSD` | varies | Medium | Nonstandard SPDX string; normalize in notices. |
| package with `public domain` metadata | transitive | root | `public domain` | varies | Medium | Nonstandard notice category; review if included in distributed tooling. |
| `config-chain` | 1.1.13 | root transitive | license object referencing MIT | `dominictarr/config-chain` | Low/medium metadata | License is MIT-like, but metadata is object-shaped and should be normalized in generated notices. |

## Browser/CDN Dependencies Not Captured By NPM

These are loaded directly at runtime and should be license/terms reviewed separately:

| Library/service | Evidence | Notes |
|---|---|---|
| Leaflet 1.9.4 | `index.html` unpkg CSS/JS | Map library; attribution/terms also depend on tile provider. |
| Leaflet.markercluster 1.5.3 | `index.html` unpkg CSS/JS | Marker clustering plugin. |
| Turf 6 | `index.html` jsDelivr | Geospatial utilities. |
| qrcodejs 1.0.0 | `index.html` cdnjs | QR rendering. |
| PapaParse 5.4.1 | `index.html` cdnjs | CSV parsing. |
| html2canvas 1.4.1 | `modules/shareEngine.js` cdnjs | Share image capture. |
| Firebase compat SDK 9.22.2 | `index.html` gstatic | Auth/Firestore/Functions client SDK. |
| Google Fonts Inter | `index.html` fonts.googleapis.com | Font and third-party request/privacy review. |

## Required Follow-Up

1. Generate a formal third-party notices file before public launch.
2. Confirm `node-forge` BSD-3-Clause use and notice requirements.
3. Resolve `valid-url` unknown license.
4. Decide whether CDN libraries should be pinned with SRI or bundled locally.
5. Add a repo-level proprietary/license notice if counsel recommends it.
