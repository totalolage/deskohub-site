# `dhw`

## Contents

- [Authentication](#authentication)
- [Read-only administration](#read-only-administration)
- [Administration mutations](#administration-mutations)
- [Development](#development)
- [Configuration](#configuration)
- [Automatic releases](#automatic-releases)

`dhw` is the native Deskohub Workspace administration CLI. Its commands use
the same Effect HTTP API contract and application services as the `/admin`
interface.

The CLI includes a typed `/api/v1/cli` Effect HTTP client, browser-approved
authentication, OS credential-store integration, release automation, and
self-updates. Administrative resource commands are added incrementally while
sharing their application services with `/admin`.

## Authentication

Run `dhw auth`. The command creates a five-minute authentication request and
prints an `/admin/cli/authenticate` URL. After an administrator approves that
request behind the existing `/admin` Basic authentication, the CLI exchanges a
single-use grant bound to its local verifier and stores the resulting opaque
bearer in macOS Keychain or the Linux Secret Service.

The server records the Basic-auth username that approved each new session. That
server-derived actor is used for invoice provenance; it is never accepted from
CLI input. Sessions issued before approver tracking was added remain valid for
reads, but must run `dhw auth` again before creating an invoice.

With `--json`, browser approval instructions are written to stderr while stdout
is reserved for the single final JSON result.

New sessions default to the recognizable label `dhw on <machine-name>`. Pass
`--name` to choose the initial label explicitly, or rename an issued session
later from `/admin/cli/sessions`. The label is descriptive only; the opaque
session ID remains its identity and renaming does not change access.

Permanent bearer values are never stored by the server; only their SHA-256
digests are persisted. `/admin/cli/sessions` lists issued sessions and revokes
them. Every authenticated CLI operation validates its session, and a revoked
credential is removed from secure storage as soon as the API reports it.

The public authentication-start endpoint is fail-closed behind the Vercel
Firewall Rate Limiting SDK. The Workspace Vercel project must define an
`@vercel/firewall` rate limit with the ID `cli-authentication-start`, allowing
10 requests per IP per minute and returning 429 after the limit.

## Read-only administration

Authenticated read commands use the same application services as the Admin UI:

```bash
dhw overview
dhw reservations list
dhw reservations list --date 2026-08-10 --status complete --page 2
dhw reservations get <reservation-id>
dhw reservations find <reservation-or-payment-id>
dhw reservations cancel <reservation-id> --confirm-access-credential-removed --send-cancellation-email
dhw bookings list --date 2026-08-10
dhw bookings get <booking-id>
dhw orders list --from 2026-08-01 --to 2026-08-10
dhw orders get <order-id>
dhw operations list --channel ECOMMERCE --operation-type CAPTURE
dhw operations get <operation-id>
dhw customers list
dhw customers search "Ada"
dhw customers get <customer-id>
dhw customers reservations <customer-id> --page 2
dhw discounts list
dhw codes list
dhw codes get <code-id>
dhw sales list
dhw invoices list
dhw invoices get <invoice-id>
dhw invoices download <invoice-id> --output invoice.pdf
dhw sessions list
```

Reservation detail includes safe access-grant metadata but never the secret PIN.

Pass the root `--json` flag for schema-decoded machine output, for example
`dhw --json reservations list`. Human output is intentionally compact; JSON
retains the complete typed response.

RFC 10008 `QUERY` is the preferred eventual transport for searches with request
content. The installed Effect V4 HTTP method model and Next.js App Route runtime
do not yet accept `QUERY`, so bounded filters currently use schema-typed GET
query parameters. The service operations and shared schemas remain transport
independent so adopting `QUERY` does not require changing CLI commands or Admin
UI application services.

## Administration mutations

Mutation commands use the same validated mutation schema and application
services as the Admin UI. Representative commands are:

```bash
dhw reservations retry-access <reservation-id> --yes
dhw reservations reconcile-access <reservation-id> \
  --provider-credential-removed --yes
dhw discounts create percentage \
  --label-en "Summer sale" --label-cs "Letní sleva" \
  --percentage 10 --product cowork --product office
dhw discounts create fixed \
  --label-en "100 CZK off" --label-cs "Sleva 100 Kč" \
  --fixed-value 10000 --currency CZK --product meeting-room
dhw discounts update percentage <discount-id> \
  --label-en "Summer sale" --label-cs "Letní sleva" \
  --percentage 15 --product cowork
dhw discounts delete <discount-id>

dhw codes create existing SUMMER10 <discount-id>
dhw codes create percentage VIP15 --customer <customer-id> \
  --max-uses-per-customer 2 \
  --label-en "VIP discount" --label-cs "VIP sleva" \
  --percentage 15 --product cowork
dhw codes update <code-id> SUMMER15 <discount-id> --enabled true
dhw codes add-customer <code-id> <customer-id>
dhw codes remove-customer <code-id> <customer-id>
dhw codes make-unrestricted <code-id>
dhw codes delete <code-id>

dhw vouchers create GIFT100 --credit-value 10000 --currency CZK
dhw vouchers update <voucher-id> GIFT150 --credit-value 15000 \
  --currency CZK --enabled true
dhw vouchers add-customer <voucher-id> <customer-id>
dhw vouchers remove-customer <voucher-id> <customer-id>
dhw vouchers make-unrestricted <voucher-id>
dhw vouchers get <voucher-id>
dhw vouchers list
dhw vouchers delete <voucher-id>

dhw invoices create --input invoice.json --yes
dhw invoices resend <invoice-id> --yes

dhw customers set-discount-group <customer-id> <group-id>
dhw customers clear-discount-group <customer-id>
dhw sessions rename <session-id> "Office Mac"
dhw sessions revoke <session-id>
```

The `codes create percentage` and `codes create fixed` variants create the
discount definition and code atomically, matching the Admin UI. Vouchers have
their own command group; `vouchers get` reports issued and remaining credit
together with every reserved, redeemed, or released claim. Add `--customer` to
either create command to restrict the new resource to one customer. Fixed and
credit values use minor currency units. Validity bounds use ISO instants;
omitted bounds and global or per-customer code maximum uses are stored as
unrestricted values. Update commands replace the editable resource fields,
matching the corresponding Admin UI forms.

Commands that cancel reservations, delete resources, remove restrictions, revoke sessions, change a
customer's discount group, or add a code-audience member ask for confirmation.
Pass `--yes` to approve explicitly; non-interactive and `--json` invocations
require it.

Invoice creation reads a JSON object containing the customer choice, service
date, a strict `payment` object with status `due` or `paid` and its matching
date, currency, optional variable symbol, and at least one
description-and-price line.
The shared Effect schema rejects unknown properties, including unknown nested
customer properties, so misspelled fields fail instead of being ignored. Prices
remain decimal strings and may be positive, zero, or negative. The input file
supplies one stable invoice UUID, which `dhw` sends unchanged across transport
retries; reuse that file after an uncertain attempt. The repository rejects the
same UUID with different input. The confirmation warns that the completed
invoice is immediately emailed to the customer and the internal recipient.
Invoice customer data is deliberately excluded from the generic CLI mutation
ledger.

Reservation cancellation preserves successful settlement facts, marks a paid Nexi attempt as requiring a refund, and does not issue the refund automatically. Zero-total internal payments remain refund-free. If the reservation has a live or ambiguous AlgoPIN, remove it at the lock first and pass `--confirm-access-credential-removed`; Igloohome cannot revoke it remotely. Add `--send-cancellation-email` to send the localized customer message after cancellation succeeds; email failure is reported separately from the completed cancellation.

Each discount mutation carries a client-generated request identifier. The
server persists the request and result per CLI session, so an ambiguous
transport failure can be retried without applying the same mutation twice.
Reservation access mutations use the same request ledger so a lost successful
response replays safe grant metadata without issuing another credential.
An incomplete access request claim can be reclaimed after the one-minute
provisioning window; recovery returns an issued grant, safely retries a failed
grant, or requires provider reconciliation for every ambiguous state.

## Development

```bash
bun --cwd apps/dhw typecheck
bun --cwd apps/dhw test
bun apps/dhw/src/main.ts --help
bun apps/dhw/src/build.ts development
apps/dhw/dist/dhw version --json
```

The release build target is explicit and embedded in the binary. The supported
targets are:

- `darwin-arm64`
- `darwin-x64`
- `linux-arm64`
- `linux-x64-baseline`

Windows is intentionally unsupported. Asset selection never infers a target
from the host OS, architecture, or `uname`; the updater uses only the build
target embedded at compilation.

Non-release binaries identify their provenance in SemVer build metadata.
Development builds use `<version>+development`, and PR artifacts use
`<version>+pr.<number>.<head-sha>`. Published releases keep the plain package
version.

## Configuration

- `DHW_BASE` changes the Workspace origin. It must be HTTPS, except for HTTP on
  localhost during development.
- `DHW_REQUEST_HEADERS` is a JSON object of additional API request headers. It
  is intended for preview-protection bypass headers and its values are redacted
  by Effect. It is never sent to GitHub during update checks.
- `DHW_STATE_DIR` overrides the local updater state directory.
- `DHW_NO_UPDATE_CHECK=true` disables automatic checks.

For a protected Vercel preview, configuration can be scoped to one invocation:

```bash
DHW_BASE=https://example-git-branch-team.vercel.app \
  DHW_REQUEST_HEADERS='{"x-vercel-protection-bypass":"…"}' \
  dhw auth
```

Automatic update checks run only for interactive commands, never for JSON
output, CI, or redirected input/output. The last attempt and GitHub ETag are
persisted, and another request is not made for 30 seconds. `dhw update` forces a
check. An update is accepted only from a stable immutable `dhw-v*` release with
the exact embedded target, expected size, GitHub SHA-256 digest, and matching
binary-reported version and target.

## Automatic releases

Release Please owns `apps/dhw/package.json`, `apps/dhw/CHANGELOG.md`, and the
`dhw-v*` tags. A pull request that changes the CLI or its shared API contract
must contain at least one releasable Conventional Commit:

- `feat(dhw): ...` for a minor release
- `fix(dhw): ...` for a patch release

Because Release Please scopes the `dhw` component to `apps/dhw`, a shared
contract change under `packages/workspace-admin-api` must also include its
corresponding CLI change under `apps/dhw`. CI rejects contract-only changes so
the Workspace endpoint cannot advance without a versioned CLI counterpart.

When such a pull request is merged into `main`, the release workflow updates a
transient Release Please pull request and enables auto-merge on it. Once its
required checks pass, the workflow creates a draft release, builds and attests
all four binaries on native runners, uploads them together with `SHA256SUMS`,
and publishes the release. There is no per-release manual merge or publish
step. Release Please force-creates the version tag for each draft release so a
follow-up main run recognizes that release boundary instead of proposing the
same commits again.

Repository setup requires a GitHub App installed on this repository with
Contents and Pull requests read/write, Issues read/write, and Administration
read permissions. Set its app ID as the `DHW_RELEASE_APP_ID` Actions variable
and its private key as the `DHW_RELEASE_APP_PRIVATE_KEY` Actions secret. Enable
auto-merge, allow merge commits, and enable immutable releases for the
repository. The workflow fails closed if immutable releases are not enabled.
