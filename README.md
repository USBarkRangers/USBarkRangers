# BarkRangerMap

This repo is organized by importance so the top level stays easy to scan.

1. `01-code/` - the app and Firebase Cloud Functions.
   - `01-code/app/` is the hosted web app.
   - `01-code/functions/` is the Firebase Functions backend.
2. `02-data/` - source CSV, JSON, and trail data used to build or audit the app.
3. `03-tests/` - Node tests, Playwright smoke tests, rules tests, and local auth state.
4. `04-docs/` - plans, audits, reports, and run logs.
5. `05-tools/` - maintenance scripts and helper commands.
6. `06-config/` - Firebase rules and other project config that does not need to live at root.

Root-level files are kept only when common tooling expects them there, such as `package.json`, `firebase.json`, `playwright.config.js`, `.firebaserc`, and `.gitignore`.

Useful commands:

```sh
npm run test:unit
npm run test:functions
npm run test:e2e:smoke
npm run test:rules
```

## Releases & environments

- **Beta**: GitHub Pages (`main`) - <https://usbarkrangers.github.io/USBarkRangers/>
- **Production**: Firebase Hosting - <https://barkrangermap-auth.web.app/>

Both use the same Firebase backend; only the frontend build and version label
differ (beta shows a `-beta` suffix). See [04-docs/RELEASE_FLOW.md](04-docs/RELEASE_FLOW.md)
for the promote-to-production steps and [CHANGELOG.md](CHANGELOG.md) for version history.
