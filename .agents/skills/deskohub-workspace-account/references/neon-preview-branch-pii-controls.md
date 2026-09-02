# Neon preview branches containing authentication PII

Research snapshot: 2026-09-02. This note evaluates Neon-native controls for
ordinary Vercel preview branches that inherit authentication email and IP data
from production. It deliberately excludes a separate preview parent and a
custom post-clone scrub job.

## Recommendation

Keep the existing production-to-preview branch workflow. Treat each preview
branch as a short-lived copy inside the same controlled Neon project, and rely
on controls that do not add a new provisioning path:

1. Protect the production branch on a paid Neon plan. Neon then generates new
   passwords for matching Postgres roles in each child branch, while the Vercel
   integration injects the child connection string into that preview. A leaked
   preview database credential therefore does not authenticate to production.
   Resetting or restoring the child preserves its child password
   ([protected branches](https://neon.com/docs/guides/protected-branches),
   [Neon-managed Vercel integration](https://neon.com/docs/guides/neon-managed-vercel-integration#how-preview-branching-works)).
2. Keep the integration's existing automatic preview-branch cleanup enabled.
   This is the retention boundary for the copy. Do not add a second deletion
   workflow unless monitoring later demonstrates that integration cleanup is
   unreliable
   ([Neon-managed cleanup](https://neon.com/docs/guides/neon-managed-vercel-integration#branch-cleanup),
   [Vercel-managed cleanup](https://neon.com/blog/big-dx-improvements-for-neon-users-on-vercel#automatic-branch-cleanup)).
   If this project uses the Vercel-managed integration, set Vercel's existing
   pre-production deployment retention to the shortest product-acceptable
   duration; Neon cleanup is tied to deployment deletion and otherwise defaults
   to roughly six months
   ([cleanup timing](https://neon.com/docs/guides/vercel-branch-cleanup#why-branches-arent-cleaned-up-immediately)).
3. Keep project and database credentials limited to the already-trusted team,
   and keep Vercel preview deployment protection enabled. The integration
   injects the branch connection string as environment variables for that
   deployment, while Vercel Authentication can restrict HTTP access to users
   with deployment access
   ([integration flow](https://neon.com/docs/guides/neon-managed-vercel-integration#how-preview-branching-works),
   [Vercel Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)).
4. Minimize IP collection in Better Auth if the application can do so without
   weakening rate limiting. That removes most copied direct PII at its source
   and is independent of branch lifecycle. Email remains necessary for magic
   link authentication.

The tradeoff is simple. An email or IP deleted from production remains in an
already-created child until that child is reset or deleted. This avoids making
masking or synchronization a prerequisite for every preview.

This note does not relabel opaque account/link identifiers or session tokens as
direct PII. They still have security significance, especially when copied
session material and application secrets cross environments; the Better Auth
runtime contract must isolate preview sessions from production independently of
the branch decision.

## What ordinary branching guarantees

A branch created with current data is an isolated copy-on-write clone of the
parent's schema and data at creation. Parent and child writes diverge from that
point; modifying either does not modify the other
([branching](https://neon.com/docs/introduction/branching),
[manage branches](https://neon.com/docs/manage/branches#create-a-branch)).

Consequently:

- deleting an account, email, session, or IP row in production does **not**
  propagate to existing preview branches;
- creating a later preview reflects production after that deletion;
- resetting a preview from production replaces all its databases with the
  parent's latest state, including both deletions and newly added PII; and
- Neon has no documented data merge or rebase that selectively propagates
  production deletions while preserving preview writes.

Reset is therefore not a useful privacy cleanup mechanism. It discards every
local database change without a backup, interrupts connections, and recopies
the complete current parent data
([reset from parent](https://neon.com/docs/guides/reset-from-parent#how-reset-from-parent-works)).

## Native controls and trade-offs

| Control | Risk reduction | Failure mode or limitation | Decision |
| --- | --- | --- | --- |
| Existing integration cleanup | Deletes the whole copied branch after its preview lifecycle. | Neon-managed cleanup runs on a later preview deployment and can be defeated by renaming the Git/Neon branch or adding a child. Vercel-managed cleanup waits until the last deployment is deleted; default retention is about six months and retention exceptions keep a minimum set. | Use; verify the existing settings once. Shorten Vercel pre-production retention if applicable. Do not duplicate it. |
| Production branch protection | Separates child Postgres passwords from production passwords automatically. | Does not hide PII inside the preview itself. Available on paid plans. Existing tooling must consume each generated child connection string. | Use if not already enabled. |
| Branch expiration (`expires_at`) | Hard upper bound: Neon permanently deletes the branch and its computes at expiry. | API/CLI branches have no default; the timestamp is at most 30 days ahead; reset restarts the TTL; expiring branches cannot be protected, default, or parents; an active preview can disappear. Adding it to integration-created branches requires another automation path. | Do not add now. Reconsider only if the managed integration exposes a declarative TTL. |
| Scale to zero / branch archiving | Reduces active compute and cost. | A connection automatically wakes the compute or unarchives the branch; storage and PII remain. | Keep defaults for cost, not as a privacy control. |
| Delete a compute endpoint | Makes the branch unreachable through that endpoint. | Breaks the preview; a new compute gets new connection details; data remains on the branch. | Do not use. |
| Project-wide IP Allow | Blocks database connections outside configured addresses/ranges. | Scale-plan feature. It applies across the project unless scoped to protected branches, and a changing deployment egress range can break previews. | Use only if Vercel already supplies stable egress that is maintained elsewhere. |
| IP Allow on protected branches only | Restricts production while leaving ordinary previews unrestricted. | Does not reduce exposure of PII in preview branches. | Useful for production, irrelevant to the stated preview risk. |
| Protect every preview | Can combine a branch with protected-only IP rules. | Protected branches cannot expire, be reset, or be deleted until unprotected, directly obstructing preview cleanup. | Do not use. |
| Private Networking | Removes public-internet database connectivity via AWS PrivateLink. | Requires an organization/network design and compatible application networking; it is not a preview-lifecycle control. | Out of scope unless that network already exists. |
| Anonymized branches | Statically replaces selected values such as unique emails while keeping production unchanged. | Beta; special branch creation and explicit rules; branch unavailable during masking; cannot reset, restore, or delete its read-write endpoint; constraints require care; current Vercel integration docs do not describe automatic anonymized preview branches. | Do not introduce for two fields. Revisit when the managed integration supports it as a first-class preview setting. |

Sources for the table:

- [Branch cleanup integration behavior](https://neon.com/docs/guides/vercel-branch-cleanup)
- [Branch expiration behavior and restrictions](https://neon.com/docs/guides/branch-expiration)
- [Scale to Zero](https://neon.com/docs/introduction/scale-to-zero)
- [Branch archiving](https://neon.com/docs/guides/branch-archiving)
- [Compute deletion](https://neon.com/docs/manage/computes#delete-a-compute)
- [IP Allow](https://neon.com/docs/introduction/ip-allow)
- [Protected branches](https://neon.com/docs/guides/protected-branches)
- [Private Networking](https://neon.com/docs/guides/neon-private-networking)
- [Data anonymization](https://neon.com/docs/workflows/data-anonymization)

## Cleanup details that must not be overstated

For the Neon-managed Vercel integration, "Automatically delete obsolete Neon
branches" removes a preview branch when its corresponding Git branch is
deleted, but cleanup runs the next time a preview deployment is created.
Renaming either side can break name matching, and a child branch prevents
deletion
([Neon-managed cleanup](https://neon.com/docs/guides/neon-managed-vercel-integration#branch-cleanup)).

For the Vercel-managed integration, Neon deletes the branch after the last
deployment for the Git branch is deleted, including deletion by Vercel's
deployment retention policy
([Vercel-managed cleanup](https://neon.com/blog/big-dx-improvements-for-neon-users-on-vercel#automatic-branch-cleanup)).

Branch expiration is a useful independent backstop in manually-created CI
branches: Console-created branches default to one day, while API and CLI
branches do not expire unless `expires_at` is explicitly supplied. The maximum
expiry is 30 days. Deletion is permanent and includes the associated computes
([branch expiration](https://neon.com/docs/guides/branch-expiration)). It is not
free protection for the current Vercel workflow because the documented
integration configuration has no TTL option.

Logical branch deletion is permanent, but Neon separately documents encrypted
provider backups retained for 30 days. Public retention language should not
promise physical erasure at the exact moment the integration removes a branch
([security overview](https://neon.com/docs/security/security-overview#compliance-relevant-security-measures)).

Neon also archives branches older than 14 days after 24 hours without access.
Access automatically unarchives them, so archiving changes storage tier rather
than deleting or denying access to PII
([branch archiving](https://neon.com/docs/guides/branch-archiving)).

## Credentials and access

Ordinary child branches inherit parent roles and passwords. Protecting the
parent changes this: Neon generates new passwords for matching roles on new
children. This is the strongest low-maintenance isolation improvement because
it prevents a preview database password from also being a production password
([manage branches](https://neon.com/docs/manage/branches#create-a-branch),
[protected branches](https://neon.com/docs/guides/protected-branches#new-passwords-generated-for-postgres-roles-on-child-branches)).

Neon requires TLS for connections, enforces high-entropy Postgres passwords,
encrypts customer data at rest with AES-256, and documents provider-side
least-privilege access controls and auditing
([security overview](https://neon.com/docs/security/security-overview)). These
controls make an ordinary branch a normal protected copy at the same processor;
they do not anonymize its contents.

IP Allow can restrict every branch in a project, or only protected branches.
The latter deliberately removes IP restrictions from ordinary preview branches.
There is no documented per-unprotected-branch allowlist
([IP Allow](https://neon.com/docs/introduction/ip-allow),
[protected branch IP rules](https://neon.com/docs/guides/protected-branches#how-to-apply-ip-restrictions-to-protected-branches)).
Project-wide IP Allow is therefore safe only when all application and developer
egress addresses are stable and known; otherwise it creates an availability
dependency for every preview.

Compute suspension is not access revocation. A compute is required to connect,
but the next connection automatically activates an idle compute. Deleting a
compute makes the existing connection string unusable but leaves the branch
data intact
([manage computes](https://neon.com/docs/manage/computes),
[Scale to Zero](https://neon.com/docs/introduction/scale-to-zero)).

## Why not use anonymized branches now

Neon's anonymized branches are the platform-native option when policy requires
non-production to contain no PII. The current feature is Beta and uses static
masking: Neon clones the parent, applies explicit branch-specific rules, and
keeps the branch unavailable while masking. It does not detect PII or mask any
column without a rule
([data anonymization](https://neon.com/docs/workflows/data-anonymization)).

It can preserve unique email constraints with a random-unique-email rule and
supports custom API expressions. But this account design also puts email inside
verification payloads and IP inside session/rate-limit fields, so the masking
contract would span more than two simple columns. The feature also cannot reset
or restore anonymized branches and cannot delete their read-write endpoint.

Neon's official docs say the feature can be explored on the Free plan, but do
not promise a generally available SLA
([Neon PII workflow](https://neon.com/blog/handle-pii-staging-databases#branching-with-user-defined-masking)).
The managed Vercel integration docs describe ordinary child creation only and
do not document an anonymized-branch option. Adopting it now would replace the
known preview path with a special provisioning path—the failure mode the
product owner explicitly wants to avoid.

## Implementation-plan contract

- Do not create a PII-free parent, schema-only branch, scrub pipeline, reset
  job, or custom branch deletion job for Customer Accounts.
- Record that preview branches may temporarily contain copied login email and,
  if collection remains enabled, IP addresses. They contain no Dotypos name,
  phone, billing, or reservation data.
- Record that production deletion is not propagated to existing children; the
  copied row persists until the preview branch is deleted.
- Use the existing integration lifecycle as the retention control and keep
  previews inside the contributor trust boundary.
- If this is the Vercel-managed integration, use Vercel's existing deployment
  retention setting to shorten the copy's ordinary life; accept its documented
  minimum-deployment exceptions rather than adding another cleanup workflow.
- Verify once before launch that production is protected and automatic obsolete
  preview-branch cleanup is enabled. Treat configuration drift as an operations
  check, not an application provisioning step.
- Keep preview tests synthetic. Do not query, log, display, or send email to
  inherited real identities during E2E.
- Use a distinct preview Better Auth secret so copied session material cannot be
  presented as a production session; the Better Auth implementation research
  owns the exact configuration and test.
- State in internal privacy/processing records that Neon hosts these short-lived
  copies. Public copy need only explain Neon hosting and applicable retention;
  it does not need to explain database branch mechanics.

No new runtime component is required. If a future audit requires zero PII in
non-production, the upgrade path is Neon's managed anonymized-branch feature
once it is GA and directly supported by the Vercel integration—not an in-house
scrubber.
