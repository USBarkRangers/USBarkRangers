# Project boundaries

This repository owns Bark Ranger. Existing production remains `barkrangermap-auth`. On September 13, 2026 the owner approved the isolated iOS rebuild project `bark-ranger-ios`; it is not yet an accepted production replacement. Read `04-docs/FIREBASE_PROJECT_OWNERSHIP.md` before infrastructure or deployment changes. The root `firebase.json` and its guard remain restricted to existing production. Native rebuild deployments must use `firebase.native.json`, its separate exact-target guard, and explicit `--project bark-ranger-ios`. Never broaden either guard to permit both configurations against both projects.

Just Dee Dee Music belongs to its separate repository and Firebase project `just-dee-dee-music-map`. Never add or deploy JDDM functions from this repository, or point Bark code at JDDM resources. Preserve explicit project-check predeploy hooks for functions, hosting and Firestore rules.

Old JDDM resources retained temporarily in Bark are migration rollback artifacts, not Bark services. Follow the migration retirement gate before deleting them. Never delete Bark's ORS key, users, payments, support functions or rules as JDDM cleanup. Preserve unrelated user changes in the working tree.
