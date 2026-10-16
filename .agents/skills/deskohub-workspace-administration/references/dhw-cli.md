# Administration API and `dhw`

`dhw` (`apps/dhw`) is the native administration CLI. It calls the `/api/v1/cli` Effect HTTP API defined in `packages/workspace-admin-api/src/workspace-admin-api.ts` and served by `apps/deskohub-workspace/features/admin-cli/workspace-admin-api.server.ts`. For commands, arguments, and flags, run `bun apps/dhw/src/main.ts --help` or `<command> --help`.

## Contract changes

- Treat `workspace-admin-api.ts` as the single contract for the Admin UI, the API, and `dhw`. Extend the generic mutation endpoint and client unless the transport itself changes.
- Give each new response field a decoding default so a newer `dhw` still decodes an older server's response. `CliSession.expiresAt` and the payment-attempt `refundedAmount` and `refundedAt` fields use `Schema.withDecodingDefaultTypeKey` to decode a missing value as `null`.
- Bounded filters use schema-typed GET query parameters. Keep service operations and shared schemas transport-independent.

## Authentication and sessions

1. `dhw auth` creates a five-minute authentication request and prints an unprefixed `/admin/cli/authenticate` URL, which the proxy redirects into the operator's locale.
2. An administrator approves it behind `/admin` Basic authentication and picks the session lifetime.
3. The CLI exchanges a single-use grant bound to its local verifier and stores the opaque bearer in macOS Keychain or the Linux Secret Service.

Rules:

- The server persists only SHA-256 digests of bearers.
- The server records the approving Basic-auth username as `approvedBy`. Use it for provenance such as invoice and access-code actors, and never accept an actor from CLI input.
- A session stops working when it's revoked, when it expires, or when its approver is no longer in the Basic-auth registry. Session lookup filters expired and revoked rows in the same query, so both fail with `CliSessionUnauthorized`, and `dhw` deletes the stored credential.
- Expiry is computed at approval in `Europe/Prague` calendar units. `NULL` means the session never expires.
- The session label (default `dhw on <machine-name>`, or `--name`) is descriptive only. The session ID is its identity.
- The public authentication-start endpoint fails closed without a Vercel Firewall rate limit with the ID `cli-authentication-start` (10 requests per IP per minute, then 429). The Workspace Vercel project must define it.

## Output and confirmation

- `--json` reserves stdout for one final JSON result. `dhw auth --json` writes approval instructions to stderr.
- Every administration command that has a `--yes` flag prompts for confirmation through `confirmChange`. With `--json` or without a TTY on both stdin and stdout, it fails unless you pass `--yes`. `dhw update --json` without `--yes` only reports an available update.
- Reservation detail includes safe access-grant metadata, never the PIN.

## Retries and idempotency

- Discount and reservation-access mutations carry a client-generated request ID. The server stores the request and result per CLI session in `features/admin-cli/cli-mutation-idempotency.service.ts`, so retrying after an ambiguous transport failure replays the stored result instead of applying the mutation twice. A replayed access mutation returns safe grant metadata without issuing another credential.
- An incomplete access request claim can be reclaimed after one minute. Recovery returns an issued grant, safely retries a failed grant, or requires provider reconciliation for every ambiguous state.
- `dhw invoices create --input <file>` decodes the file with the strict `AdministrationInvoiceCreateFileInput` schema, which rejects unknown properties at every level. The file supplies the invoice UUID, and `dhw` sends it unchanged across retries. After an uncertain attempt, rerun with the same file. The server rejects the same UUID with different input.
- Keep invoice customer data out of the generic CLI mutation ledger.

## Discount targets

`--product cowork` targets every cowork tier. `cowork:open-space` and `cowork:reserved-desk` target one tier and can't be combined with `cowork`. See [discounts.md](discounts.md#cowork-tier-targets).

## Email campaigns

- The campaign contract lives in `packages/workspace-admin-api/src/email-campaigns.ts`, and `features/admin-cli/email-campaigns-api.server.ts` serves it with the services the campaign admin UI uses.
- Bodies cross the API as Markdown. The server parses them with `parseCampaignBodyMarkdown` and exports stored bodies with `campaignBodyToMarkdown`; `dhw` never parses Markdown itself.
- `AudienceFilter` in the contract is the only audience filter schema. Workspace re-exports it from `features/email-campaigns/audience-filter.ts` as `audienceFilterSchema`. On its own it ignores excess properties, so stored filters keep decoding. The strict API inputs that embed it reject them, and `dhw` decodes filter files with the same strict parse options. Keep its encoded form stable: `email-campaigns.test.ts` pins the stored wire format byte for byte. Each condition schema lists `attribute` before `_tag`: a Schema union dispatches on the first literal key it indexes, so this order checks a condition only against its own attribute's shapes and reports errors at its fields. A change to the stored shape needs a data migration of `email_campaign_audiences.filter`, `email_campaign_sends.audience_filter`, and stored `cli_mutation_requests` results that embed an audience.
- Unparsable or invalid input fails with `CliInputInvalid` (400), and state conflicts fail with `CliMutationRejected` (409). Both messages reach the operator verbatim, so keep them actionable.
- Campaign create, campaign duplicate, and audience create go through the CLI mutation ledger (`CliMutationIdempotency.applyOnce`), so a retried request replays its first response instead of leaving an extra row. `applyOnce` runs the claim, the mutation, and the stored result in one database transaction, so any failure or crash rolls all three back and frees the request ID. Its `apply` must write only through `WorkspaceDatabase`: queries and nested `db.transaction` calls join the ambient transaction through the shared SQL client, while external side effects (provider calls, email) don't roll back and belong in the claim/complete/reclaim flow the discount and access mutations use. Updates, archive, and unarchive are idempotent; a confirmed send is single-use by its confirmation code, and retry needs a Failed campaign.

