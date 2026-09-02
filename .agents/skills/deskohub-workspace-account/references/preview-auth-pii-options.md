# Preview authentication PII options

Research date: 2026-09-02

## Finding

The proposed Better Auth database adds two direct personal-data values to Neon:
the login email and the connecting IP address. Names, phone numbers, billing
details, and reservation history remain in Dotypos. A normal Neon child branch
starts with its parent's schema and data, so a production-derived preview branch
can expose the email and IP values that existed at its branch point. Later
deletion in production does not change the already-isolated child branch. See
Neon's [branching workflow primer](https://neon.com/docs/get-started-with-neon/workflow-primer)
and [branching architecture description](https://neon.com/blog/branching-environments-anonymized-pii).

The lowest-change option is to keep the existing integration-owned branch
lifecycle, remove stored IP addresses at the Better Auth boundary, and treat the
remaining email copies as protected authentication data inside the same Neon
processor and access boundary. This requires a narrow exception to the
repository's absolute "no real PII in previews" rule, but no new branch creator,
sanitizer, seed pipeline, or cleanup owner.

This is an engineering recommendation, not a legal conclusion. GDPR requires
data minimisation, storage limitation, and security appropriate to risk; it does
not prescribe a separate database or prohibit all non-production copies. See
[GDPR Articles 5 and 32](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

## Current controls and gaps

The repository already establishes these controls:

- Every Workspace preview is behind Vercel Authentication. Vercel documents
  that this restricts access to authorized team/project users, explicitly
  granted users, shareable-link holders, and automation carrying the bypass
  secret. The repository uses the bypass only for automated preview requests.
  See [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
  and `.agents/skills/deskohub-workspace-e2e/references/preview-workflow.md`.
- The Neon/Vercel integration creates the preview branch and owns deletion. The
  repository resolves only the exact non-primary `preview/<internal-head-ref>`
  branch, fails closed on missing or ambiguous mappings, masks retrieved
  connection strings, and never falls back to production or shared development.
- E2E is limited to an open, internal, non-draft PR and an immutable successful
  Workspace deployment for the exact commit. It uses synthetic identities.
- The protected GitHub environment owns the Neon API credential. Preview
  migration and E2E currently obtain an owner-role connection to the selected
  child branch. This is broad authority by design inside the already-approved
  trusted internal-branch boundary.
- Repository guidance says the integration's automatic deletion of obsolete
  preview branches must remain enabled. Neon documents that the Neon-managed
  integration deletes a preview branch when its Git branch is deleted; the
  Vercel-managed integration deletes it after the last deployment for that Git
  branch is removed. See Neon's [integration cleanup description](https://neon.com/blog/big-dx-improvements-for-neon-users-on-vercel).
- Neon requires encrypted connections and encrypts stored customer data with
  AES-256. See Neon's [security overview](https://neon.com/docs/security/security-overview).

The remaining gaps are bounded but real:

- Deployment Protection controls HTTP access to the app, not direct database
  access by Neon members or holders of a database/API credential.
- Integration deletion is lifecycle cleanup, not immediate data minimisation.
  A branch remains while its corresponding Git branch or retained deployment
  remains, depending on the installed integration.
- A production account deletion cannot delete an email already present in an
  isolated preview child; it disappears when that child is deleted.
- The repository records the required integration settings but cannot prove the
  current dashboard state. Provisioning verification should confirm Deployment
  Protection and automatic obsolete-branch deletion without changing ownership
  of the lifecycle.
- Better Auth 1.7.2 stores session IPs and uses IP-plus-path rate-limit keys by
  default. Setting `disableIpTracking` also disables its IP-based limiter, so
  removing IP storage safely needs a small replacement rather than that flag
  alone. See the pinned [IP resolver](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/utils/ip.ts)
  and [rate limiter](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/rate-limiter/index.ts).

## Options

| Option | Branch lifecycle impact | What it achieves | How it can fail |
| --- | --- | --- | --- |
| Keep production-derived branches and strengthen the existing boundary | None | Preserves production-shaped data and the current Neon/Vercel lifecycle. With session IP suppressed and database rate-limit keys HMACed, only login email remains directly identifying. Separate Preview and Production Better Auth secrets prevent auth-cookie trust from being shared across environments. | Email still exists in each child until integration deletion. Any person or credential with child-database access can read it. A forgotten Git branch can extend retention. This option requires the repository policy and privacy record to describe the narrow exception honestly. |
| Use Neon's anonymized branches | Replaces or wraps integration branch creation | Neon statically rewrites selected columns on a new branch; email and IP can be masked while other data remains production-shaped. Neon supports console, API, and GitHub Action creation. | Anonymized branches remain beta. Masking is asynchronous, adds a readiness state, and current docs advise caution around unique/non-null columns. The existing integration does not document automatic masking of its branches, so adopting it means a new branch owner or an anonymized parent. See [Neon data anonymization](https://neon.com/blog/branching-environments-anonymized-pii) and the [current limitations](https://neon.com/blog/practical-guide-to-database-branching). |
| Point previews at a long-lived anonymized parent | Integration can keep creating/deleting PR children if it supports selecting that parent | Per-PR lifecycle stays automatic after initial setup; each PR inherits already-masked data. | The parent becomes another environment to refresh and migrate. Neon says anonymized branches cannot currently reset to their parent, so keeping it current requires replacement or another synchronization procedure. Drift can hide migration and data-shape failures. Support for selecting this parent must be verified for the installed integration before relying on it. |
| Use schema-only branches plus synthetic seeds | Replaces or reconfigures branch creation | No production rows enter previews. | Workspace currently relies on production-shaped, non-PII application data as well as branch-specific migrations. Every required row must be seeded and maintained. This creates a new provisioning path and can make previews Ready before their data exists. Neon itself notes the added seeding complexity. See [schema-only branches](https://neon.com/blog/instant-branches-schema-only-or-with-data-the-choice-is-yours). |
| Sanitize each ordinary child after creation | Adds a post-create mutation step | Keeps the current integration's branch creation and can remove only `auth` email/IP rows. | The preview is already Ready before the repository's migration job runs, leaving a window in which copied PII is reachable. Failed or skipped sanitization leaves real data in place; destructive SQL must track every future PII column. This is precisely the extra failure-prone procedure the product wants to avoid. |
| Encrypt/tokenize the Better Auth email in application storage | None | A branch without the Production encryption key would contain unreadable ciphertext or a keyed token. | Better Auth expects a normalized, unique email for lookup and returns it through session/user APIs. Making this work requires a custom adapter or database transform across sign-in, verification, session, and deletion paths. Deterministic lookup also leaks equality. It is disproportionate for one email column and increases authentication risk. |
| Move auth to separate storage | Breaks the agreed same-database design | Production database branches would no longer copy auth identities. | It recreates the original preview-environment coordination problem: a second connection, migration lifecycle, and per-preview storage mapping. It also separates the auth identity from its local link transaction. |

Row-level security, a lower-privilege runtime role, or dynamic masking can reduce
who can query a child but cannot make the copied PII cease to exist. They are
ordinary least-privilege improvements, not answers to an absolute no-PII rule.
Neon IP Allow or Private Networking likewise narrows network access but may add
cost and conflicts with variable Vercel egress unless designed around it.

## Recommended implementation contract

1. Keep the Neon/Vercel integration as the sole creator and deleter of Workspace
   preview branches. Do not add schema-only, masking, post-create sanitization,
   or a second database to the first account release.
2. Amend the repository rule narrowly: preview databases may inherit only the
   minimum Better Auth login email needed for production-shaped authentication;
   customer profile, billing, phone, and reservation PII remains prohibited and
   E2E-created data remains synthetic.
3. Do not persist a raw client IP in sessions or rate-limit rows. Preserve
   distributed database rate limiting by HMACing the IP-plus-route key before
   its atomic database consume operation, and discard the raw session IP through
   Better Auth's supported database hook. Use a separate purpose-specific HMAC
   key or a domain-separated derivation, never a plain unsalted hash.
4. Use separate Preview and Production Better Auth secrets. Keep auth cookies
   host-only and keep real-recipient sending disabled in Preview; Preview auth
   delivery accepts only the approved synthetic E2E address pattern.
5. Keep Vercel Authentication and integration-owned obsolete-branch deletion
   enabled. Do not create shareable preview links. Treat Neon/Vercel membership,
   GitHub environment access, and database credentials as production-data access
   because an email clone is present.
6. State in the internal privacy/retention record that production deletion does
   not propagate to existing Neon children and that the integration deletes the
   remaining copy with the preview branch. Do not imply immediate deletion from
   every historical child.
7. Add one provisioning check to the release checklist—not a new lifecycle
   process—to confirm the existing protection and automatic-cleanup settings.

This recommendation knowingly chooses containment over elimination. If policy
or counsel requires zero production email in every child, use Neon anonymized
branches when their beta status, integration support, unique-email behavior,
and readiness ordering are proven; otherwise schema-only plus seeds is the only
clear elimination path. Both are materially larger than the current workflow.
