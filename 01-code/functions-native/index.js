'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { onCall } = require('firebase-functions/v2/https');
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

const runtime = resolveProject(); // Must pass before Admin constructs any client.
const app = initializeApp({ projectId: runtime.projectID });
const execute = createExecutor({ db: getFirestore(app),
    handlers: { bootstrapAccount, updateProfile, updateMapStyle,
        saveTrip: createSaveTrip({ catalog }), saveTripNotes, editNote, deleteTrip, ...createVisitHandlers({ catalog }),
        recordDailyActivity: createDailyActivity({ catalog }),
        assignVirtualRun: createAssignRun({ catalog }), claimVirtualRun: createClaimRun({ catalog }),
        recordActivity: createRecordActivity({ catalog }), ...createActivityEdits({ catalog }) } });

// Conservative development capacity, not the verified 100K-user launch configuration.
// Raise only after measured workloads and the approved spending envelope are reviewed.
exports.nativeCommand = onCall({ region: runtime.region, enforceAppCheck: !runtime.emulator,
    minInstances: 0, maxInstances: 2, concurrency: 10, cpu: 1, memory: '256MiB', timeoutSeconds: 30,
}, createCommandCallable({ runtime, execute, reportFailure: detail => logger.error(detail) }));

exports.nativeRead = onCall({ region: runtime.region, enforceAppCheck: !runtime.emulator,
    minInstances: 0, maxInstances: 2, concurrency: 10, cpu: 1, memory: '256MiB', timeoutSeconds: 30,
}, createCommandCallable({ runtime, execute: createReadService(getFirestore(app)),
    reportFailure: () => logger.error({ event: 'native-read-failed', reason: 'internal' }) }));

// APPLE-ACTIVATION: no purchase endpoint is exported while enrollment/setup are pending.
// Intended additional exports, after real verification/ownership/notification handlers exist:
// exports.verifyApplePurchase = onCall(verifiedPurchaseOptions, verifyApplePurchase);
// exports.appleServerNotification = onRequest(notificationOptions, receiveVerifiedNotification);
// Notification delivery has no Firebase user token: validate Apple's signed payload instead.
// Never substitute the nativeCommand payload for verified Apple transaction evidence.
