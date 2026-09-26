# Customer-account dependencies through the order pull-request stack

Research date: 2026-09-02

## Answer

The order stack can survive the Neon Auth to Better Auth replacement without
depending on Better Auth directly. Its compatibility boundary is the existing
provider-independent `CustomerAccountResolver`, the `LinkedCustomerAccount`
result, the closed `CustomerAccountAccessError` reasons, and the
`customer_account_links` table. Keep those stable while replacing the internal
authentication adapter, Auth routes, environment variables, and magic-link test
capture.

The account pull request is the root of a 20-pull-request linear stack: the
account root plus 19 order descendants. The first five descendants are
account-independent in executable code. The first real consumer is
[Expose authenticated goods carts](https://github.com/totalolage/deskohub-site/pull/252),
which resolves the current identity through `CustomerAccountResolver` before
calling cart and catalog services. Later direct consumers are quote, order,
issuance-composition, payment, and end-to-end changes. Other descendants depend
only cumulatively because they inherit the root, or structurally because their
generated Drizzle snapshots contain the account-link table.

## Stable compatibility boundary

The account root exports `CustomerAccountResolver`,
`resolveCurrentCustomerAccount`, `CustomerAccountAccessError`,
`CustomerAccountId`, and `LinkedCustomerAccount` from the account feature's
[public index](https://github.com/totalolage/deskohub-site/blob/c99e12b5168b5626638d4c3157c1617aecb998f3/apps/deskohub-workspace/features/account/index.ts).
The resolver's `resolve()` operation returns only `accountId` and
`dotyposCustomerId`; its live layer hides provider session data behind an
internal `CustomerAuthentication` service. See the fixed account-root
[resolver source](https://github.com/totalolage/deskohub-site/blob/c99e12b5168b5626638d4c3157c1617aecb998f3/apps/deskohub-workspace/features/account/backend/customer-account-resolver.service.ts)
and [domain contract](https://github.com/totalolage/deskohub-site/blob/c99e12b5168b5626638d4c3157c1617aecb998f3/apps/deskohub-workspace/features/account/customer-account.ts).

The order stack relies on these exact semantics:

- `CustomerAccountResolver.Live` remains a layer that can resolve the current
  request without callers knowing the provider.
- `resolve()` returns a stable opaque `CustomerAccountId` and the linked
  `DotyposCustomerId`.
- `CustomerAccountAccessError.reason` continues to distinguish
  `unauthenticated`, `unverified-email`, `link-required`, `not-configured`, and
  `unavailable`. The goods route maps those categories to 401, 403, and 503 in
  its [shared route boundary](https://github.com/totalolage/deskohub-site/blob/10be749321567b430f43219afb03a7e1e09efe2b/apps/deskohub-workspace/features/goods/backend/goods-route.ts).
- `customer_account_links.customer_account_id` remains the opaque identity key,
  and `dotypos_customer_id` remains unique. Runtime order code never queries the
  provider's user, session, account, or verification tables.

The `CustomerAuthentication` implementation, Neon client modules, Auth route
handler, sign-in UI, provider session endpoint, `NEON_AUTH_*` variables, and
Neon webhook capture are not compatibility boundaries. They may be replaced by
Better Auth. The provider name in the current `CustomerAccountId` schema
description must also be removed, while its opaque-string behavior remains.

## Descendant dependency matrix

The table classifies each pull request by its own diff against its declared
base. “Snapshot only” means no executable account reference was added, but the
new cumulative Drizzle snapshot contains `customer_account_links` and is linked
to the preceding snapshot ID.

| Pull request | Own account dependency | Consequence of replacing the root |
| --- | --- | --- |
| [Add generic order foundation](https://github.com/totalolage/deskohub-site/pull/243) | Snapshot only | No runtime adaptation; regenerate/reconcile its snapshot. |
| [Migrate payment lifecycle to orders](https://github.com/totalolage/deskohub-site/pull/247) | Snapshot only | No runtime adaptation; regenerate/reconcile its snapshot. |
| [Move accounting ownership to orders](https://github.com/totalolage/deskohub-site/pull/248) | Snapshot only | No runtime adaptation; regenerate/reconcile its snapshot. |
| [Own discount evidence by orders](https://github.com/totalolage/deskohub-site/pull/250) | Snapshot only | No runtime adaptation; regenerate/reconcile its snapshot. |
| [Target goods discounts precisely](https://github.com/totalolage/deskohub-site/pull/251) | None | Rebase only. This is the last account-independent executable change. |
| [Expose authenticated goods carts](https://github.com/totalolage/deskohub-site/pull/252) | First direct consumer plus snapshot | Preserve the resolver/error contract for cart and catalog routes; regenerate/reconcile its snapshot. |
| [Price goods baskets once](https://github.com/totalolage/deskohub-site/pull/253) | None in its own diff | Inherits authenticated cart routes; rebase after the first consumer. |
| [Settle generic order payments](https://github.com/totalolage/deskohub-site/pull/254) | None in its own diff | Cumulative only. |
| [Persist goods basket discount evidence](https://github.com/totalolage/deskohub-site/pull/255) | Snapshot only | Regenerate/reconcile its snapshot. |
| [Seal goods basket quotes](https://github.com/totalolage/deskohub-site/pull/256) | Direct resolver consumer | Preserve `CustomerAccountResolver.Live` for the quote route and its mocked service contract. |
| [Issue goods orders atomically](https://github.com/totalolage/deskohub-site/pull/257) | Direct resolver consumer plus snapshot | Preserve ownership resolution for order collection/detail routes; regenerate/reconcile its snapshot. |
| [Freeze goods accounting documents](https://github.com/totalolage/deskohub-site/pull/258) | None in its own diff | Cumulative only. |
| [Namespace Nexi administration diagnostics](https://github.com/totalolage/deskohub-site/pull/259) | None; its `dhw` authentication references are unrelated operator authentication | Cumulative only. |
| [Compose acknowledged goods issuance](https://github.com/totalolage/deskohub-site/pull/260) | Modifies resolver-consuming order route composition and mocks | Preserve the service-layer shape while restacking. |
| [Admit generic order payment sessions](https://github.com/totalolage/deskohub-site/pull/261) | None in its own diff | Cumulative only. |
| [Expose goods order payments](https://github.com/totalolage/deskohub-site/pull/263) | Direct resolver consumer | Preserve authenticated customer ownership for payment and order-detail routes. |
| [Expose domain order administration](https://github.com/totalolage/deskohub-site/pull/262) | None; `dhw` authentication is unrelated | Cumulative only. |
| [Add goods order write-offs](https://github.com/totalolage/deskohub-site/pull/264) | Snapshot only | Regenerate/reconcile the final database snapshot. |
| [Cover the goods order lifecycle](https://github.com/totalolage/deskohub-site/pull/266) | Direct, provider-specific end-to-end dependency | Rewrite its shared account-auth helper and goods-order test to use Better Auth magic-link/session capture; retain synthetic link assertions and cleanup. |

The direct runtime consumers are visible at their fixed heads in the
[cart/catalog routes](https://github.com/totalolage/deskohub-site/tree/10be749321567b430f43219afb03a7e1e09efe2b/apps/deskohub-workspace/app/api/v1/goods),
[quote route](https://github.com/totalolage/deskohub-site/blob/68ac476706ca6a5c4b7c6e47d7b89a314a9a8007/apps/deskohub-workspace/app/api/v1/goods/quote/route.ts),
[order routes](https://github.com/totalolage/deskohub-site/tree/604d92762157e26edfe50459b78b068493d7dcef/apps/deskohub-workspace/app/api/v1/goods/orders),
[issuance composition](https://github.com/totalolage/deskohub-site/blob/adc148055077d6ad32eebc1cab922f680142cdc6/apps/deskohub-workspace/app/api/v1/goods/orders/route.ts),
and [payment route](https://github.com/totalolage/deskohub-site/blob/6c74b52236a5a950ab385244e63e2bd5c28cb3b4/apps/deskohub-workspace/app/api/v1/goods/orders/%5BorderId%5D/payment/route.ts).

## Migration consequences

The account root adds one application migration for `customer_account_links`.
Eight descendants add cumulative Drizzle snapshots: generic order foundation,
payment ledger, order accounting, discount legal evidence, goods carts, basket
discount evidence, goods issuance fingerprint, and goods write-off. Inspection
of each committed snapshot shows that all eight contain the account-link table
and that each `prevIds` entry points at the preceding snapshot, beginning with
the account snapshot. The chain is visible from the account root's
[snapshot](https://github.com/totalolage/deskohub-site/blob/c99e12b5168b5626638d4c3157c1617aecb998f3/apps/deskohub-workspace/db/migrations/20260821202645_customer_account_links/snapshot.json)
through the final order
[snapshot](https://github.com/totalolage/deskohub-site/blob/c37047f5b8c4a6facdd7df46ff3782cb60addc24/apps/deskohub-workspace/db/migrations/20260821225605_melodic_ulik/snapshot.json).

Better Auth introduces repository-owned user, session, account, and
verification tables at the root. Because every later snapshot represents the
whole schema rather than only its migration's delta, mechanically rebasing the
old JSON is insufficient. Regenerate or deliberately reconcile all eight
descendant snapshots in root-to-tip order and re-run the repository's migration
drift check. Keep the account-link table and constraints unless a separately
reviewed domain decision changes them.

## Environment, route, and end-to-end consequences

All descendants cumulatively inherit the root's `NEON_AUTH_BASE_URL`,
`NEON_AUTH_COOKIE_SECRET`, `@neondatabase/auth` package, Auth UI, `/api/auth`
handler, preview-readiness check, cloudflared installation, Neon management
credentials, and webhook capture. Those are root-owned coupling, not nineteen
separate adaptations.

The exception is [Cover the goods order lifecycle](https://github.com/totalolage/deskohub-site/pull/266).
Its new
[account-auth helper](https://github.com/totalolage/deskohub-site/blob/bdad73f7a92b5fe992c2bbbcbfb183b6259618c4/apps/deskohub-workspace/e2e/playwright-account/account-auth.ts)
directly imports `NeonAuthMagicLinkCapture`, fetches
`/api/auth/get-session?disableCookieCache=true`, validates the Neon session
shape, queries `customer_account_links`, and deletes synthetic links. Its
[goods-order lifecycle](https://github.com/totalolage/deskohub-site/blob/bdad73f7a92b5fe992c2bbbcbfb183b6259618c4/apps/deskohub-workspace/e2e/playwright-account/goods-orders.pw.ts)
also starts `useNeonAuthMagicLinkCapture`. Replace only the provider capture and
session-read portions; the browser flow, linked-customer wait, ownership checks,
and synthetic cleanup remain valid.

## What current `main` supersedes

The account root branched from `5894a37c`; current `main` at research time was
`33a840eb`, 177 commits ahead of their merge base. Fourteen root-owned files
were changed on both sides, although a merge simulation produced textual
conflicts only in Workspace tests and preview readiness.

Use current `main` as authoritative for these overlaps:

- The current [Workspace test workflow](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/.github/workflows/workspace-tests.yml)
  already provisions the required PostgreSQL extension image, validates
  generated migration drift, and supplies the migrated database to the normal
  test graph. Drop the root's one-off “apply account link migration” runner;
  preserve focused account concurrency tests within the current workflow.
- The current [Workspace E2E workflow](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/.github/workflows/workspace-e2e.yml)
  has newer exact-SHA and skipped-deployment behavior. Preserve it and add only
  the Better Auth E2E inputs eventually selected. Delete the inherited
  cloudflared/Neon-management setup rather than resolving it forward.
- The current [preview-readiness implementation](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/apps/deskohub-workspace/e2e/preview-readiness.ts)
  checks current webhook, homepage, and asset requirements. Add a Better Auth
  readiness assertion without losing those checks.
- Current `main` centralizes database pool timeouts in
  [database-provider.server.ts](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/apps/deskohub-workspace/db/database-provider.server.ts).
  Preserve that pool configuration while carrying forward the account root's
  session-level advisory-lock behavior; neither side replaces the other.
- Current `main` requires Resend webhook configuration and contains a newer
  email-delivery lifecycle. Better Auth magic-link delivery and test capture
  must integrate with that current surface; Neon dashboard SMTP and Neon Auth
  webhooks are not inherited application infrastructure. See the current
  [email configuration](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/apps/deskohub-workspace/shared/backend/config/email.config.ts)
  and [Resend webhook route](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/apps/deskohub-workspace/app/api/webhooks/resend/route.ts).

## Stack decision

The least disruptive route is to rewrite the existing account root in place,
preserve the resolver/link boundary, then restack every descendant from root to
tip while regenerating the eight affected snapshots. Replacing the root with a
new pull request does not avoid descendant restacking: every child contains the
old root commits. Detaching the first five executable-independent descendants
is possible, but their first four snapshots still include the account migration,
and the chain must rejoin Better Auth at the goods-cart consumer.

Therefore the account provider replacement should not force Better Auth types
or tables into order code. Treat `CustomerAccountResolver` as the sole runtime
seam, treat `customer_account_links` as the sole shared persistence seam, and
adapt the final end-to-end PR explicitly. This keeps the order implementation
provider-agnostic while making the unavoidable migration and restack work
visible.
