# Privacy and retention

Use this when you change what account data is stored, how long it lives, or
what the privacy copy promises. Privacy copy lives in
`features/legal/content.tsx`; update `en-US` and `cs-CZ` together.

## What each system holds

| System | Holds | Removal |
| --- | --- | --- |
| Neon `auth` schema | Login email, hashed verification token with the email in its value, sessions without IP or user agent, `IP\|path` rate-limit keys | Better Auth deletes identity rows on account deletion; the daily `auth-cleanup` cron removes expired sessions, verifications, and stale rate-limit rows |
| Neon `public.customer_account_links` | Two opaque IDs | Cascades with the auth user |
| Neon `public.customer_accounts` | Account ID, deletion instant | Kept as a deleted-account tombstone so reservations keep their author |
| Neon administrator records (`account_role_grants`, account actors on CLI authentication requests and sessions, standalone access-code events, and `manual_invoice_actors`) | Account ID, role, and the administrator's login-email snapshot as provenance | Grants cascade with the auth user; actor account IDs are set to null and the email snapshot stays with the audit record |
| Dotypos | Profile and reservation history | Account deletion sets the profile's expiry; retained records stay |
| Resend | Sent message, recipient, delivery metadata | Provider retention only; Workspace keeps no copy |
| Cloudinary | Avatar asset | Destroyed before identity removal |
| PostHog warehouse | Allowlisted Dotypos customer fields in `custom.dotypos_customers` | PostHog retention settings; a Dotypos deletion arrives as `deleted: true`, not erasure |

## Rules

- State retention as a scheduled cleanup, not as instant deletion on expiry.
  Current settings: 30-day rolling sessions refreshed at most daily, 10-minute
  magic-link validity, daily cleanup of expired rows, identity rows kept until
  the customer deletes the account.
- Account deletion expires the Dotypos profile and removes the live login
  account. Don't promise automatic Dotypos deletion after any period: the
  Dotypos Customer API documents no retention or anonymization behavior for
  `expireDate`. Never delete or anonymize the Dotypos customer or its
  reservation, payment, invoice, or legal records.
- In privacy copy, name Resend as the email processor and disclose:
  - The recipient address, message content including the magic link, and
    delivery metadata.
  - Storage in the United States.
  - The applicable 30-day active-account retention and seven-day backups.
  - That account deletion can't erase an already-sent email (Resend publishes
    no sent-message delete API), and that an exceptional early-removal request
    goes through Resend's contact process.
- Don't mirror Resend message bodies or delivery events into Workspace.
- Neon preview branches copy production data at the branch point, and later
  production deletions don't reach existing branches. The allowed contents,
  including `auth.passkey` rows and their customer-written labels, and the
  no-sanitizer rule are in the root `AGENTS.md`. Rely on the
  integration's preview-branch cleanup; don't add a scrub job, PII-free
  parent, branch reset job, or masking branch. Never query, log, display, or
  email inherited real identities during E2E.
- Because preview-branch cleanup is the retention control, check the Neon
  integration as an operations task: the production branch is protected,
  automatic cleanup of obsolete preview branches is on, and neither setting has
  drifted.
- Avatars never enter Neon. See [avatar media storage](avatar-media-storage.md).
- PostHog has its own retention and erasure limits. See
  [PostHog identity and privacy](posthog-identity-privacy.md).
