const { after, before, beforeEach, describe, it } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} = require('@firebase/rules-unit-testing');

const {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc,
    updateDoc
} = require('firebase/firestore');

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-bark-ranger-rules-test';
const RULES_PATH = path.resolve(__dirname, '../../06-config/firestore.rules');

let testEnv;

function authedDb(uid) {
    return testEnv.authenticatedContext(uid).firestore();
}

function unauthDb() {
    return testEnv.unauthenticatedContext().firestore();
}

async function seedDoc(pathSegments, data) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), ...pathSegments), data);
    });
}

function makeVisitedPlaces(count, start = 1) {
    return Array.from({ length: count }, (_, index) => ({
        id: `park-${start + index}`,
        name: `Park ${start + index}`,
        ts: 1710000000000 + index
    }));
}

describe('Firestore entitlement and admin field rules', () => {
    before(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: PROJECT_ID,
            firestore: {
                rules: fs.readFileSync(RULES_PATH, 'utf8')
            }
        });
    });

    beforeEach(async () => {
        await testEnv.clearFirestore();
    });

    after(async () => {
        await testEnv.cleanup();
    });

    it('allows a user to read only their own user document', async () => {
        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            entitlement: { premium: true, status: 'manual_active' }
        });
        await seedDoc(['users', 'bob'], {
            settings: { mapStyle: 'satellite' }
        });

        const aliceDb = authedDb('alice');

        await assertSucceeds(getDoc(doc(aliceDb, 'users', 'alice')));
        await assertFails(getDoc(doc(aliceDb, 'users', 'bob')));
    });

    it('denies unauthenticated user document and savedRoutes access', async () => {
        const publicDb = unauthDb();

        await assertFails(setDoc(doc(publicDb, 'users', 'alice'), {
            settings: { mapStyle: 'default' }
        }));

        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            visitedPlaces: []
        });
        await seedDoc(['users', 'alice', 'savedRoutes', 'route1'], {
            tripName: 'Seeded Route',
            createdAt: 1710000000000,
            tripDays: []
        });

        await assertFails(getDoc(doc(publicDb, 'users', 'alice')));
        await assertFails(updateDoc(doc(publicDb, 'users', 'alice'), {
            settings: { mapStyle: 'terrain' }
        }));
        await assertFails(getDoc(doc(publicDb, 'users', 'alice', 'savedRoutes', 'route1')));
        await assertFails(setDoc(doc(publicDb, 'users', 'alice', 'savedRoutes', 'route1'), {
            tripName: 'Unauthenticated Write',
            createdAt: 1710000000001,
            tripDays: []
        }));
    });

    it('allows current app-owned settings and visitedPlaces writes on the owner user document', async () => {
        const aliceDb = authedDb('alice');
        const aliceRef = doc(aliceDb, 'users', 'alice');

        await assertSucceeds(setDoc(aliceRef, {
            settings: {
                mapStyle: 'default',
                visitedFilter: 'all',
                premiumClustering: false
            }
        }));

        await assertSucceeds(updateDoc(aliceRef, {
            visitedPlaces: [
                { id: 'yosemite', name: 'Yosemite', ts: 1710000000000 }
            ]
        }));

        await assertSucceeds(updateDoc(aliceRef, {
            emailVerified: false,
            emailVerificationUpdatedAt: 1710000000002
        }));
    });

    it('allows allowed user writes while preserving server-written entitlement', async () => {
        await seedDoc(['users', 'alice'], {
            entitlement: {
                premium: true,
                status: 'manual_active',
                source: 'admin_override',
                manualOverride: true,
                currentPeriodEnd: null
            },
            settings: { mapStyle: 'default' }
        });

        const aliceDb = authedDb('alice');
        const aliceRef = doc(aliceDb, 'users', 'alice');

        await assertSucceeds(updateDoc(aliceRef, {
            settings: { mapStyle: 'terrain', visitedFilter: 'visited' },
            visitedPlaces: [{ id: 'zion', name: 'Zion', ts: 1710000000001 }]
        }));
    });

    it('enforces the five-visit free limit on owner user document creates', async () => {
        const aliceDb = authedDb('alice');
        const bobDb = authedDb('bob');

        await assertSucceeds(setDoc(doc(aliceDb, 'users', 'alice'), {
            settings: { mapStyle: 'default' },
            visitedPlaces: makeVisitedPlaces(5)
        }));

        await assertFails(setDoc(doc(bobDb, 'users', 'bob'), {
            settings: { mapStyle: 'default' },
            visitedPlaces: makeVisitedPlaces(6)
        }));
    });

    it('denies direct free-user visitedPlaces updates above five while allowing legacy trim-down writes', async () => {
        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            visitedPlaces: makeVisitedPlaces(5)
        });

        const aliceDb = authedDb('alice');
        const aliceRef = doc(aliceDb, 'users', 'alice');

        await assertFails(updateDoc(aliceRef, {
            visitedPlaces: makeVisitedPlaces(6)
        }));

        await seedDoc(['users', 'legacy-free'], {
            settings: { mapStyle: 'default' },
            visitedPlaces: makeVisitedPlaces(8)
        });

        const legacyDb = authedDb('legacy-free');
        const legacyRef = doc(legacyDb, 'users', 'legacy-free');

        await assertSucceeds(updateDoc(legacyRef, {
            settings: { mapStyle: 'terrain' }
        }));

        await assertFails(updateDoc(legacyRef, {
            visitedPlaces: makeVisitedPlaces(9)
        }));

        await assertFails(updateDoc(legacyRef, {
            visitedPlaces: makeVisitedPlaces(8, 101)
        }));

        await assertSucceeds(updateDoc(legacyRef, {
            visitedPlaces: makeVisitedPlaces(7)
        }));
    });

    it('allows active premium-status users to write visitedPlaces beyond the free limit', async () => {
        const premiumStatuses = ['active', 'manual_active', 'past_due', 'paused', 'cancelled_active'];

        for (const status of premiumStatuses) {
            const uid = `premium-${status}`;
            await seedDoc(['users', uid], {
                entitlement: {
                    premium: true,
                    status,
                    source: status === 'manual_active' ? 'admin_override' : 'lemon_squeezy',
                    manualOverride: status === 'manual_active',
                    currentPeriodEnd: status === 'cancelled_active' ? '2026-06-09T00:00:00.000Z' : null
                },
                settings: { mapStyle: 'default' },
                visitedPlaces: makeVisitedPlaces(5)
            });

            const premiumDb = authedDb(uid);
            const premiumRef = doc(premiumDb, 'users', uid);

            await assertSucceeds(updateDoc(premiumRef, {
                visitedPlaces: makeVisitedPlaces(6)
            }));
        }

        await seedDoc(['users', 'premium-access-code'], {
            entitlement: {
                premium: true,
                status: 'access_code_active',
                source: 'access_code',
                manualOverride: true,
                expiresAt: new Date('2099-01-01T00:00:00.000Z')
            },
            settings: { mapStyle: 'default' },
            visitedPlaces: makeVisitedPlaces(5)
        });

        const accessCodeDb = authedDb('premium-access-code');
        await assertSucceeds(updateDoc(doc(accessCodeDb, 'users', 'premium-access-code'), {
            visitedPlaces: makeVisitedPlaces(6)
        }));
    });

    it('denies expired access_code users from writing above the free visit limit', async () => {
        await seedDoc(['users', 'expired-access-code'], {
            entitlement: {
                premium: true,
                status: 'access_code_active',
                source: 'access_code',
                manualOverride: true,
                expiresAt: new Date('2020-01-01T00:00:00.000Z')
            },
            settings: { mapStyle: 'default' },
            visitedPlaces: makeVisitedPlaces(5)
        });

        const expiredDb = authedDb('expired-access-code');
        await assertFails(updateDoc(doc(expiredDb, 'users', 'expired-access-code'), {
            visitedPlaces: makeVisitedPlaces(6)
        }));
    });

    it('locks expired over-limit users from adding visits while allowing removals', async () => {
        await seedDoc(['users', 'expired-legacy'], {
            entitlement: {
                premium: false,
                status: 'expired',
                source: 'lemon_squeezy',
                manualOverride: false,
                currentPeriodEnd: '2026-04-09T00:00:00.000Z'
            },
            settings: { mapStyle: 'default' },
            visitedPlaces: makeVisitedPlaces(20)
        });

        const expiredDb = authedDb('expired-legacy');
        const expiredRef = doc(expiredDb, 'users', 'expired-legacy');

        await assertFails(updateDoc(expiredRef, {
            visitedPlaces: makeVisitedPlaces(21)
        }));

        await assertFails(updateDoc(expiredRef, {
            visitedPlaces: makeVisitedPlaces(20, 101)
        }));

        await assertSucceeds(updateDoc(expiredRef, {
            visitedPlaces: makeVisitedPlaces(19)
        }));
    });

    it('denies malformed visitedPlaces writes for free and premium users', async () => {
        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' }
        });
        await seedDoc(['users', 'premium-alice'], {
            entitlement: {
                premium: true,
                status: 'manual_active',
                source: 'admin_override',
                manualOverride: true,
                currentPeriodEnd: null
            },
            settings: { mapStyle: 'default' }
        });

        const aliceDb = authedDb('alice');
        const premiumDb = authedDb('premium-alice');

        await assertFails(updateDoc(doc(aliceDb, 'users', 'alice'), {
            visitedPlaces: { count: 1 }
        }));

        await assertFails(updateDoc(doc(premiumDb, 'users', 'premium-alice'), {
            visitedPlaces: { count: 99 }
        }));
    });

    it('denies creating a user document with entitlement fields', async () => {
        const aliceDb = authedDb('alice');

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice'), {
            settings: { mapStyle: 'default' },
            entitlement: {
                premium: true,
                status: 'manual_active'
            }
        }));
    });

    it('denies updating entitlement fields, including nested entitlement.premium', async () => {
        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            entitlement: {
                premium: false,
                status: 'free',
                source: 'none',
                manualOverride: false,
                currentPeriodEnd: null
            }
        });

        const aliceDb = authedDb('alice');
        const aliceRef = doc(aliceDb, 'users', 'alice');

        await assertFails(updateDoc(aliceRef, {
            entitlement: {
                premium: true,
                status: 'manual_active',
                source: 'admin_override',
                manualOverride: true,
                currentPeriodEnd: null
            }
        }));

        await assertFails(updateDoc(aliceRef, {
            'entitlement.premium': true
        }));

        await assertFails(updateDoc(aliceRef, {
            'entitlement.status': 'manual_active'
        }));
    });

    it('denies top-level premium, provider, and admin escalation fields', async () => {
        const protectedFields = [
            ['premium', true],
            ['premiumStatus', 'active'],
            ['subscription', { status: 'active' }],
            ['subscriptions', [{ status: 'active' }]],
            ['plan', 'pro'],
            ['manualOverride', true],
            ['providerCustomerId', 'cus_test'],
            ['providerSubscriptionId', 'sub_test'],
            ['currentPeriodEnd', 1999999999999],
            ['source', 'admin_override'],
            ['status', 'manual_active'],
            ['isAdmin', true],
            ['admin', true],
            ['role', 'admin'],
            ['roles', ['admin']]
        ];

        const aliceDb = authedDb('alice');

        for (const [field, value] of protectedFields) {
            await assertFails(setDoc(doc(aliceDb, 'users', `alice-${field}`), {
                settings: { mapStyle: 'default' },
                [field]: value
            }));
        }
    });

    it('denies deleting the owner user document', async () => {
        await seedDoc(['users', 'alice'], {
            settings: { mapStyle: 'default' },
            entitlement: { premium: true, status: 'manual_active' }
        });

        const aliceDb = authedDb('alice');

        await assertFails(deleteDoc(doc(aliceDb, 'users', 'alice')));
    });

    it('requires premium entitlement to read and write savedRoutes', async () => {
        await seedDoc(['users', 'free-user'], {
            settings: { mapStyle: 'default' }
        });
        await seedDoc(['users', 'free-user', 'savedRoutes', 'existing-free-route'], {
            tripName: 'Existing Free Route',
            createdAt: 1710000000000,
            tripDays: []
        });
        await seedDoc(['users', 'premium-user'], {
            entitlement: {
                premium: true,
                status: 'manual_active',
                source: 'admin_override',
                manualOverride: true,
                currentPeriodEnd: null
            },
            settings: { mapStyle: 'default' }
        });

        const freeDb = authedDb('free-user');
        const premiumDb = authedDb('premium-user');

        await assertFails(setDoc(doc(freeDb, 'users', 'free-user', 'savedRoutes', 'route-1'), {
            tripName: 'Free Route',
            createdAt: 1710000000000,
            tripDays: []
        }));
        await assertFails(getDoc(doc(freeDb, 'users', 'free-user', 'savedRoutes', 'existing-free-route')));
        await assertFails(getDocs(collection(freeDb, 'users', 'free-user', 'savedRoutes')));
        await assertFails(updateDoc(doc(freeDb, 'users', 'free-user', 'savedRoutes', 'existing-free-route'), {
            tripName: 'Updated Free Route'
        }));
        await assertSucceeds(deleteDoc(doc(freeDb, 'users', 'free-user', 'savedRoutes', 'existing-free-route')));

        await assertSucceeds(setDoc(doc(premiumDb, 'users', 'premium-user', 'savedRoutes', 'route-1'), {
            tripName: 'Rules Test Trip',
            createdAt: 1710000000000,
            tripDays: []
        }));
        await assertSucceeds(getDoc(doc(premiumDb, 'users', 'premium-user', 'savedRoutes', 'route-1')));
        await assertSucceeds(getDocs(collection(premiumDb, 'users', 'premium-user', 'savedRoutes')));
        await assertSucceeds(updateDoc(doc(premiumDb, 'users', 'premium-user', 'savedRoutes', 'route-1'), {
            tripName: 'Updated Rules Test Trip'
        }));
        await assertFails(setDoc(doc(premiumDb, 'users', 'bob', 'savedRoutes', 'route-1'), {
            tripName: 'Other User Trip',
            createdAt: 1710000000000,
            tripDays: []
        }));
        await assertFails(getDoc(doc(premiumDb, 'users', 'bob', 'savedRoutes', 'route-1')));
    });

    it('allows owner to read and write their own achievements', async () => {
        const aliceDb = authedDb('alice');
        const achievementRef = doc(aliceDb, 'users', 'alice', 'achievements', 'bronzePaw');

        await assertSucceeds(setDoc(achievementRef, {
            achievementId: 'bronzePaw',
            tier: 'honor',
            dateEarned: serverTimestamp()
        }));

        await assertSucceeds(getDoc(achievementRef));

        await assertSucceeds(setDoc(achievementRef, {
            achievementId: 'bronzePaw',
            tier: 'verified',
            dateEarned: serverTimestamp()
        }, { merge: true }));
    });

    it('allows exact BUG-001 owner achievement path and denies unsafe access', async () => {
        const runtimeUid = 'LkevgscKPvPqRg9c5YKKXVqtwv02';
        const achievementId = 'bug001RuntimeSmoke';
        const ownerDb = authedDb(runtimeUid);
        const otherDb = authedDb('not-the-runtime-owner');
        const publicDb = unauthDb();
        const ownerAchievementRef = doc(ownerDb, 'users', runtimeUid, 'achievements', achievementId);

        await assertSucceeds(setDoc(ownerAchievementRef, {
            achievementId,
            tier: 'verified',
            dateEarned: serverTimestamp()
        }));

        await assertSucceeds(getDoc(ownerAchievementRef));

        await assertFails(setDoc(doc(otherDb, 'users', runtimeUid, 'achievements', achievementId), {
            achievementId,
            tier: 'verified',
            dateEarned: serverTimestamp()
        }));

        await assertFails(setDoc(doc(publicDb, 'users', runtimeUid, 'achievements', achievementId), {
            achievementId,
            tier: 'verified',
            dateEarned: serverTimestamp()
        }));

        await assertFails(setDoc(ownerAchievementRef, {
            achievementId,
            tier: 'verified',
            dateEarned: serverTimestamp(),
            admin: true
        }));

        await assertFails(deleteDoc(ownerAchievementRef));
    });

    it('denies reading and writing another user achievements', async () => {
        await seedDoc(['users', 'bob', 'achievements', 'bronzePaw'], {
            achievementId: 'bronzePaw',
            tier: 'honor',
            dateEarned: new Date('2026-01-01T00:00:00.000Z')
        });

        const aliceDb = authedDb('alice');

        await assertFails(getDoc(doc(aliceDb, 'users', 'bob', 'achievements', 'bronzePaw')));
        await assertFails(setDoc(doc(aliceDb, 'users', 'bob', 'achievements', 'silverPaw'), {
            achievementId: 'silverPaw',
            tier: 'honor',
            dateEarned: serverTimestamp()
        }));
    });

    it('denies unauthenticated achievement reads and writes', async () => {
        await seedDoc(['users', 'alice', 'achievements', 'bronzePaw'], {
            achievementId: 'bronzePaw',
            tier: 'honor',
            dateEarned: new Date('2026-01-01T00:00:00.000Z')
        });

        const publicDb = unauthDb();

        await assertFails(getDoc(doc(publicDb, 'users', 'alice', 'achievements', 'bronzePaw')));
        await assertFails(setDoc(doc(publicDb, 'users', 'alice', 'achievements', 'silverPaw'), {
            achievementId: 'silverPaw',
            tier: 'honor',
            dateEarned: serverTimestamp()
        }));
    });

    it('denies achievements with unexpected or dangerous fields', async () => {
        const aliceDb = authedDb('alice');

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice', 'achievements', 'bronzePaw'), {
            achievementId: 'bronzePaw',
            tier: 'honor',
            dateEarned: serverTimestamp(),
            entitlement: { premium: true, status: 'manual_active' }
        }));

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice', 'achievements', 'silverPaw'), {
            achievementId: 'silverPaw',
            tier: 'honor',
            dateEarned: serverTimestamp(),
            isAdmin: true
        }));

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice', 'achievements', 'goldPaw'), {
            achievementId: 'wrong-id',
            tier: 'honor',
            dateEarned: serverTimestamp()
        }));

        await assertFails(setDoc(doc(aliceDb, 'users', 'alice', 'achievements', 'platinumPaw'), {
            achievementId: 'platinumPaw',
            tier: 'admin',
            dateEarned: serverTimestamp()
        }));
    });

    it('denies direct client leaderboard writes, including owner and other-user docs', async () => {
        const aliceDb = authedDb('alice');

        await assertFails(setDoc(doc(aliceDb, 'leaderboard', 'alice'), {
            displayName: 'Alice',
            photoURL: '',
            totalPoints: 42,
            totalVisited: 3,
            hasVerified: false
        }));

        await assertFails(setDoc(doc(aliceDb, 'leaderboard', 'bob'), {
            displayName: 'Bob',
            photoURL: '',
            totalPoints: 999,
            totalVisited: 999,
            hasVerified: true
        }));
    });

    it('denies unknown subcollections under users by default', async () => {
        const aliceDb = authedDb('alice');

        await assertFails(setDoc(doc(collection(aliceDb, 'users', 'alice', 'entitlement')), {
            premium: true,
            status: 'manual_active'
        }));
    });

    it('denies client access to server-only rate-limit and webhook receipt collections', async () => {
        await seedDoc(['_premiumCallableRateLimits', 'getPremiumRoute_alice_1700000000000'], {
            uid: 'alice',
            action: 'getPremiumRoute',
            count: 1
        });
        await seedDoc(['_lemonSqueezyWebhookEvents', 'receipt-1'], {
            provider: 'lemon_squeezy',
            processingStatus: 'processed'
        });

        const aliceDb = authedDb('alice');
        const publicDb = unauthDb();

        await assertFails(getDoc(doc(aliceDb, '_premiumCallableRateLimits', 'getPremiumRoute_alice_1700000000000')));
        await assertFails(setDoc(doc(aliceDb, '_premiumCallableRateLimits', 'getPremiumRoute_alice_1700000000000'), {
            uid: 'alice',
            action: 'getPremiumRoute',
            count: 0
        }));
        await assertFails(setDoc(doc(publicDb, '_premiumCallableRateLimits', 'getPremiumGeocode_public_1700000000000'), {
            uid: 'public',
            action: 'getPremiumGeocode',
            count: 99
        }));

        await assertFails(getDoc(doc(aliceDb, '_lemonSqueezyWebhookEvents', 'receipt-1')));
        await assertFails(setDoc(doc(aliceDb, '_lemonSqueezyWebhookEvents', 'receipt-2'), {
            provider: 'lemon_squeezy',
            processingStatus: 'processed'
        }));
    });

    it('denies client access to access code and redemption collections', async () => {
        await seedDoc(['accessCodes', 'hash-1'], {
            codeHash: 'hash-1',
            active: true,
            type: 'premium_free_year',
            redemptionCount: 0
        });
        await seedDoc(['accessCodeRedemptions', 'redemption-1'], {
            codeHash: 'hash-1',
            uid: 'alice'
        });

        const aliceDb = authedDb('alice');
        const publicDb = unauthDb();

        await assertFails(getDoc(doc(aliceDb, 'accessCodes', 'hash-1')));
        await assertFails(setDoc(doc(aliceDb, 'accessCodes', 'hash-2'), {
            codeHash: 'hash-2',
            active: true,
            type: 'premium_free_year'
        }));
        await assertFails(updateDoc(doc(aliceDb, 'accessCodes', 'hash-1'), {
            redemptionCount: 0
        }));
        await assertFails(deleteDoc(doc(aliceDb, 'accessCodes', 'hash-1')));

        await assertFails(getDoc(doc(aliceDb, 'accessCodeRedemptions', 'redemption-1')));
        await assertFails(setDoc(doc(aliceDb, 'accessCodeRedemptions', 'redemption-2'), {
            codeHash: 'hash-1',
            uid: 'alice'
        }));
        await assertFails(setDoc(doc(publicDb, 'accessCodeRedemptions', 'redemption-3'), {
            codeHash: 'hash-1',
            uid: 'public'
        }));
    });

    it('denies direct feedback writes because feedback is server-callable only', async () => {
        const aliceDb = authedDb('alice');
        const publicDb = unauthDb();

        await assertFails(setDoc(doc(aliceDb, 'feedback', 'alice-feedback'), {
            text: 'Please add this park.',
            sender: 'Alice',
            timestamp: serverTimestamp()
        }));
        await assertFails(setDoc(doc(aliceDb, 'feedback', 'alice-extra-feedback'), {
            text: 'Please add this park.',
            sender: 'Alice',
            timestamp: serverTimestamp(),
            entitlement: { premium: true },
            adminNotes: 'client forged'
        }));
        await assertFails(setDoc(doc(publicDb, 'feedback', 'public-feedback'), {
            text: 'Anonymous feedback.',
            sender: 'Anonymous Guest',
            timestamp: serverTimestamp()
        }));

        await seedDoc(['feedback', 'seeded-feedback'], {
            uid: 'alice',
            message: 'Seeded server feedback.',
            status: 'new',
            createdAt: serverTimestamp()
        });
        await assertFails(updateDoc(doc(aliceDb, 'feedback', 'seeded-feedback'), {
            status: 'closed'
        }));
        await assertFails(deleteDoc(doc(aliceDb, 'feedback', 'seeded-feedback')));
        await assertFails(getDoc(doc(aliceDb, 'feedback', 'seeded-feedback')));
    });

    it('denies direct feedback rate-limit document access', async () => {
        await seedDoc(['_feedbackRateLimits', 'alice_1700000000000'], {
            uid: 'alice',
            count: 1
        });

        const aliceDb = authedDb('alice');
        const publicDb = unauthDb();

        await assertFails(getDoc(doc(aliceDb, '_feedbackRateLimits', 'alice_1700000000000')));
        await assertFails(setDoc(doc(aliceDb, '_feedbackRateLimits', 'alice_1700000000000'), {
            uid: 'alice',
            count: 0
        }));
        await assertFails(setDoc(doc(publicDb, '_feedbackRateLimits', 'public_1700000000000'), {
            uid: 'public',
            count: 0
        }));
    });

    it('denies arbitrary top-level collections by default', async () => {
        await seedDoc(['randomCollection', 'doc1'], {
            seeded: true
        });

        const aliceDb = authedDb('alice');
        const publicDb = unauthDb();

        await assertFails(getDoc(doc(aliceDb, 'randomCollection', 'doc1')));
        await assertFails(setDoc(doc(aliceDb, 'randomCollection', 'doc1'), {
            seeded: false
        }));
        await assertFails(setDoc(doc(aliceDb, 'randomCollection', 'doc2'), {
            seeded: false
        }));
        await assertFails(setDoc(doc(publicDb, 'randomCollection', 'doc1'), {
            seeded: false
        }));
        await assertFails(setDoc(doc(publicDb, 'randomCollection', 'doc3'), {
            seeded: false
        }));
    });
});
