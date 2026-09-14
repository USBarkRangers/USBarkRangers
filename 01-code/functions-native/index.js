'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onCall } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const logger = require('firebase-functions/logger');
const { resolveProject } = require('./runtime/project');
const { createCommandCallable } = require('./runtime/callable');
const { createExecutor } = require('./commands/executor');
const { bootstrapAccount, updateProfile, updateMapStyle } = require('./profile/commands');
const catalog = require('./catalog');
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

const runtime = resolveProject(); // Must pass before Admin constructs any client.
const app = initializeApp({ projectId: runtime.projectID });
const deletion = createDeletionService({ db: getFirestore(app), auth: getAuth(app) });
const execute = createExecutor({ db: getFirestore(app),
    handlers: { bootstrapAccount, updateProfile, updateMapStyle,
        saveTrip: createSaveTrip({ catalog }), saveTripNotes, editNote, deleteTrip, ...createVisitHandlers({ catalog }),
        recordDailyActivity: createDailyActivity({ catalog }),
        assignVirtualRun: createAssignRun({ catalog }), claimVirtualRun: createClaimRun({ catalog }),
        recordActivity: createRecordActivity({ catalog }), ...createActivityEdits({ catalog }) } });

// Conservative development capacity, not the verified 100K-user launch configuration.
// Raise only after measured workloads and the approved spending envelope are reviewed.
exports.nativeCommand = onCall({ region: runtime.region, enforceAppCheck: !runtime.emulator,
    serviceAccount: runtime.emulator ? undefined : 'native-ios-runtime@bark-ranger-ios.iam.gserviceaccount.com',
    minInstances: 0, maxInstances: 2, concurrency: 10, cpu: 1, memory: '256MiB', timeoutSeconds: 30,
}, createCommandCallable({ runtime, execute, reportFailure: detail => logger.error(detail) }));

exports.nativeRead = onCall({ region: runtime.region, enforceAppCheck: !runtime.emulator,
    serviceAccount: runtime.emulator ? undefined : 'native-ios-runtime@bark-ranger-ios.iam.gserviceaccount.com',
    minInstances: 0, maxInstances: 2, concurrency: 10, cpu: 1, memory: '256MiB', timeoutSeconds: 30,
}, createCommandCallable({ runtime, execute: createReadService(getFirestore(app)),
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

// APPLE-ACTIVATION: no purchase endpoint is exported while enrollment/setup are pending.
// Intended additional exports, after real verification/ownership/notification handlers exist:
// exports.verifyApplePurchase = onCall(verifiedPurchaseOptions, verifyApplePurchase);
// exports.appleServerNotification = onRequest(notificationOptions, receiveVerifiedNotification);
// Notification delivery has no Firebase user token: validate Apple's signed payload instead.
// Never substitute the nativeCommand payload for verified Apple transaction evidence.
