# GitHub Public Exposure Audit

Date: 2026-05-10
Scope: public GitHub and Firebase Hosting exposure cleanup audit. No app behavior or payment behavior changed.
Repository audited: `OutSwarming/bark-ranger-map`
Local branch audited: `main`
Local base commit audited: `e7c9cf34b5915311c33cf25ae86b0b46d455df08`

## 1. Executive Summary

Result: **NEEDS CARTER DECISION** for public GitHub visibility. **PASS** for current Firebase Hosting internal-doc shielding after this cleanup.

The GitHub repository is public. Firebase Hosting is much safer than the GitHub source tree because `firebase.json` ignores internal docs, tests, functions, logs, hidden files, and generated artifacts. However, anything tracked in GitHub remains public even when it is not hosted on the website.

Current high-level findings:

1. GitHub API reports `OutSwarming/bark-ranger-map` is **public**, default branch `main`, with Pages enabled.
2. Current `main` no longer tracks `firebase-debug.log` or `firestore-debug.log`.
3. Current `main` sensitive-file path scan found only `.env.example`, which is expected.
4. Current `main` still tracks internal planning, legal, QC, payment, codebase, and launch reports under `plans/` and root markdown files.
5. Firebase Hosting now explicitly ignores `plans/**`, `docs/**`, `**/*.md`, `functions/**`, `tests/**`, `playwright/**`, `test-results/**`, `playwright-report/**`, logs, `.env*`, and node modules.
6. Historical git paths still include `firebase-debug.log` and internal legal/QC docs. No history rewrite was performed.
7. Public remote branches still expose older `firebase-debug.log` copies and/or internal hardening docs.
8. Broad secret scans found public Firebase web config/API-key-looking config, dummy emulator keys in scripts/docs, secret names/placeholders, and provider/webhook implementation references. The scan did not find tracked service-account JSON, private key files, Playwright auth states, or live `.env` files on current `main`.
9. No raw production coupon/access-code list was found. Only placeholder/example coupon strings and disabled legacy access-code test fixtures were found.
10. Best recommendation remains: **make the repo private before broader beta/legal review**, or split later into a sanitized public repo plus private internal repo.

## 2. Repo Visibility

GitHub API evidence:

| Field | Result |
|---|---|
| Repository | `OutSwarming/bark-ranger-map` |
| URL | `https://github.com/OutSwarming/bark-ranger-map` |
| Visibility | `public` |
| Private? | `false` |
| Default branch | `main` |
| GitHub Pages enabled | `true` |

Local remote:

```bash
origin https://github.com/OutSwarming/bark-ranger-map.git
```

`gh` CLI was not available, so GitHub metadata checks used local git plus the public GitHub API.

## 3. Branch / PR Exposure Summary

Local and remote branches visible during this audit:

- `main`
- `codex/e2e-storage-states-qc`
- `codex/fix-bug017-premium-gating-smoke`
- `codex/payment-webhook-hardening-test-mode`
- `codex/promo-access-code-premium`
- `codex/server-free-visit-limit-5`
- `codex/server-route-geocode-rate-limits`
- `codex/stage-0-hardening-kill-switches`
- `phase-1-vaultrepo-refactor`
- `zoom-fix-revisited`

GitHub API returned one PR:

| PR | State | Branch | Exposure note |
|---|---|---|---|
| `#1` | closed | `phase-1-vaultrepo-refactor -> main` | Closed PR metadata/diff remains visible in a public repo. |

Remote branch path check:

