# Gamification Achievements Firestore Rules Fix Plan

Date: 2026-05-03

Status: implemented locally. This is unrelated to Lemon Squeezy checkout, webhook entitlement, or paywall verification. Rules are not deployed until explicit approval.

## Problem

The browser console can show:

```text
gamificationLogic.js Sync error: FirebaseError: Missing or insufficient permissions.
```

Confirmed denied write:

```text
users/{uid}/achievements/{achievementId}
```

Current rules allow `users/{uid}/savedRoutes/{routeId}` but deny other `users/{uid}` subcollections through the nested catch-all:

```text
match /{document=**} {
  allow read, write: if false;
}
```

## Impact

- Achievement persistence can fail for signed-in users.
- This does not block Lemon Squeezy webhook entitlement writes because those use Admin SDK.
- This does not explain payment verification when the current signed-in UID lacks entitlement.
- This is unrelated to frontend checkout, provider webhooks, and ORS callable premium enforcement.

## Proposed Future Slice

1. Confirm the exact denied path from browser or Firestore debug logs.
2. Add Firestore rules tests for `users/{uid}/achievements/{achievementId}`.
3. Decide the allowed client write shape:
   - Owner-only writes.
   - Limited fields such as `achievementId`, `tier`, and `dateEarned`.
   - No protected entitlement/provider/admin fields.
4. Update `firestore.rules` narrowly.
5. Run:

```bash
npm run test:rules
npm run test:e2e:smoke
git diff --check
```

## Local Fix

The app writes achievements from `gamificationLogic.js` at:

```js
firebase.firestore()
  .collection('users')
  .doc(userId)
  .collection('achievements')
  .doc(item.id)
```

Allowed owner write shape:

```js
{
  achievementId: string, // must match the document ID
  tier: 'honor' | 'verified',
  dateEarned: timestamp
}
```

Local rule:

```text
match /achievements/{achievementId} {
  allow read: if isOwner(uid);
  allow create, update: if isOwner(uid) && isValidAchievementWrite(achievementId);
  allow delete: if false;
}
```

Tests cover owner access, cross-user denial, unauthenticated denial, and unexpected/dangerous field denial.

## Stop Lines

- Do not change payment code in this slice.
- Do not weaken entitlement/payment/admin field protection.
- Do not allow cross-user achievement writes.
- Do not deploy rules without explicit approval.
