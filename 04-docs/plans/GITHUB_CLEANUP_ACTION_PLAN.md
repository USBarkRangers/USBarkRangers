# GitHub Cleanup Action Plan

Date: 2026-05-10
Repository: `OutSwarming/bark-ranger-map`
Current local branch: `main`

Goal: reduce public GitHub and Firebase Hosting exposure without changing app behavior.

## Status After This Cleanup

Completed in the current working tree:

- Current `main` does not track `firebase-debug.log` or `firestore-debug.log`.
- `.gitignore` explicitly ignores debug logs, `.env` files, Playwright auth states, test reports, service-account JSON naming patterns, and private-key JSON naming patterns.
- `firebase.json` Hosting ignores explicitly cover internal docs, plans, tests, functions, logs, `.env*`, Playwright artifacts, and node modules.
- `plans/github-tracked-files.txt` and `plans/github-all-history-filepaths.txt` were regenerated for audit evidence.
- No history rewrite was performed.
- No app payment behavior changed.

Remaining decisions:

- The GitHub repo is still public.
- Internal legal/QC/payment/codebase docs are still tracked and therefore public on GitHub.
- Old public branches still contain `firebase-debug.log`.
- Git history still contains `firebase-debug.log` and internal docs.

## Immediate Before Broader Beta

### 1. Decide Repo Visibility

Recommended: make the repository private now.

Why:

- Internal legal, launch, payment, QC, and codebase risk docs are tracked.
- Old branches still expose `firebase-debug.log`.
- Data/brand provenance is not legally cleared.
- A public repo is not needed for tester access to the deployed app.

Suggested GitHub UI path:

1. Open `https://github.com/OutSwarming/bark-ranger-map/settings`.
2. Go to `Settings -> General -> Danger Zone`.
3. Change visibility to private.
4. Confirm GitHub Pages behavior after the visibility change.

### 2. Delete Stale Public Branches After Merge Check

Current stale branches with old debug/internal exposure:

```bash
git push origin --delete codex/e2e-storage-states-qc
git push origin --delete codex/fix-bug017-premium-gating-smoke
git push origin --delete codex/payment-webhook-hardening-test-mode
git push origin --delete codex/server-free-visit-limit-5
git push origin --delete codex/server-route-geocode-rate-limits
git push origin --delete codex/stage-0-hardening-kill-switches
git push origin --delete phase-1-vaultrepo-refactor
git push origin --delete zoom-fix-revisited
```

Do this only after Carter confirms those branches are no longer needed. `codex/promo-access-code-premium` was merged to `main`, but it also contains internal docs; delete it too if no longer needed:

```bash
git push origin --delete codex/promo-access-code-premium
```

### 3. Keep Or Remove Internal Docs

If the repo becomes private, keeping `plans/**` tracked is acceptable.

If the repo remains public, remove internal docs from public tracking and keep them in a private repo or local/private branch:

```bash
git rm --cached plans/LEGAL_LICENSE_DILIGENCE_PACKET.md
git rm --cached plans/LEGAL_LICENSE_RED_FLAGS.md
git rm --cached plans/AI_ASSISTED_DEVELOPMENT_DISCLOSURE_DRAFT.md
git rm --cached plans/ASSET_DATA_SOURCE_AUDIT.md
git rm --cached plans/THIRD_PARTY_SERVICE_AUDIT.md
git rm --cached plans/FINAL_PRIVATE_BETA_QC_REPORT.md
git rm --cached plans/FINAL_PRIVATE_BETA_QC_TRACKER.md
git rm --cached plans/root-npm-ls-all.json
git rm --cached plans/functions-npm-ls-all.json
```

Do not run this blindly; it removes files from the public branch index. Make sure Carter has a private copy or private repo first.

### 4. Confirm No Sensitive Local Artifacts Are Tracked

Run:

