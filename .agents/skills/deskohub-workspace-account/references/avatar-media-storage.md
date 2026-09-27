# Avatar media storage implementation

Durable implementation guidance for customer account avatars. The
business-facing policy lives in the Workspace business specification
(`apps/deskohub-workspace/docs/customer-account-avatars.md`); this note covers
how the code honors it.

## Package boundary

- All provider calls go through `@deskohub/cloudinary`. The package exposes
  `uploadImage`, `destroyAsset`, `renameAsset`, and the sanitized
  `listFolderAssets` on `CloudinaryService` alongside
  the existing search capability. They share one service class because they
  share the configured SDK, the runtime config layer, and the transient-retry
  policy; a sibling service would duplicate that wiring without a distinct
  contract. Avatar paths only ever use the sanitized executors
  (`getByPublicId`, `listFolderAssets`, `uploadImage`, `destroyAsset`,
  `renameAsset`), which emit fixed identifier-free log messages.
- Error contract: `CloudinaryUploadError`, `CloudinaryDestroyError` (with an
  `uncertain`/`failed` outcome), and `CloudinaryRenameError` (with a
  `target-exists`/`source-missing`/`failed` reason). Retry policy retries only
  5xx-style failures; 4xx failures are definitive and never retried.
- `destroyAsset` returns `destroyed` or `not-found` as a closed outcome union;
  an unrecognized provider response or an exhausted retry sequence surfaces as
  an `uncertain` error so callers can fail retryably and honestly.
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
- Deletion destroys the live asset first, then drains the account's
  staging folder completely: the sweep lists bounded batches
  (`maxResults: 8`) and destroys them, looping until a listing verifies
  the folder is empty (bounded by an internal iteration cap). Deletion
  must never succeed with staged customer images left stored: any listing
  or destroy failure — or exhausting the iteration cap — fails retryably
  BEFORE identity removal, so the durable deletion marker persists and the
  deletion can be retried. The live destroy is the authoritative media
  step, but it is not a license to leave recoverable staging behind.
  `searchByFolder`-style listing ordering is provider-defined; the code
  does not rely on any particular order. Staging listing goes through the
  sanitized folder-listing call, which never logs the account-bearing
  folder, asset identities, URLs, raw provider responses, or provider
  failure text.
- Avatar mutations (upload, remove, destroy) run the whole media critical
  section — provider calls, reconciliation, and cleanup — under the account
  advisory lock and uninterruptibly: an interruption cannot release the lock
  while a provider rename, upload, or destroy is still in flight, so no late
  provider mutation can land after a concurrent deletion destroyed the
  avatar and removed the identity. There is no late rename after deletion.
- Deletion removes the Cloudinary asset before Better Auth identity removal,
  fails retryably on `uncertain`, and accepts `not-found` as done.

## Storage prohibition

No avatar bytes, delivery URLs, or public IDs enter Neon. Do not fill
`auth.user.image`. Do not add avatar columns, tables, or JSONB fields. The
account-ID-derived public ID is computed, so there is nothing to persist.

## Testing boundary

Package tests mock the Cloudinary SDK module; they verify Effect wiring,
classification, and retry behavior, not provider integration. Avatar E2E
coverage belongs to the workspace protected-preview lane once the feature
stage lands.
