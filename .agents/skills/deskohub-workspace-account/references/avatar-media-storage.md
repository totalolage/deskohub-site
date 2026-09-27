# Avatar media storage implementation

Durable implementation guidance for customer account avatars. The
business-facing policy lives in the Workspace business specification
(`apps/deskohub-workspace/docs/customer-account-avatars.md`); this note covers
how the code honors it.

## Package boundary

- All provider calls go through `@deskohub/cloudinary`. The package exposes
  `uploadImage`, `destroyAsset`, `deleteResourcesByPublicIdPrefix`,
  `renameAsset`, and the sanitized `listFolderAssets` on `CloudinaryService`
  alongside the existing search capability. They share one service class
  because they share the configured SDK, the runtime config layer, and the
  transient-retry policy. A sibling service would duplicate that wiring
  without a distinct contract. Avatar paths use only executors that emit fixed
  identifier-free log messages: `getByPublicId`, `listFolderAssets`,
  `uploadImage`, `destroyAsset`, `deleteResourcesByPublicIdPrefix`, and
  `renameAsset`.
- Error contract: `CloudinaryUploadError`, `CloudinaryDestroyError`,
  `CloudinaryPrefixDeleteError`, and `CloudinaryRenameError`. Destroy and
  prefix-delete errors carry an `uncertain` or `failed` outcome. Rename errors
  carry a `target-exists`, `source-missing`, or `failed` reason. Retry policy
  retries only 5xx-style failures; 4xx failures are definitive and never
  retried.
- `destroyAsset` sets Cloudinary's `invalidate` option and returns `destroyed`
  or `not-found` as a closed outcome union;
  an unrecognized provider response or an exhausted retry sequence surfaces as
  an `uncertain` error so callers can fail retryably and honestly.
- `deleteResourcesByPublicIdPrefix` deletes only image uploads whose public IDs
  start with the supplied prefix. It validates each response, follows the
  provider's `next_cursor`, rejects repeated cursors, and fails after 25 pages
  if the provider still reports a partial delete. Prefixes do not enter logs or
  errors. Cloudinary documents a maximum of 1,000 original resources per
  request but does not document list or delete consistency guarantees.
- Normalization (sharp, WebP, 512x512, metadata stripping, pixel-bomb cap)
  belongs to the Workspace application boundary, not the package. The package
  transports bytes; it never interprets image content.
- The versioned delivery URL is derived from the asset itself
  (`buildVersionedDeliveryUrl`), never from a separate provider call and never
  from a stored URL.

## Namespace fail-closed rule

The workspace app derives the folder prefix per environment. When the
preview's immutable commit/deployment scope cannot be determined, avatar
upload must fail closed. There is no code path that uploads to or promotes
within the production namespace from a preview.

## Sequencing rules callers must keep

- Stage upload under a unique temporary public ID, normalize, then rename to
  the account's fixed live public ID. Never upload directly onto the live ID:
  a bad image would replace a good one.
- Clean up the staged asset on every known failure after staging succeeds. If
  a promotion outcome is ambiguous, keep staging while it may be the only
  recoverable copy; reconcile before cleanup.
- Treat ambiguous rename failures as uncertain; retry and reconcile before
  reporting the swap as done. A definitive provider rejection cleans staging
  while leaving the old avatar untouched. Never delete the staged asset while
  the promotion outcome is unknown and the old avatar is gone.
- When promotion remains ambiguous, no previous live avatar exists, and the
  staged source is still present, retain it as the only recoverable copy
  instead of destroying it. The next
  upload recovers it first: `recoverRetainedStaging` promotes the retained
  staging asset onto the live ID before anything new is staged, but ONLY
  when the live lookup definitively reports that no live avatar exists. A
  live asset (recovery would overwrite a newer image with an older
  retained one) and a lookup failure (outcome unknown) both skip recovery;
  the stale staging then becomes cleanup material for deletion. Recovery
  is best-effort; a failed or skipped recovery never blocks the fresh
  upload.
- Promotion reconciliation is identity-checked. The staged asset's
  immutable provider `asset_id` survives the rename, so an asset found at
  the live ID after an ambiguous rename outcome counts as the promoted
  upload only when its identity matches. On a source-missing response, a
  mismatch, a missing identity, or a failed live lookup stays uncertain:
  nothing is destroyed and the operation fails retryably. After an ambiguous
  retry, a different known live identity proves the previous asset remains,
  so staging is cleaned and the operation fails retryably. "Any asset at the
  live ID" is never proof of promotion, because the non-atomic rename contract
  cannot distinguish the new upload from the previous live image.
- Deletion destroys the live asset first, then calls
  `deleteResourcesByPublicIdPrefix` with the account's staging prefix ending
  in `/`. The Cloudinary SDK sends the prefix and each returned cursor to the
  Admin API. Deletion fails retryably before identity removal if a response is
  malformed, any result is not `deleted` or `not found`, a request fails, a
  cursor repeats, or the 25-page limit is reached. An empty Search response is
  not evidence that the staging prefix is empty. Cloudinary Search reflects
  changes within a few seconds but documents no hard upper bound or snapshot
  guarantee. The code makes no consistency claim about prefix deletion or
  resource listing.
- Staging upload IDs remain unique under the exact account prefix
  `${namespace}-staging/${accountId}/`. The trailing slash prevents a prefix
  delete from matching another account with a similar ID.
- Avatar mutations (upload, remove, destroy) run the whole media critical
  section — provider calls, reconciliation, and cleanup — under the account
  advisory lock and uninterruptibly. Upload and remove also re-read the
  authoritative verified session inside the lock and require its account ID to
  match. An interruption cannot release the lock while a provider rename,
  upload, or destroy is still in flight, so no late provider mutation can land
  after a concurrent deletion destroyed the avatar and removed the identity.
  There is no late rename after deletion.
- Deletion removes the Cloudinary asset before Better Auth identity removal,
  fails retryably on `uncertain`, and accepts `not-found` as done.
- A destroy request asks Cloudinary to invalidate cached copies. Cloudinary
  documents propagation that usually takes seconds to minutes. Versioned URLs
  make the account page request a new asset version after promotion, but
  invalidation is not instant and deletion has no replacement versioned URL.

## Storage prohibition

No avatar bytes, delivery URLs, or public IDs enter Neon. Do not fill
`auth.user.image`. Do not add avatar columns, tables, or JSONB fields. The
account-ID-derived public ID is computed, so there is nothing to persist.

## Testing boundary

Package tests mock the Cloudinary SDK module; they verify Effect wiring,
prefix-delete pagination, invalidation options, classification, and retry
behavior, not provider integration. Avatar E2E coverage belongs to the
workspace protected-preview lane once the feature stage lands.
