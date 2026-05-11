# GitHub Public Exposure Red Flags

Date: 2026-05-10
Repository: `OutSwarming/bark-ranger-map`
Visibility: public

This is an exposure-risk list, not a legal conclusion.

## P0: Must Resolve Before Broader Public Exposure

| Risk | Evidence | Why It Matters | Suggested Next Action |
|---|---|---|---|
| Public repo contains legal/IP diligence docs | `plans/LEGAL_LICENSE_DILIGENCE_PACKET.md`, `plans/LEGAL_LICENSE_RED_FLAGS.md`, `plans/ASSET_DATA_SOURCE_AUDIT.md`, `plans/THIRD_PARTY_SERVICE_AUDIT.md`, `plans/AI_ASSISTED_DEVELOPMENT_DISCLOSURE_DRAFT.md` are tracked and visible on public branches | These docs contain lawyer-prep questions, trademark concerns, asset/data provenance concerns, and business/payment ownership questions | Make repo private now or move legal docs to a private repo and clean public branches/history with explicit approval |
| `firebase-debug.log` remains in public history and old branches | Current `main` no longer tracks `firebase-debug.log`, but `git log --all -- firebase-debug.log` shows history and several remote branches still contain it | Debug logs should not be public; prior checked copy did not show private key blocks, but it included deploy/debug metadata, project details, private email-like strings, secret names, and signed URL style data | Delete stale public branches after merge check; decide separately whether history cleanup/rotation is needed |
| Internal launch/payment/QC reports are public | `plans/FINAL_PRIVATE_BETA_QC_REPORT.md`, `plans/FINAL_PRIVATE_BETA_QC_TRACKER.md`, `plans/LAUNCH_READINESS_FIREBASE_COST_REPORT.md`, `plans/PARTS_1_6_QC_AUDIT.md`, `plans/FAST_FIX_RELEASE_CANDIDATE_PLAN.md` | Public users, partners, admins, or competitors can read internal launch readiness, payment blockers, cost assumptions, and support risks | Keep private; publish only sanitized release notes |
| Unknown-origin brand/data assets are public while legal review is open | `assets/images/*`, `BARK Master List.csv`, `assets/data/bark-fallback.csv`, `data/*.csv`, `data/*.json` | Public exposure can complicate IP/data-rights review if provenance is unresolved | Make repo private until counsel/brand owner confirms rights |

No current-branch tracked service-account JSON, Playwright auth state, live `.env`, or private-key file was found in this audit. If those appear later, treat them as P0.

## P1: Fix Before Broader Beta / Legal Review

| Risk | Evidence | Why It Matters | Suggested Next Action |
|---|---|---|---|
| Generated dependency JSON is public | `plans/root-npm-ls-all.json`, `plans/functions-npm-ls-all.json` | Not secrets, but unnecessary public dependency graph and diligence artifact | Remove from public tracking; regenerate locally when needed |
| Payment architecture and Lemon hardening details are public | `functions/index.js`, `functions/tests/*`, `plans/PHASE_4*.md`, `plans/LEMONSQUEEZY_TEST_MODE_CANCELLATION_QA.md`, `plans/LEMON_COUPON_RUNBOOK.md` | Reveals provider flow, webhook assumptions, and test-mode state | Fine in private repo; if public, keep only sanitized docs |
| Public branches retain old debug log | Several remote hardening branches still contain `firebase-debug.log` | Even if `main` is fixed, public branch browsing can expose old files | Delete stale branches or rewrite/clean them with explicit approval |
| Old branches may have weaker ignore/hosting shielding | Current `main` has stronger `.gitignore` and `firebase.json` ignores, but stale branches predate that cleanup | Future work from old branches could reintroduce exposure | Delete stale branches or avoid using them as bases |
| GitHub Actions artifacts exist | GitHub API returned `30` `github-pages` artifacts | Artifacts/logs in public repos can expose build output/metadata | Verify artifact contents or reduce retention; ensure Pages build excludes internal docs |
| Public code exposes Firebase rules/functions | `firestore.rules`, `functions/index.js`, function tests | Normal for open source, but useful to attackers | Accept only if repo is intentionally public; otherwise make repo private |

## P2: Cleanup / Professionalism

| Risk | Evidence | Why It Matters | Suggested Next Action |
|---|---|---|---|
| Too many internal planning docs in public source | 52 tracked `plans/*.md` files and 4 `docs/audits/*.md` files | Makes the public repo look like an internal workbench, not a polished product repo | Move internal docs private; add a clean public README |
| Old plans may contradict current state | Multiple phase plans and old reports remain public | Partners/users can misread outdated risk statements as current facts | Archive privately or mark public docs clearly |
| No clear public license/notice decision | Legal packet notes no root `LICENSE` / `NOTICE` found | Public repos imply distribution questions; dependencies/assets may need notices | Ask lawyer; add license/notice only after decision |
| Public data and images lack visible provenance | CSVs, GeoJSON, and logo/watermark images are tracked | This is an IP/data-rights diligence issue | Keep private until provenance and attribution are settled |

## Severity Bottom Line

The highest priority is not that a private key was found. The highest priority is that the repo is public while it contains internal legal, trademark, payment, cost, beta, and debug-log material.

Recommended action: **make the repository private first, then clean calmly.**
