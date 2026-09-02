# Authentication data ownership and retention

Research date: 2026-09-02

This note records the data-processing facts needed to plan Workspace customer
accounts with Better Auth 1.7.2. It does not change the product or implement a
cleanup job.

## Recommended contract

Use the following contract for the implementation plan:

| Data | Owner and purpose | Active retention | Account deletion |
| --- | --- | --- | --- |
| Better Auth user and account rows | Better Auth is the authentication source of truth. It stores identity, verified email, and authentication method data. | Account lifetime. | Hard-delete immediately after Dotypos deactivation succeeds. Delete linked sessions and the local account link in the same deletion workflow. |
| Better Auth sessions | Workspace stores the server-side login token, user ID, expiry, IP address, and user agent. | Seven-day sliding validity. Run a daily database cleanup so an expired row remains for no more than 24 hours after expiry. Logout and account deletion delete live sessions immediately. | Delete all sessions immediately. |
| Better Auth magic-link verification rows | Workspace stores a hashed token identifier, expiry, and a JSON value containing the email and optional name. | The link is valid for 10 minutes and one use. Run the same daily cleanup so an unused row remains for no more than 24 hours after expiry. | Delete verification rows attributable to the account email during account deletion. The cleanup must also handle rows that cannot be attributed after user deletion. |
| Better Auth rate-limit rows | Workspace stores a key made from the client IP address and auth route, a count, and the last-request timestamp. | Keep only the longest configured rate-limit window, with the daily cleanup as a backstop. | These rows have no user foreign key. Do not attempt account-specific deletion; age them out under the global policy. |
| Workspace `customer_account_links` | Workspace maps one Better Auth user ID to one Dotypos customer ID. It contains no copied profile fields. | Account lifetime. | Delete with the Better Auth account. |
| Dotypos customer profile | Dotypos remains the profile and reservation-history source of truth. It stores name, email, optional phone, billing details, and reservation associations. | Dotypos and Deskohub legal/operational retention rules apply. | Set `expireDate` to deactivate the customer. Do not state that Dotypos erases it after one year unless Dotypos confirms that policy in writing. |
| Resend magic-link email | Resend processes recipient and sender addresses, subject, message body containing the bearer link, delivery state, and related logs. | Resend states 30 days for email and log data on Free, Pro, and Scale plans. Backups persist for seven days. | Deletion of the Workspace account does not delete a sent message. Contact Resend for early message removal when a data-subject request requires it. |
| Neon preview branches | Neon stores a copy-on-write clone of parent schema and data, including authentication and profile-link rows. | Until the preview branch is deleted or reaches its configured expiry. | Production deletion does not propagate to an already-created child branch. Preview cleanup must delete the branch on PR close and apply a bounded branch expiry as a backstop. |

Disable open and link tracking for authentication email. It is unnecessary for
sign-in and would add recipient IP address, location, device, browser, and email
client data to Resend's processing.

The daily database cleanup is not optional if the privacy notice gives bounded
retention periods. Better Auth's built-in cleanup is request-driven, so quiet
tables can retain expired rows past their validity period.

## Better Auth 1.7.2 facts

