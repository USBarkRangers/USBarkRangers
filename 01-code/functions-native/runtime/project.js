'use strict';

const PROJECT_ID = 'bark-ranger-ios';
const EMULATOR_PROJECT_ID = 'demo-bark-native';
const REGION = 'us-east1';

function resolveProject(env = process.env) {
    const config = env.FIREBASE_CONFIG ? JSON.parse(env.FIREBASE_CONFIG) : {};
    const ids = [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT, config.projectId].filter(Boolean);
    if (ids.length === 0 || ids.some(id => id !== ids[0])) throw new Error('Native runtime project is missing or inconsistent.');
    const emulator = env.FUNCTIONS_EMULATOR === 'true';
    if (ids[0] !== (emulator ? EMULATOR_PROJECT_ID : PROJECT_ID)) throw new Error('Native runtime refused a non-target project.');
    if (emulator && env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188') {
        throw new Error('Native emulator requires its isolated loopback database.');
    }
    if (!emulator && (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST)) {
        throw new Error('Live native runtime cannot use emulator overrides.');
    }
    return { projectID: ids[0], emulator, region: REGION };
}

module.exports = { resolveProject, PROJECT_ID, EMULATOR_PROJECT_ID, REGION };