| Branch | Sensitive/internal items found |
|---|---|
| `main` | hardening docs, codebase reports, final QC reports, legal red flags, generated npm JSON |
| `codex/promo-access-code-premium` | same internal docs plus legal/QC/codebase reports |
| `codex/e2e-storage-states-qc` | `firebase-debug.log`, hardening/launch docs |
| `codex/fix-bug017-premium-gating-smoke` | `firebase-debug.log`, hardening/launch docs |
| `codex/payment-webhook-hardening-test-mode` | `firebase-debug.log`, hardening/launch docs |
| `codex/server-free-visit-limit-5` | `firebase-debug.log`, hardening/launch docs |
| `codex/server-route-geocode-rate-limits` | `firebase-debug.log`, hardening/launch docs |
| `codex/stage-0-hardening-kill-switches` | `firebase-debug.log`, hardening/launch docs |
| `phase-1-vaultrepo-refactor` | `firebase-debug.log` |
| `zoom-fix-revisited` | `firebase-debug.log` |

## 4. Public Tracked-File Summary

Generated inventories:

- `plans/github-tracked-files.txt`
- `plans/github-all-history-filepaths.txt`

Current `main` tracked-file path scan for debug/auth/secret-like artifacts returned:

- `.env.example`

That is expected. No tracked debug logs, Playwright auth storage states, service-account JSON files, live `.env` files, test result folders, or private-key JSON files were found on current `main`.

Current `main` still tracks internal report categories:

- legal/IP diligence reports
- final private-beta QC reports
- codebase structure/launch risk reports
- launch readiness and cost reports
- Lemon/payment hardening reports
- generated npm dependency JSON
- root internal markdown such as `HARDENING_PROGRESS.md`, `CODE_AUDIT_REPORT.md`, and `ACTION_TRACKER.md`

Root internal markdown was not moved during this cleanup because Firebase Hosting already ignores `**/*.md`; moving those files to `plans/` would not reduce public GitHub exposure and could break existing references. The real fix for public GitHub exposure is repo visibility or a sanitized public branch.

## 5. RED / YELLOW / GREEN Exposure List

### RED: should not remain public unless Carter intentionally accepts the risk

| Path / pattern | Why risky |
|---|---|
| `plans/LEGAL_LICENSE_DILIGENCE_PACKET.md` | Internal legal/IP/trademark/payment diligence. |
| `plans/LEGAL_LICENSE_RED_FLAGS.md` | Ranked legal/IP/trademark/payment red flags. |
| `plans/AI_ASSISTED_DEVELOPMENT_DISCLOSURE_DRAFT.md` | Lawyer-prep disclosure draft. |
| `plans/ASSET_DATA_SOURCE_AUDIT.md` | Asset/data provenance uncertainty. |
| `plans/THIRD_PARTY_SERVICE_AUDIT.md` | Privacy/service-risk questions. |
| `plans/FINAL_PRIVATE_BETA_QC_REPORT.md` and tracker | Internal launch QA and remaining risks. |
| `plans/LAUNCH_READINESS_FIREBASE_COST_REPORT.md` | Internal cost/payment/risk register details. |
| `plans/root-npm-ls-all.json`, `plans/functions-npm-ls-all.json` | Generated dependency trees; not secrets, but unnecessary public attack surface. |
| Old public branches with `firebase-debug.log` | Debug/deploy metadata remains visible on those branch tips and in history. |

### YELLOW: okay in private repo; not ideal in public repo

| Path / pattern | Why watch |
|---|---|
| `HARDENING_PROGRESS.md` | Internal security/payment hardening status. |
| `plans/PHASE_4*.md` | Payment, webhook, entitlement, and deploy-gate implementation detail. |
| `plans/PREMIUM_*`, `plans/PRODUCTION_AUDIT_REPORT.md` | Internal beta/product-readiness notes. |
| `plans/CODEBASE_*` | Architecture and maintainability risks. |
| `docs/audits/*.md` | Internal technical audit history. |
| `tests/**`, `functions/tests/**` | Reveals test fixtures and app internals. Fine for intentional open source, noisy otherwise. |
| `firebase.json`, `firestore.rules`, Functions source | Normal for public code, but reveals security rules and callable surfaces. |

### GREEN: generally okay if Carter intentionally wants open source

