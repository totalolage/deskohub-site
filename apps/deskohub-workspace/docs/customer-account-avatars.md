# Customer account avatars

## Purpose

Customers can attach one avatar image to their account. The avatar personalizes the account area without creating a second copy of customer identity data: the profile remains Dotypos state, the login identity remains Better Auth state, and the avatar image itself lives only in the media provider.

## Input policy

- Accepted declared and decoded formats are JPEG, PNG, and WebP. Unsupported declarations and bytes that do not decode as a supported image are rejected before upload.
- Both the declared size and actual byte length must be at most 2 MiB. Larger uploads are rejected without image decoding or provider calls.

## Server boundary normalization

All avatar bytes pass through a server-side normalization step before storage:

- Output is WebP.
- Output is resized to at most 512x512 pixels; the aspect ratio is the customer's, the bound is ours.
- A decoded-pixel and dimension cap rejects pixel bombs before pixel data is decoded into memory.
- All metadata (EXIF, GPS, color profiles, embedded thumbnails) is stripped.

The normalized image, not the customer's original bytes, is what reaches storage.

## Storage and namespaces

- Avatar assets are stored in Cloudinary through signed, server-side uploads only. Upload credentials never reach the browser.
- Each account has exactly one fixed, account-ID-derived public ID. There is no per-upload public ID stored anywhere.
- Environments use distinct folder-prefix namespaces (production, preview, development). A preview deployment writes only to its immutable commit/deployment-scoped namespace when one is available; if that identity is missing or blank, the avatar feature fails closed. It never falls back to the production namespace.
- Preview media uses synthetic accounts and images only; production avatar media is never copied into preview.
- No avatar bytes, URLs, or public IDs are stored in Neon. The Better Auth `auth.user.image` column stays unfilled, and no workspace table mirrors avatar state.

## Upload lifecycle

1. The server validates the declared and actual input limits, then normalizes the image before any provider call.
2. The normalized bytes are uploaded through the signed server-side API under a unique temporary staging public ID.
3. The staged asset is promoted to the account's fixed live public ID.
4. Known failures trigger staging cleanup. If cleanup itself is uncertain, the operation remains retryable and the staging folder is drained before account identity deletion.

Invalid input and known pre-promotion failures leave the previous live avatar untouched. Do not upload directly to the live public ID.

## Reconciliation honesty

Cloudinary does not document rename/overwrite as atomic. The reconciliation approach is therefore stated honestly:

- Cloudinary rename/overwrite is not documented as atomic. A non-success promotion outcome is uncertain, not proof of failure or success.
- Reconcile an ambiguous result using the immutable provider asset identity: the live asset counts as the new upload only when its identity matches the staged asset. Missing identity or a failed lookup remains retryable without cleanup while the outcome is unknown. After an ambiguous retry, a different known live identity proves the previous avatar remains; clean staging and report a retryable failure.
- A definitively uncommitted promotion may clean up staging while preserving the old live asset. If no prior live avatar exists and a staged asset remains the only recoverable copy, retain it for the next retry.
- Nothing in the product claims transactional guarantees. UI and logs report a swap as complete only after provider confirmation or identity-checked reconciliation.

## Delivery

- The account page renders the versioned delivery URL taken from the current asset lookup or upload response, never a cached unversioned URL. This avoids stale CDN copies after a promotion.
- The account page loads only the current account's asset.
- When no avatar exists, or the read fails, the page falls back to the customer's initials. A media outage never blocks the account page.

## Authorization and concurrency

- Upload and remove require a verified linked account resolved from the authoritative Better Auth session. The client supplies only the image file; account IDs and avatar URLs are never accepted as authority.
- Recheck account activity under the account advisory lock before mutation. The deletion marker prevents new avatar changes, and upload, remove, and account deletion serialize their complete media operations under that lock.

## Deletion

- The Cloudinary live asset and retained staging media are removed before the Better Auth identity is removed.
- An uncertain provider deletion outcome fails retryably; deletion of the identity does not proceed on an uncertain media state.
- Deletion is idempotent when the asset is already missing.
- The existing Dotypos-first deletion marker and the advisory-lock race invariants of account deletion are unchanged.

## Access

Avatar images are publicly readable through their delivery URL, without authentication. This is an accepted trade-off: the URL carries a random account-derived identifier, no personal data beyond the chosen picture, and no access is gained to any other account data.

## Logging

Logs never contain raw image bytes, Admin-API raw error payloads, or provider asset identifiers beyond what the fixed-code logging policy allows.
