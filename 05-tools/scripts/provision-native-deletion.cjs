'use strict';

// Exact-project infrastructure for the owner-approved native account deletion lifecycle.
// Provisioning may use the owner login; deployments still run only as native-ios-deployer.
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const auth = require('firebase-tools/lib/auth');
const { Client } = require('firebase-tools/lib/apiv2');
const { assertNativeProject } = require('./check-native-firebase-project.cjs');

async function main() {
    assert.equal(process.argv.length, 3);
    assertNativeProject(process.argv[2]);
    assert.equal(process.cwd(), resolve(__dirname, '../..'));
    assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
    auth.setRefreshToken(auth.getProjectDefaultAccount(process.cwd()).tokens.refresh_token);
    const project = 'bark-ranger-ios';
    const iam = new Client({ urlPrefix: 'https://iam.googleapis.com', auth: true });
    const role = `projects/${project}/roles/nativeAccountEraser`;
    const permissions = ['firebaseauth.users.delete'];
    let existing;
    try { existing = (await iam.get('/v1/' + role)).body; }
    catch (error) { if (error.status !== 404) throw error; }
    if (existing) {
        assert.deepEqual(existing.includedPermissions, permissions, 'Review an existing role instead of broadening it.');
        assert(!existing.deleted);
    } else {
        await iam.post(`/v1/projects/${project}/roles`, { roleId: 'nativeAccountEraser', role: {
            title: 'Native account eraser', description: 'Deletes Firebase Auth identities after authorized native account deletion.',
            includedPermissions: permissions, stage: 'GA',
        } });
    }
    const crm = new Client({ urlPrefix: 'https://cloudresourcemanager.googleapis.com', auth: true });
    const policy = (await crm.post(`/v1/projects/${project}:getIamPolicy`, { options: { requestedPolicyVersion: 3 } })).body;
    for (const [permission, member] of [
        [role, `serviceAccount:native-ios-runtime@${project}.iam.gserviceaccount.com`],
        ['roles/cloudscheduler.admin', `serviceAccount:native-ios-deployer@${project}.iam.gserviceaccount.com`],
    ]) {
        let binding = policy.bindings.find(value => value.role === permission && !value.condition);
        if (!binding) { binding = { role: permission, members: [] }; policy.bindings.push(binding); }
        if (!binding.members.includes(member)) binding.members.push(member);
    }
    // Preserve every existing binding and the concurrency-checking etag.
    await crm.post(`/v1/projects/${project}:setIamPolicy`, { policy });
    const services = new Client({ urlPrefix: 'https://serviceusage.googleapis.com', auth: true });
    const path = '/v1/projects/360077919845/services/cloudscheduler.googleapis.com';
    if ((await services.get(path)).body.state !== 'ENABLED') await services.post(path + ':enable', {});
    console.log('Native deletion permission and scheduler provisioning requested. No old project or account data changed.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
