# Customer account avatars

## Purpose

Customers can attach one avatar image to their account. The avatar personalizes the account area without creating a second copy of customer identity data: the profile remains Dotypos state, the login identity remains Better Auth state, and the avatar image itself lives only in the media provider.

## Input policy

- Accepted upload formats are JPEG, PNG, and WebP. Every other format is rejected before any bytes leave the application boundary.
- The raw upload is limited to 2 MiB. Larger uploads are rejected without processing.

## Server boundary normalization

All avatar bytes pass through a server-side normalization step before storage:

- Output is WebP.
- Output is resized to at most 512x512 pixels; the aspect ratio is the customer's, the bound is ours.
- A pixel-dimension cap rejects pixel bombs: an input whose declared or decoded dimensions exceed the cap is rejected rather than decoded into memory.
- All metadata (EXIF, GPS, color profiles, embedded thumbnails) is stripped.

The normalized image, not the customer's original bytes, is what reaches storage.

## Storage and namespaces

- Avatar assets are stored in Cloudinary through signed, server-side uploads only. Upload credentials never reach the browser.
- Each account has exactly one fixed, account-ID-derived public ID. There is no per-upload public ID stored anywhere.
- Environments use distinct folder-prefix namespaces (production, preview, development). A preview deployment writes only to its own commit/deployment-scoped namespace when one is available; if that namespace cannot be determined, the avatar feature fails closed. It never falls back to the production namespace.
- No avatar bytes, URLs, or public IDs are stored in Neon. The Better Auth `auth.user.image` column stays unfilled, and no workspace table mirrors avatar state.

## Upload lifecycle

1. The upload is staged under a unique temporary public ID.
2. The server normalizes the staged asset at the boundary.
3. The normalized asset is promoted to the account's fixed live public ID.
4. Staged assets are cleaned up when validation or promotion fails.

A failed validation or a failed promotion must never damage the previous live avatar. The customer keeps their old avatar until a new one is fully promoted.

## Reconciliation honesty

Cloudinary does not document rename/overwrite as atomic. The reconciliation approach is therefore stated honestly:

- A non-success promotion outcome is treated as uncertain, not as failure or success.
- Uncertain outcomes are retryable; retries are safe because promotion targets a fixed public ID and staging is idempotent.
- Nothing in the product claims transactional guarantees: the UI and logs must not report a swap as completed until the provider confirms the live asset.
- A previous avatar remains intact unless the provider confirms the promotion of the new one.

## Delivery

- The account page renders the versioned delivery URL taken from the current asset lookup or upload response, never a cached unversioned URL. This avoids stale CDN copies after a promotion.
- The account page loads only the current account's asset.
- When no avatar exists, or the read fails, the page falls back to the customer's initials. A media outage never blocks the account page.

## Deletion

- The Cloudinary account asset is removed before the Better Auth identity is removed.
- An uncertain provider deletion outcome fails retryably; deletion of the identity does not proceed on an uncertain media state.
- Deletion is idempotent when the asset is already missing.
- The existing Dotypos-first deletion marker and the advisory-lock race invariants of account deletion are unchanged.

## Access

Avatar images are publicly readable through their delivery URL, without authentication. This is an accepted trade-off: the URL carries a random account-derived identifier, no personal data beyond the chosen picture, and no access is gained to any other account data.

## Logging

Logs never contain raw image bytes, Admin-API raw error payloads, or provider asset identifiers beyond what the fixed-code logging policy allows.