| Path / pattern | Notes |
|---|---|
| `index.html`, `styles.css`, app modules/services/renderers/repos | App source code. Public only if open-source/source-visible is intentional. |
| `assets/data/bark-fallback.csv` | Public fallback data, assuming data rights are cleared. |
| `assets/images/*` | App imagery, assuming brand/asset rights are cleared. |
| `manifest.json`, `version.json` | Normal public app metadata. |
| package manifests/lockfiles | Normal source metadata, though they help dependency analysis. |

## 6. Secret Scan Summary

Raw scan output was kept outside the repo in `/tmp` and was not committed.

Commands used broad patterns, so matches include harmless strings such as `webhook`, `token`, `apiKey`, `password`, `secret`, and provider names.

Summary:

| Finding type | Assessment |
|---|---|
| Firebase web API-key-looking config | Present in client config. This is normal Firebase web config, not a server secret, but it is public if the repo is public. |
| Dummy emulator keys | Present in scripts/docs as `emulator-test-key` examples. Not production secrets. |
| Secret/env var names | Present in Functions code, tests, and docs. Names are not values, but public implementation detail. |
| Private key blocks | Not found on current tracked `main`. |
| Service-account JSON | Not tracked on current `main`. |
| Playwright auth states/storage states | Not tracked on current `main`. |
| Live `.env` files | Not tracked on current `main`. |
| Raw production coupon/access-code list | Not found. Placeholder/example/test values exist. |

No secret values are printed in this report.

## 7. Docs / Plans Exposure Summary

The repo still tracks many internal documents. Firebase Hosting does not serve them, but GitHub does expose them while the repo is public.

High-risk doc groups:

- legal/IP/trademark diligence
- payment and Lemon Squeezy hardening notes
- private beta QC reports
- cost modeling and launch readiness
- codebase/security risk registers
- generated npm dependency JSON

Recommended handling:

1. Make the repo private now, or
2. Move internal docs to a private repo and remove them from public tracking, then
3. Optionally create a public-safe README/NOTICE/privacy/attribution doc set later.

## 8. Data / Asset Exposure Summary

| Path | Risk |
|---|---|
| `BARK Master List.csv` | Public dataset exposure; source/permission should be cleared. |
| `assets/data/bark-fallback.csv` | Used by public app; okay only if data rights are clear. |
| `data/*.csv`, `data/*.json`, `data/*.geojson`, `trails.json`, `raw_trails/**` | Internal or source snapshots; public exposure depends on data provenance/terms. |
| `assets/images/*` | Brand/logo/watermark assets; needs brand ownership/permission review. |
| `pages/admin.html`, `pages/admin.js` | Admin UI code is public source; verify server-side auth remains authoritative. |

## 9. Git History Risk Summary

Historical file path inventory still includes:

- `firebase-debug.log`
- legal/IP diligence reports
- generated npm dependency JSON
- internal QC/codebase reports

History cleanup was not performed. If the repo remains public, Carter should decide later whether to:

1. make the repo private and leave history alone,
2. remove stale public branches,
3. rewrite history with BFG or `git filter-repo`,
4. rotate conservatively if any reviewed historical logs are concerning.

This cleanup did not print or commit any secret values.

## 10. .gitignore / Firebase Hosting Ignore Status

`.gitignore` now explicitly covers:

- `firebase-debug.log`
- `firestore-debug.log`
- `*.log`
- `.env`
- `.env.*`
- `!.env.example`
- `playwright/.auth/`
- `tests/.auth/`
- `test-results/`
- `playwright-report/`
- `*.storageState.json`
- `storageState*.json`
- service-account JSON naming patterns
- private-key JSON naming patterns

`firebase.json` Hosting ignore now explicitly covers:

- `plans/**`
- `docs/**`
- `**/*.md`
- `functions/**`
- `tests/**`
- `playwright/**`
- `test-results/**`
- `playwright-report/**`
- `data/**`
- `raw_trails/**`
- `scripts/**`
- `legacy/**`
- `node_modules/**`
- `**/node_modules/**`
- logs
- `.env*`
- hidden files/directories
- service-account JSON naming patterns

