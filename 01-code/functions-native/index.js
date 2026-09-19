'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall, onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { resolveProject } = require('./runtime/project');
const { createCommandCallable } = require('./runtime/callable');
const { createExecutor } = require('./commands/executor');
const { bootstrapAccount, updateProfile, updateMapStyle } = require('./profile/commands');
const catalog = require('./catalog');
const { createCatalogRefresher, officialPlaceIDs } = require('./catalog/remote');
const { createSaveTrip } = require('./trips/save');
const { editNote } = require('./trips/editNote');
const { saveTripNotes } = require('./trips/saveNotes');
const { deleteTrip } = require('./trips/delete');
const { createReadService } = require('./reads/service');
const { createVisitHandlers } = require('./visits/commands');
const { createDailyActivity } = require('./progress/activity');
const { createAssignRun } = require('./expeditions/assign');
const { createClaimRun } = require('./expeditions/claim');
const { createRecordActivity } = require('./activities/create');
const { createActivityEdits } = require('./activities/edit');
const { createDeletionService } = require('./accounts/deletion');
const { setSavedPin } = require('./places/bookmarks');
const { purchaseRuntime, notificationHandler } = require('./purchases/runtime');

const runtime = resolveProject(); // Must pass before Admin constructs any client.
const app = initializeApp({ projectId: runtime.projectID });
const deletion = createDeletionService({ db: getFirestore(app), auth: getAuth(app) });
const execute = createExecutor({ db: getFirestore(app),
    handlers: { bootstrapAccount, updateProfile, updateMapStyle, setSavedPin,
        saveTrip: createSaveTrip({ catalog }), saveTripNotes, editNote, deleteTrip, ...createVisitHandlers({ catalog }),
        recordDailyActivity: createDailyActivity({ catalog }),
        assignVirtualRun: createAssignRun({ catalog }), claimVirtualRun: createClaimRun({ catalog }),
        recordActivity: createRecordActivity({ catalog }), ...createActivityEdits({ catalog }) } });

// The park catalog follows the sheet publisher, so a park added to the sheet can be marked
// visited without redeploying this backend. The published catalog is public data; the bundled
// copy remains the floor. Off in the emulator and when BARK_NATIVE_LIVE_CATALOG=off.
const liveCatalog = runtime.emulator || process.env.BARK_NATIVE_LIVE_CATALOG === 'off' ? null
    : createCatalogRefresher({ catalog, report: detail => logger.info(detail),
        manifestURL: process.env.BARK_NATIVE_CATALOG_MANIFEST_URL
            || 'https://storage.googleapis.com/barkrangermap-auth-native-catalog/native-catalog/v1/manifest.json' });
// Runs before the command or read, never inside its transaction, and can never fail it.
const withCurrentCatalog = work => async (uid, input, context) => {
    if (liveCatalog) {
        await liveCatalog.ifStale();
        await liveCatalog.forUnknown(officialPlaceIDs(input));
    }
    return work(uid, input, context);
};

// Conservative development capacity, not the verified 100K-user launch configuration.
// Raise only after measured workloads and the approved spending envelope are reviewed.
exports.nativeCommand = onCall({ region: runtime.region, enforceAppCheck: !runtime.emulator,
    serviceAccount: runtime.emulator ? undefined : 'native-ios-runtime@bark-ranger-ios.iam.gserviceaccount.com',
    minInstances: 0, maxInstances: 2, concurrency: 10, cpu: 1, memory: '256MiB', timeoutSeconds: 30,
}, createCommandCallable({ runtime, execute: withCurrentCatalog(execute), reportFailure: detail => logger.error(detail) }));

exports.nativeRead = onCall({ region: runtime.region, enforceAppCheck: !runtime.emulator,
    serviceAccount: runtime.emulator ? undefined : 'native-ios-runtime@bark-ranger-ios.iam.gserviceaccount.com',
    minInstances: 0, maxInstances: 2, concurrency: 10, cpu: 1, memory: '256MiB', timeoutSeconds: 30,
}, createCommandCallable({ runtime, execute: withCurrentCatalog(createReadService(getFirestore(app))),
    reportFailure: () => logger.error({ event: 'native-read-failed', reason: 'internal' }) }));

exports.nativeDeleteAccount = onCall({ region: runtime.region, enforceAppCheck: !runtime.emulator,
    serviceAccount: runtime.emulator ? undefined : 'native-ios-runtime@bark-ranger-ios.iam.gserviceaccount.com',
    minInstances: 0, maxInstances: 2, concurrency: 10, cpu: 1, memory: '256MiB', timeoutSeconds: 30,
}, createCommandCallable({ runtime, execute: deletion.request,
    reportFailure: () => logger.error({ event: 'native-deletion-request-failed' }) }));

// At most twenty queued accounts per invocation; bounded memory, retryable owner-root deletion.
// Pending requests persist without TTL until every cleanup step succeeds.
exports.nativeAccountCleanup = onSchedule({ region: runtime.region, schedule: 'every 15 minutes',
    serviceAccount: runtime.emulator ? undefined : 'native-ios-runtime@bark-ranger-ios.iam.gserviceaccount.com',
    minInstances: 0, maxInstances: 1, concurrency: 1, cpu: 1, memory: '256MiB', timeoutSeconds: 540,
}, async () => {
    try {
        const deadline = Date.now() + 7 * 60_000;
        for (let i = 0; i < 20 && Date.now() < deadline; i++) {
            if (!await deletion.runNext()) break;
        }
    }
    catch { logger.error({ event: 'native-account-cleanup-failed' }); throw new Error('Native cleanup will retry.'); }
});

const appleCredential = defineSecret('NATIVE_APPLE_IAP_CREDENTIAL');
const purchases = purchaseRuntime(getFirestore(app), () => appleCredential.value());
const purchaseOptions = { region: runtime.region,
    serviceAccount: runtime.emulator ? undefined : 'native-ios-runtime@bark-ranger-ios.iam.gserviceaccount.com',
    secrets: [appleCredential], minInstances: 0, maxInstances: 2, concurrency: 10,
    cpu: 1, memory: '256MiB', timeoutSeconds: 60 };
exports.nativePurchase = onCall({ ...purchaseOptions, enforceAppCheck: !runtime.emulator },
    createCommandCallable({ runtime, execute: (...args) => purchases().execute(...args),
        reportFailure: () => logger.error({ event: 'native-apple-purchase-failed' }) }));
// Apple has no Firebase token. Its cryptographically verified JWS is mandatory instead.
exports.nativeAppleNotification = onRequest(purchaseOptions,
    notificationHandler(purchases, detail => logger.error(detail)));