## Reservation product-details backfill

Meeting-room and office snapshots (`workspace_reservations.reservation_details`) written before they recorded the catalog identity hold only `kind`. Audience product filters can match those rows only at family level. `dhw reservations backfill-product-details` fills them through `ReservationProductDetailsBackfill` (`features/reservation/backend/reservation-product-details-backfill.service.ts`):

- Each `POST /reservations/product-details-backfill` call reads one batch of 50 meeting-room and office rows after the `after` cursor, in ID order, and fetches only the incomplete rows from Dotypos with one `listReservations({ ids })` call. `dhw` follows `nextCursor` until it's null and totals the batches.
- A meeting room's interval must match a catalog offer exactly (`findMeetingRoomReservationDuration`). An office interval must run between Prague midnights (`getOfficeReservationSelection`); Dotypos `seats` gives the seats. The reservation note is freeform and never read.
- A row it can't resolve stays as it is and is reported with its reason: `dotypos_reservation_id_missing`, `dotypos_reservation_not_found`, `dotypos_interval_invalid`, `interval_not_in_catalog`, `dotypos_seats_invalid`, or `stored_details_malformed`. Complete rows are counted and skipped, so a rerun changes nothing.
- An update replaces only the snapshot it read and leaves `updated_at` alone, because that column orders admin activity and guards claims.
- `--dry-run` reports what it would fill without writing and needs no confirmation. A real run needs `--yes` with `--json` or without a TTY.

Don't run it in production while a deployment that predates the optional snapshot fields can still read reservations: those deployments decode snapshots strictly and reject the new keys. That includes Skew Protection, pinned late-payment recovery queue messages, and an instant rollback target. See [database-and-releases.md](../../deskohub-workspace-operations/references/database-and-releases.md).

## Standalone access codes

`dhw access-codes create` shares the server workflow in [dashboard.md](dashboard.md#standalone-access-codes). The CLI adds local state:

- Before sending, the CLI reserves the attempt ID in the state directory under a per-request lock file that carries an owner token. A contender never steals the lock. It waits a bounded time, then fails closed with manual-recovery instructions.
- Rerunning the same command on the same machine and session reuses the reserved ID, so an interrupted run can't create a second code.
- The reservation is released once creation concludes, so a later intentional creation gets a fresh ID. If the file can't be deleted, it's marked concluded instead.
- If the local reservation can't be written or read, the command refuses to create a code.
- After a cleanup-required error, the operator removes or verifies the named attempt's credential in the Igloohome app over Bluetooth, then reruns with `--provider-credential-removed <attempt-id>`. On a `reconciled` answer, `dhw` reissues the creation under a fresh ID in the same invocation.

## Configuration

- `DHW_BASE`: Workspace origin. Must be an HTTPS origin, or an HTTP origin on `localhost` or `127.0.0.1`.
- `DHW_REQUEST_HEADERS`: JSON object of extra API headers, such as a Vercel protection-bypass header. Values are redacted, can't override headers that `dhw` manages, and are never sent to GitHub.
- `DHW_STATE_DIR`: overrides the state directory for updater state and access-code attempt reservations.
- `DHW_NO_UPDATE_CHECK=true` disables automatic update checks. They also never run for `--json`, under `CI`, or without a TTY.

`dhw update` forces a check. Automatic checks persist the GitHub ETag and wait 30 seconds between requests. The updater accepts only a stable, immutable `dhw-v*` release asset for the build target embedded at compile time, with the expected size and SHA-256 digest and a matching self-reported version and target. Never infer the target from the host OS or architecture. Windows is unsupported.

## Checks

Run the CI-equivalent checks from `.github/workflows/dhw-ci.yml` for contract or CLI changes:

```bash
bun turbo lint --filter=@deskohub/workspace-admin-api --filter=dhw
bun turbo typecheck --filter=@deskohub/workspace-admin-api --filter=dhw
bun --cwd apps/dhw test
bun test packages/workspace-admin-api
bun turbo test:admin-cli --filter=./apps/deskohub-workspace
bun apps/dhw/src/build.ts development
apps/dhw/dist/dhw version --json
```

Development builds report `<version>+development`, and PR artifacts report `<version>+pr.<number>.<head-sha>`. Published releases use the plain package version.

## Releases

Release Please owns `apps/dhw/package.json`, `apps/dhw/CHANGELOG.md`, and the `dhw-v*` tags.

- A pull request that changes `apps/dhw` or `packages/workspace-admin-api` needs at least one `feat(dhw): ...` or `fix(dhw): ...` commit.
- A contract change under `packages/workspace-admin-api` must also change `apps/dhw`, because Release Please scopes the component to `apps/dhw`. `dhw-ci.yml` rejects contract-only changes.
- After merge, `.github/workflows/dhw-release.yml` auto-merges the Release Please pull request, then builds, attests, uploads, and publishes the binaries with `SHA256SUMS`. There's no manual release step.
- The workflow needs a GitHub App (Contents, Pull requests, and Issues read/write; Administration read) in the `DHW_RELEASE_APP_ID` variable and `DHW_RELEASE_APP_PRIVATE_KEY` secret. The repository must allow auto-merge and merge commits and have immutable releases enabled. The workflow fails closed without immutable releases.
