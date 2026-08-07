# Achievement storage migration (subcollection to user document map)

## Why

Earned achievements lived at `users/{uid}/achievements/{achievementId}`, one document
per badge. Firestore bills one read per document returned, and the badge space is
65 (50 states + 5 paws + 4 rare feats + 6 classified). Every session start paid up
to 65 reads to answer "what has this user already earned".

The app already holds a live `onSnapshot` on `users/{uid}`. Moving earned badges to
a map field on that document means the data arrives on a subscription we already pay
for: **zero extra reads**. Writes improve too, since unlocking 30 states becomes one
merged field update instead of 30 document writes.

Savings scale with usage: roughly `DAU x sessions/day x badges x 30` reads per month
eliminated. Negligible under a few thousand DAU, material above that.

## Shape

On `users/{uid}`:

```
achievements: {
  bronzePaw:  { tier: 'honor',    dateEarned: <Timestamp> },
  'state-oh': { tier: 'verified', dateEarned: <Timestamp> }
},
achievementsSchema: 2
```

`achievementsSchema` marks a user document whose map has been backfilled and is
therefore safe to read on its own. Roughly 5KB at full 65 badges, against the 1MB
document limit, so document size is not a constraint. `visitedPlaces` remains the
real consumer of that budget.

## Rules

No rules change was required. `users/{uid}` uses a **denylist** (`protectedUserKeys`),
not an allowlist, and neither `achievements` nor `achievementsSchema` is protected.
Verified in `03-tests/rules/firestore-entitlement.rules.test.js`:

- owner can create and update the map, and merge new badges into it
- another signed-in user cannot write it
- the map cannot be used to smuggle in a protected `entitlement` key

## Rollout phases

**Phase 1 (done, beta).** Dual-write and backfill.
- Existing users are backfilled onto the map on their next evaluation, so each user
  pays the legacy read exactly one more time.
- Writes go to both the map and the subcollection, so older clients still see badges.

**Phase 2 (done, beta).** Lazy legacy verification. **This is where the savings land,
and it does not require production to be promoted first.**

Once a user's map is backfilled it is treated as authoritative and the routine
subcollection read disappears. The legacy subcollection is consulted only when a
badge is unlocked that the map has never recorded, which is the only moment an older
client could be holding an earlier earned date that matters. Verification runs at
most once per session.

So:
- steady-state session, nothing newly earned: **zero achievement reads**
- session where something unlocks for the first time: one verification read, and the
  legacy earned date still wins over today's

Unlocks are rare, so this captures nearly all of the saving while remaining correct
even with old clients live.

**Phase 3.** Promote production to this client.

**Phase 4.** Flip `legacySubcollectionEnabled` to `false` where the engine is
constructed (`01-code/app/modules/barkState.js`). This drops the remaining
verification read and the dual writes. Only safe after Phase 3, and worth little on
its own now that Phase 2 has taken the routine read out.

**Phase 5.** After enough time that no installed PWA is still running cached old JS,
remove the legacy branch from `gamificationLogic.js` entirely.

## Why Phase 4 still cannot be done early

Beta and production share one Firestore. A production client on old code writes only
the subcollection. With `legacySubcollectionEnabled` false there is no verification
step at all, so a badge earned on production would look brand new here and be
rewritten with today's date, destroying the original earned date. Phase 2's lazy
verification is exactly what makes the savings safe before that point.

## Rollback

Set `legacySubcollectionEnabled` back to `true`. The subcollection is still fully
populated through Phase 4, so reverting the client restores previous behaviour with
no data loss. Rules forbid deleting achievement documents, so the legacy data cannot
be lost accidentally.
