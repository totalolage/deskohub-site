# Avatar media storage

The business policy is `apps/deskohub-workspace/docs/customer-account-avatars.md`.
The Workspace side lives in `features/account/backend/customer-avatar.service.ts`
and `customer-avatar-normalization.ts`.

## Package boundary

- Make every provider call through `CloudinaryService` in
  `@deskohub/cloudinary`. Avatar code uses only the executors that log fixed,
  identifier-free messages: `getByPublicId`, `listFolderAssets`, `uploadImage`,
  `destroyAsset`, `deleteResourcesByPublicIdPrefix`, and `renameAsset`.
- Errors: `CloudinaryUploadError`, `CloudinaryDestroyError` and
  `CloudinaryPrefixDeleteError` (outcome `uncertain` or `failed`), and
  `CloudinaryRenameError` (reason `target-exists`, `source-missing`, or
  `failed`). Retries cover only 5xx-style failures; 4xx failures are final.
- `destroyAsset` sets `invalidate` and returns `destroyed` or `not-found`. An
  unrecognized response or exhausted retries surfaces as `uncertain`.
- `deleteResourcesByPublicIdPrefix` deletes image uploads under a prefix,
  follows `next_cursor`, rejects repeated cursors, and fails after 25 pages.
  Prefixes never enter logs or errors.
- The package only transports bytes. Normalization (sharp, WebP, at most
  512x512, metadata stripped, pixel-bomb cap) belongs to the Workspace app.
- Derive the delivery URL from the asset with `buildVersionedDeliveryUrl`,
  never from a stored URL or a separate provider call.

## Storage rule

Avatar bytes, URLs, and public IDs never enter Neon. Don't fill
`auth.user.image` or add avatar columns, tables, or JSON fields. The public ID
is computed from the account ID.

## Namespace

The app derives the folder namespace per environment. A preview writes only to
its own commit-scoped namespace; when that scope can't be determined, avatar
mutations fail closed and the account page falls back to initials. No code path
writes to the production namespace from a preview.

## Upload, promotion, and recovery

1. Stage the upload under a unique temporary public ID inside
   `${namespace}-staging/${accountId}/`. The trailing slash keeps a prefix
   delete from matching another account.
2. Rename the staged asset onto the account's fixed live public ID. Never
   upload straight onto the live ID; a bad image would replace a good one.
3. Clean up staging on every known failure after staging succeeds. A
   definitive provider rejection cleans staging and leaves the old avatar.
4. Reconcile before reporting success when the rename outcome isn't
   definitive. Reconciliation compares the provider `asset_id`, which survives
   the rename: an asset at the live ID counts as the promoted upload only when
   its identity matches the staged upload's.
   - Source-missing response: look up the live asset. A matching identity
     means the rename committed, so clean staging and report success. A
     mismatch, a missing identity, or a failed lookup fails retryably.
   - Other ambiguous response: retry the rename once, then reconcile the same
     way. If a different known identity is live, the previous asset remains,
     so clean staging and fail retryably. If no identity can be confirmed,
     destroy nothing and fail retryably.
5. If promotion stays ambiguous, no previous live avatar exists, and staging
   still exists, keep staging as the only recoverable copy. On the next upload,
   `recoverRetainedStaging` promotes it first, but only when the live lookup
   definitively reports no live avatar. A live asset or a failed lookup skips
   recovery, and the stale staging becomes cleanup material. Recovery never
   blocks the fresh upload.

## Locking and deletion

- Upload, remove, and destroy run the whole media critical section (provider
  calls, reconciliation, cleanup) under the account lock and uninterruptibly.
  Upload and remove re-read the verified session inside the lock and require
  the same account ID. That way no provider mutation lands after a concurrent
  account deletion.
- Account deletion destroys the live asset first, then prefix-deletes the
  account's staging prefix. It fails retryably on `uncertain`, a malformed
  response, any result other than `deleted` or `not found`, a repeated
  cursor, or the 25-page limit. `not-found` counts as done.
- An empty Search response doesn't prove the staging prefix is empty:
  Cloudinary documents no consistency guarantee for Search, listing, or prefix
  deletion.
- CDN invalidation takes seconds to minutes. Versioned URLs make the account
  page request the new version after promotion, but a deleted avatar has no
  replacement URL.

## Tests

Package tests mock the Cloudinary SDK module and cover Effect wiring,
pagination, invalidation options, classification, and retries. Workspace
covers locking races in `customer-avatar-concurrency.postgres.test.ts`.