```bash
git ls-files | rg '(^|/)(firebase-debug|firestore-debug|.*\.log$|\.env$|\.env\.|serviceAccount|service-account|service_account|private.*key|.*key.*\.json$|playwright/\.auth|storageState|test-results|playwright-report)'
```

Expected current output:

```text
.env.example
```

That is expected. Anything else should be investigated before broad release.

### 5. Confirm Firebase Hosting Ignores Internal Files

Run:

```bash
rg -n '"plans/\*\*"|"docs/\*\*"|"\*\*/\*\.md"|"functions/\*\*"|"tests/\*\*"|"playwright/\*\*"|"test-results/\*\*"|"playwright-report/\*\*"|"firebase-debug\.log"|"firestore-debug\.log"|"\.env\*"' firebase.json
```

Expected: all patterns are present.

### 6. Decide Whether History Cleanup Is Needed

Do not rewrite history without explicit Carter approval.

History contains:

- `firebase-debug.log`
- internal legal/QC/payment/codebase docs
- generated npm dependency JSON

If the repo becomes private, history rewrite may be unnecessary.

If the repo stays public, Carter should decide whether to:

1. accept that historical content remains public,
2. rotate any sensitive values conservatively,
3. rewrite history with `git filter-repo` or BFG,
4. force-push and coordinate with any clones/forks.

## Before Paid Public Launch

### 1. Create Public-Safe Project Presentation

Add a clean public-facing set:

- `README.md`
- public support/contact path
- privacy policy link
- terms/refund/subscription language
- attribution/credits page
- deployment notes without secrets

### 2. Make License / Notice Decision

Do not invent a license casually. Decide after legal review:

- private proprietary repo,
- public source-visible but not open-source,
- open-source license,
- third-party notices file.

### 3. Keep Private Docs Out Of Public Source

Private-only docs should include:

- legal diligence
- legal red flags
- internal QC trackers
- payment risk reports
- Firebase cost projections
- private beta notes
- lawyer questions
- debug logs
- generated full dependency JSON

### 4. Verify GitHub Actions Artifacts

If the repo stays public, review and delete old downloadable artifacts if needed.

Useful API check:

```bash
curl -sS "https://api.github.com/repos/OutSwarming/bark-ranger-map/actions/artifacts?per_page=20"
```

### 5. Rotate If Needed

This audit did not find tracked private key blocks or service-account JSON on current `main`.

Conservative rotation/history decisions may still be warranted because old debug logs contained deployment/debug metadata and public branches/history retain them.

## Public-Safe Release Branch Option

Best long-term public model:

1. Keep development and internal docs in a private repo.
2. Create a sanitized public repo or public release branch.
3. Include only intentionally public app source and public docs.
4. Exclude `plans/**`, `docs/audits/**`, debug logs, generated JSON, private test fixtures, legal docs, and internal reports.

## Minimum Cleanup Gate

Before broader beta, pass:

```bash
git status --short
git diff --check
git ls-files | rg '(^|/)(firebase-debug|firestore-debug|.*\.log$|\.env$|\.env\.|serviceAccount|service-account|service_account|private.*key|.*key.*\.json$|playwright/\.auth|storageState|test-results|playwright-report)'
rg -n '"plans/\*\*"|"docs/\*\*"|"\*\*/\*\.md"|"functions/\*\*"|"tests/\*\*"|"playwright/\*\*"|"test-results/\*\*"|"playwright-report/\*\*"|"firebase-debug\.log"|"firestore-debug\.log"|"\.env\*"' firebase.json
```

Expected:

- only `.env.example` from the tracked sensitive-file scan,
- no diff whitespace errors,
- Hosting ignore patterns present.

## Recommended Decision

Best path: **make the repo private now, keep the deployed app public, and revisit a sanitized public repo later.**

Second-best path: keep the repo public only after removing internal docs from public tracking, deleting stale branches, verifying Actions artifacts, and explicitly accepting that public git history already exposed prior content unless rewritten.
