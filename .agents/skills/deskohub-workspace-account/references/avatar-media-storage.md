# Avatar media storage implementation

Durable implementation guidance for customer account avatars. The
business-facing policy lives in the Workspace business specification
(`apps/deskohub-workspace/docs/customer-account-avatars.md`); this note covers
how the code honors it.

## Package boundary

- All provider calls go through `@deskohub/cloudinary`. The package exposes
  `uploadImage`, `destroyAsset`, `renameAsset` on `CloudinaryService` alongside
  the existing search capability. They share one service class because they
  share the configured SDK, the runtime config layer, and the transient-retry
  policy; a sibling service would duplicate that wiring without a distinct
  contract.
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
- Clean up the staged asset on every failure path after staging succeeded.
- Treat a rename failure as uncertain; retry the promotion instead of
  reporting the swap as done, and never delete the staged asset while the
  promotion outcome is unknown and the old avatar is gone.
- When a promotion fails with no previous live avatar, the staged asset is
  retained as the only recoverable copy instead of destroyed. The next
  upload recovers it first: `recoverRetainedStaging` promotes the newest
  retained staging asset onto the live ID before anything new is staged.
  Recovery is best-effort; a failed recovery never blocks the fresh upload.
- Deletion destroys the live asset first, then sweeps the account's staging
  folder. The sweep is bounded: one `searchByFolder` call with `maxResults`
  set to 8, destroying only the listed assets. An overflow of retained
  staging beyond the bound never fails deletion — the live destroy is the
  authoritative step. `searchByFolder` ordering is provider-defined; the
  code does not rely on any particular order.
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