The [core database schema](https://better-auth.com/docs/concepts/database#core-schema)
stores:

- `user`: ID, name, email, verified-email flag, optional image, and created and
  updated timestamps;
- `session`: ID, user ID, unique session token, expiry, optional IP address and
  user agent, and timestamps;
- `account`: local row ID, user ID, identity namespace and provider IDs,
  optional OAuth tokens and expiries, scope, optional password, and timestamps;
- `verification`: ID, identifier, value, expiry, and timestamps.

Magic-link-only accounts do not need a password or OAuth token, but the account
table remains part of the generated core schema. The
[session guide](https://better-auth.com/docs/concepts/session-management#session-table)
confirms that Better Auth stores the request IP address and user-agent header.

The 1.7.2
[magic-link source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/magic-link/index.ts)
creates a verification row whose value contains the requested email and
optional name. It passes the raw token and bearer URL to the email callback.
Configure token storage as `"hashed"`. The email still necessarily contains
the redeemable URL.

Verification is one-time because 1.7.2 consumes the row atomically on the first
verification attempt. An expired attempted token is also consumed. The
[`verification.disableCleanup` option](https://better-auth.com/docs/reference/options#verification)
explains the remaining retention behavior: with cleanup enabled, Better Auth
deletes expired values when a verification value is fetched. This is a global,
opportunistic cleanup, not a scheduled expiry guarantee.

Database rate limiting uses the client IP address. The
[rate-limit schema](https://better-auth.com/docs/concepts/rate-limit#schema)
stores `id`, unique `key`, `count`, and `lastRequest`. In 1.7.2 the key is the
normalized IP address joined to the request path. Database pruning runs after
a stale rate-limit key is used again. A quiet table therefore also needs the
daily retention cleanup.

Better Auth gives sessions a seven-day sliding expiry by default. The
[session-expiration documentation](https://better-auth.com/docs/concepts/session-management#session-expiration)
states that expiry refreshes after the configured update age. Its route reads
delete an expired session when that session is presented. They do not sweep
all expired sessions.

The [`deleteUser` documentation](https://better-auth.com/docs/concepts/users-accounts#delete-user)
defines account deletion as permanent database deletion and exposes a
`beforeDelete` callback that can stop deletion. The pinned 1.7.2 internal
adapter deletes the user's session and account rows before deleting the user.
Verification and rate-limit rows have no user foreign key and are outside that
automatic deletion path. The Workspace workflow must deactivate Dotypos in
`beforeDelete`, fail closed if Dotypos fails, then hard-delete Better Auth data
and the local link.

Better Auth telemetry is
[disabled by default](https://better-auth.com/docs/reference/telemetry). Keep it
disabled for this feature.

## Neon branch copies

Neon's
[branching workflow primer](https://neon.com/docs/get-started-with-neon/workflow-primer)
says a normal child branch has the parent's schema and all its data. It also
says branch changes do not affect the parent. The inverse matters for erasure:
deleting an account in production does not delete the row from a child that
already cloned it.

Neon supports
[automatic branch expiry](https://neon.com/blog/expire-neon-branches-automatically),
which deletes the branch at the configured time. Every preview branch that may
contain identity data needs both PR-close deletion and an expiry backstop.

The repository currently says preview databases must contain synthetic data
only. Normal production-parent branching conflicts with that rule because it
copies names, emails, session tokens, verification values, IP addresses, and
the account-to-Dotypos mapping. Neon offers
[schema-only and anonymized branches](https://neon.com/blog/branching-environments-anonymized-pii),
but anonymizing active authentication records changes or invalidates those
records. The implementation plan must choose a preview topology that satisfies
the repository rule. It cannot describe ordinary production-data clones as
synthetic.

## Resend processing and retrieval

Resend's [GDPR statement](https://resend.com/security/gdpr) says it stores
message content, delivery logs, webhook payloads, and account records in the
United States. Selecting an EU sending region changes routing, not storage. It
states that active Free, Pro, and Scale accounts retain email and log data for
30 days, Enterprise retention is configurable, backups persist for seven days,
and customers can request earlier removal of a specific message. Remaining
customer data is deleted within 90 days after account termination.

The Resend
[data-processing addendum](https://resend.com/legal/dpa) lists metadata, email
address, and message content as the minimum processed data. Optional tracking
may add IP address, location, operating system, browser, device, email client,
and spam-complaint data.

The [list-sent-emails API](https://resend.com/docs/api-reference/emails/list-emails)
returns email ID, recipients, sender, creation time, subject, CC, BCC,
reply-to, latest delivery event, and scheduled time. The
[retrieve-email API](https://resend.com/docs/api-reference/emails/retrieve-email)
also returns HTML, plain text, and tags. A full-access key used by protected E2E
can therefore retrieve the magic-link bearer URL during Resend's retention
window. Keep that key only in the trusted GitHub run and never log the response.

## Dotypos facts and missing evidence

The official [Customer API](https://docs.api.dotypos.com/entity/customer/)
defines customer contact and billing fields and the nullable `expireDate`
field. It also documents `DELETE /customers/:customerId` with an optional
`anonymize` query parameter. Dotypos's
[April 2026 Cloud release notes](https://manual.dotypos.com/vzdalena-sprava-26_5.html)
describe permanent customer anonymization for GDPR use.

No public Dotypos API, manual, privacy, or contract page found in this research
defines automatic hard deletion or anonymization one year after `expireDate`.
Dotypos's software terms state a broad maximum of ten years after its merchant
licensing agreement ends for the merchant's personal, identification, and
operating data. Those terms do not define the lifecycle of an individual
merchant-entered customer row. See
[section 6.5 of the Dotypos software terms](https://www.dotypos.com/general-terms-and-conditions-software-product/).

The one-year cleanup claim is therefore unsupported. The product may still
choose reversible soft deactivation so a later verified signup can reactivate
the profile, but its privacy notice must say the profile is deactivated and
retained under Dotypos/Deskohub policy. A separate erasure request may need the
documented permanent anonymization path.

## Decisions still needed

1. Confirm that a daily cleanup with a 24-hour overrun after auth-record expiry
   is acceptable, and select the existing scheduled-job mechanism that owns it.
2. Resolve the conflict between cloned production identity data and the
   repository's synthetic-only preview rule. The compliant choices are a
   synthetic/schema-only preview parent or a reviewed anonymization policy,
   plus branch expiry.
3. Ask Dotypos to confirm whether `expireDate` starts any vendor-managed
   retention clock. Until it does, treat soft-expired profiles as retained
   indefinitely and support permanent anonymization for a valid erasure
   request.
4. Confirm that authentication email tracking stays disabled and that the
   public privacy notice names Resend's United States storage and 30-day active
   retention.

