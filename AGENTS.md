# Project boundaries

This repository owns Bark Ranger. Its only production Firebase project is `barkrangermap-auth`. Read `04-docs/FIREBASE_PROJECT_OWNERSHIP.md` before infrastructure or deployment changes.

Just Dee Dee Music belongs to its separate repository and Firebase project `just-dee-dee-music-map`. Never add or deploy JDDM functions from this repository, or point Bark code at JDDM resources. Preserve explicit project-check predeploy hooks for functions, hosting and Firestore rules.

Old JDDM resources retained temporarily in Bark are migration rollback artifacts, not Bark services. Follow the migration retirement gate before deleting them. Never delete Bark's ORS key, users, payments, support functions or rules as JDDM cleanup. Preserve unrelated user changes in the working tree.