Current Hosting exposure status: **PASS** for the requested internal docs/logs/test/function shielding.

## 11. Recommended Immediate Cleanup

1. Make the GitHub repo private before broader beta/legal review.
2. Delete stale public branches that still contain `firebase-debug.log` after confirming they are merged or no longer needed.
3. Keep the stronger `.gitignore` and `firebase.json` ignore rules from this cleanup.
4. Decide whether generated dependency JSON and legal/QC reports should stay tracked at all.
5. Decide later whether history rewrite/secret rotation is needed. Do not do it casually.

## 12. Recommended GitHub Visibility Decision

Recommendation: **B. Make repo private until launch/legal issues are resolved.**

Reason:

- The app is not just source code; it includes legal, payment, launch, and risk planning docs.
- Stale public branches still expose debug logs.
- Trademark/data-source questions are unresolved.
- A public repo makes internal beta readiness and payment risk notes easy for customers, partners, or bad actors to read.

Later, Carter can split into:

- private internal repo for development, tests, docs, and legal/QC reports,
- public sanitized repo or branch if open-source/source-visible release is desired.

## 13. Exact Commands Run

```bash
git status --short
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD
git remote -v
git branch -a --no-color
curl -sS https://api.github.com/repos/OutSwarming/bark-ranger-map
curl -sS "https://api.github.com/repos/OutSwarming/bark-ranger-map/pulls?state=all&per_page=50"
git ls-files
git ls-files > plans/github-tracked-files.txt
git log --all --name-only --pretty=format: | sort -u > plans/github-all-history-filepaths.txt
git ls-files | rg "firebase-debug|firestore-debug|\\.log$|\\.env|playwright/.auth|storageState|serviceAccount|secret|private|key.*\\.json"
git ls-files | rg "LEGAL|DILIGENCE|QC|CODEBASE|REPORT|TRACKER|ROADMAP|RUNBOOK|\\.md$|\\.json$"
git ls-files | rg "(^|/)(firebase-debug|firestore-debug|.*\\.log$|\\.env$|\\.env\\.|serviceAccount|service-account|service_account|private.*key|.*key.*\\.json$|playwright/\\.auth|storageState|test-results|playwright-report)"
git log --all --oneline -- firebase-debug.log firestore-debug.log "*.log"
rg -n "AIza|LEMON|LEMONSQUEEZY|ORS_API_KEY|GEMINI_API_KEY|GOOGLE_MAPS_API_KEY|PRIVATE KEY|BEGIN PRIVATE KEY|api[_-]?key|secret|webhook|token|password|bearer|authorization|customer_portal|subscription_id|firebase-debug|serviceAccount|client_email|private_key"
rg -n "/Users/|carterswarm|privaterelay|gmail.com|phone|address|refund|chargeback|lawyer|trademark|USBARKRANGERS|legal|diligence|merchant|tax|EIN|bank|routing|payout"
sed -n "1,240p" firebase.json
sed -n "1,240p" .gitignore
git diff --check
rg -n "^(<<<<<<<|=======|>>>>>>>)" --glob "!node_modules/**" --glob "!functions/node_modules/**"
python3 - <<'PY'
import json
with open('firebase.json') as f:
    data=json.load(f)
ignore=data.get('hosting',{}).get('ignore',[])
required=['plans/**','**/*.md','tests/**','functions/**','test-results/**','playwright/**','playwright-report/**','*.log','.env*','node_modules/**']
print([p for p in required if p not in ignore])
PY
PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" npm --prefix functions test
```

## 14. Cleanup Check Results

| Check | Result |
|---|---|
| `git diff --check` | PASS |
| Conflict marker search | PASS, no markers found |
| Tracked sensitive-file path scan | PASS, only `.env.example` matched |
| `firebase.json` JSON parse | PASS |
| Required Hosting ignore patterns | PASS, none missing |
| `npm --prefix functions test` | PASS, 107/107 tests |
| Firestore rules suite | Not run; `firestore.rules` was not changed |
