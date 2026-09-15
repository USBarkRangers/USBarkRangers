'use strict';
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { test, after } = require('node:test');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createPurchaseStore } = require('../../purchases/store');
const { createPurchaseService } = require('../../purchases/service');
const policy = require('../../purchases/policy');
const { createExecutor } = require('../../commands/executor');
const { bootstrapAccount } = require('../../profile/commands');
const { meter } = require('../support/meter.cjs');

assert.equal(process.env.GCLOUD_PROJECT, 'demo-bark-native');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
const app = initializeApp({projectId:'demo-bark-native'}, `purchases-${randomUUID()}`);
const db = getFirestore(app, `native-purchase-tests-${randomUUID()}`);
after(async () => { await db.terminate(); await deleteApp(app); });
const signed = 'synthetic-test-only.payload.signature'; // Accepted by injected fixture, never the real JWS verifier.
async function fixture() {
    const uid = `purchase-${randomUUID()}`, user = db.collection('users').doc(uid);
    await createExecutor({db,handlers:{bootstrapAccount}})(uid, {version:1,operationID:randomUUID(),
        createdAtMs:Date.now(),kind:'bootstrapAccount',expectedRevision:0,payload:{}});
    let now = Date.now(), calls = 0, fail = false, barrier;
    const measured = meter(db), store = createPurchaseStore({db:measured.db,clock:() => now});
    const context = await store.context(uid), creationCost = measured.totals();
    const originalID = String(randomInt(1_000_000_000_000,9_000_000_000_000));
    let current = {environment:'Sandbox',originalID,transactionID:String(BigInt(originalID)+1n),
        appAccountToken:context.appAccountToken,purchasedAtMs:now-1000,expiresAtMs:now+3600_000,
        signedAtMs:now,revokedAtMs:null,premium:true,autoRenews:true,status:1,checkedAtMs:now};
    const apple = {proof:async () => current, notification:async () => current, current:async () => {
        calls++; if (barrier) await barrier;
        if (fail) throw Error('Injected Apple network failure');
        return {...current,checkedAtMs:now};
    }};
    const service = createPurchaseService({store,apple,clock:() => now});
    measured.reset();
    return {uid,user,store,service,measured,context,creationCost,current:() => ({...current}),
        input:{version:1,kind:'verify',signedTransaction:signed}, calls:() => calls,
        patch:values => {current = {...current,...values};}, advance:ms => {now += ms;},
        fail:value => {fail = value;}, hold:promise => {barrier = promise;}};
}
test('context is account-bound and first purchase returns durable entitlement without a confirmation read', async () => {
    const f = await fixture();
    assert.deepEqual(f.creationCost,{reads:3,writes:2});
    assert.deepEqual(await f.service.execute(f.uid,{version:1,kind:'context'}),f.context);
    assert.deepEqual(f.measured.totals(),{reads:3,writes:0});
    f.measured.reset();
    const reply = await f.service.execute(f.uid,f.input);
    assert.equal(reply.entitlement.source,'app-store-sandbox');
    assert.equal(reply.entitlement.premium,true);
    assert.equal(reply.subscription.environment,'Sandbox');
    assert.deepEqual(f.measured.totals(),{reads:9,writes:4});
    assert.equal(f.calls(),1);
    assert.equal((await f.user.collection('state').doc('entitlement').get()).get('revision'),reply.entitlement.revision);
    f.measured.reset();
    const duplicate = await f.service.execute(f.uid,f.input);
    assert.deepEqual(duplicate.entitlement,reply.entitlement);
    assert.deepEqual(f.measured.totals(),{reads:9,writes:2});
    assert.equal((await db.collection('nativeAppleOwners').where('uid','==',f.uid).get()).size,2);
});
test('forged account tokens, wrong owners and extra request fields never grant or call Apple status', async () => {
    const f = await fixture(), other = await fixture();
    await assert.rejects(f.service.execute(other.uid,f.input),e => e.code === 'purchase-account-mismatch');
    await assert.rejects(f.service.execute(f.uid,{...f.input,uid:other.uid}),e => e.code === 'invalid');
    await assert.rejects(f.service.execute(f.uid,{version:1,kind:'context',signedTransaction:signed}));
    assert.equal(f.calls(),0);
    assert.equal((await other.user.collection('state').doc('entitlement').get()).get('premium'),false);
    await f.service.execute(f.uid,f.input);
    f.patch({appAccountToken:other.context.appAccountToken});
    await assert.rejects(f.service.execute(other.uid,f.input),e => e.code === 'purchase-account-mismatch');
});
test('failed verification is unavailable and replay after lost reply is duplicate-safe', async () => {
    const f = await fixture(); f.fail(true);
    await assert.rejects(f.service.execute(f.uid,f.input),/network failure/);
    assert.equal((await f.user.collection('state').doc('entitlement').get()).get('premium'),false);
    f.fail(false);
    const accepted = await f.service.execute(f.uid,f.input);
    const recovered = await f.service.execute(f.uid,f.input);
    assert.equal(recovered.entitlement.revision,accepted.entitlement.revision);
});
test('simultaneous client and notification redelivery share one status request and one entitlement change', async () => {
    const f = await fixture();
    let release; f.hold(new Promise(resolve => {release = resolve;}));
    const first = f.service.execute(f.uid,f.input);
    while (f.calls() === 0) await new Promise(resolve => setTimeout(resolve,5));
    let found;
    const didFind = new Promise(resolve => {found = resolve;});
    const originalOwnerFor = f.store.ownerFor;
    f.store.ownerFor = async (...args) => {const value = await originalOwnerFor(...args); found(); return value;};
    const event = f.service.notification(signed);
    let loaded;
    const didLoad = new Promise(resolve => {loaded = resolve;});
    const originalLoad = f.store.load;
    f.store.load = async (...args) => {const value = await originalLoad(...args); loaded(); return value;};
    const second = f.service.execute(f.uid,f.input);
    await Promise.all([didLoad,didFind]);
    // Drain the fulfilled read/proof continuations before releasing the held API response.
    await new Promise(resolve => setImmediate(resolve));
    release();
    const [a,b] = await Promise.all([first,second,event]);
    assert.deepEqual(a.entitlement,b.entitlement);
    assert.equal(a.entitlement.revision,2);
    assert.equal(f.calls(),1);
    f.store.ownerFor = originalOwnerFor;
});
test('refund, reversal and renewal are monotonic; delayed responses cannot resurrect refunded access', async () => {
    const f = await fixture();
    await f.service.execute(f.uid,f.input);
    const initial = (await f.store.load(f.uid)).state.sandbox;
    f.patch({premium:false,revokedAtMs:initial.signedAtMs+1,signedAtMs:initial.signedAtMs+1,status:5});
    const refund = await f.service.execute(f.uid,f.input);
    assert.equal(refund.entitlement.premium,false);
    const stale = await f.store.apply(f.uid,initial);
    assert.equal(stale.entitlement.premium,false);
    f.patch({premium:true,revokedAtMs:null,signedAtMs:initial.signedAtMs+2,status:1});
    assert.equal((await f.service.execute(f.uid,f.input)).entitlement.premium,true);
    f.patch({transactionID:'102',purchasedAtMs:initial.purchasedAtMs+1000,signedAtMs:initial.signedAtMs+3});
    const renewed = await f.service.execute(f.uid,f.input);
    assert.equal((await f.store.apply(f.uid,{...initial,signedAtMs:initial.signedAtMs+4})).entitlement.revision,renewed.entitlement.revision);
});
test('production takes precedence over sandbox, including known refund and expired production', async () => {
    const f = await fixture(); f.patch({environment:'Production',premium:false,status:5});
    await f.service.execute(f.uid,f.input);
    f.patch({environment:'Sandbox',premium:true,status:1});
    const reply = await f.service.execute(f.uid,f.input);
    assert.equal(reply.entitlement.premium,false);
    assert.equal(reply.entitlement.source,'app-store-production');
    assert.equal(reply.subscription.environment,'Production');
});
test('near-expiry refresh is throttled; free users do not perform an Apple status request', async () => {
    const f = await fixture();
    await f.service.execute(f.uid,{version:1,kind:'refresh'});
    assert.equal(f.calls(),0);
    await f.service.execute(f.uid,f.input);
    f.measured.reset();
    await f.service.execute(f.uid,{version:1,kind:'refresh'});
    assert.deepEqual(f.measured.totals(),{reads:3,writes:0});
    assert.equal(f.calls(),1);
    f.advance(policy.REFRESH_INTERVAL_MS);
    await f.service.execute(f.uid,{version:1,kind:'refresh'});
    assert.equal(f.calls(),2);
});
test('notifications cannot recreate deleted/deleting owners; in-flight apply reads the deletion fence', async () => {
    const f = await fixture();
    await f.user.update({status:'deleting'});
    await f.service.notification(signed);
    await assert.rejects(f.store.apply(f.uid,f.current()),e => e.code === 'account-deleting');
    await db.recursiveDelete(f.user);
    await f.service.notification(signed);
    assert.equal((await f.user.get()).exists,false);
    assert.deepEqual(await f.user.listCollections(),[]);
    assert.equal(f.calls(),0);
});
test('deletion while Apple responds cannot recreate private state or grant Premium', async () => {
    const f = await fixture();
    let release; f.hold(new Promise(resolve => {release = resolve;}));
    const work = f.service.execute(f.uid,f.input);
    while (f.calls() === 0) await new Promise(resolve => setTimeout(resolve,5));
    await db.recursiveDelete(f.user);
    release();
    await assert.rejects(work,e => e.code === 'account-unavailable');
    assert.deepEqual(await f.user.listCollections(),[]);
});
