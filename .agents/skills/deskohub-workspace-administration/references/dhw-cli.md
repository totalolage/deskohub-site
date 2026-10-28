# Administration API and `dhw`

`dhw` (`apps/dhw`) is the native administration CLI. It calls the `/api/v1/cli` Effect HTTP API defined in `packages/workspace-admin-api/src/workspace-admin-api.ts` and served by `apps/deskohub-workspace/features/admin-cli/workspace-admin-api.server.ts`. For commands, arguments, and flags, run `bun apps/dhw/src/main.ts --help` or `<command> --help`.

## Contract changes

- `packages/workspace-admin-api/src/administration-wire-contract.test.ts` pins the wire contract of every `WorkspaceAdminApi` group decoded by released `dhw` binaries against `administration-wire-contract.golden.json`: paths, methods, request and response schemas, parse options, middleware order, and endpoint annotations such as minimums and refusals. It compares schemas by structure with every `$ref` inlined, so renaming a component schema, reordering mutually exclusive union members such as tagged errors, or a changed generated response description passes. Every other difference is wire drift that can break shipped binaries. Regenerate it only for an intended contract change by running the test with `UPDATE_WIRE_CONTRACT=1`; the test writes the fixture in its committed form, and the fixture is excluded from Biome in `biome.json` because it is generated and compared structurally.
- Treat `workspace-admin-api.ts` as the single contract for the Admin UI, the API, and `dhw`. Extend the generic mutation endpoint and client unless the transport itself changes.
- Give each new response field a decoding default so a newer `dhw` still decodes an older server's response. `CliSession.expiresAt` and the payment-attempt `refundedAmount` and `refundedAt` fields use `Schema.withDecodingDefaultTypeKey` to decode a missing value as `null`. The overview's `uniqueCustomers`, `newCustomers`, and `refundAttention` decode a missing value as `{ value: 0, unavailable: true }`, and `dhw` shows it as unavailable rather than zero. The "overview contract" test in `workspace-admin-api.test.ts` decodes the current response with the released schema.
- Bounded filters use schema-typed GET query parameters. Keep service operations and shared schemas transport-independent.
- A response's code list that grows over time decodes a code the binary doesn't know as a plain string, as `AutomationEngineHealth.warnings` and `AutomationRunTimelineEntry` do. Renderers keep a map typed `satisfies Record<KnownCode, …>` and fall back to showing the code. Binaries before 1.28.0 (`openEngineWarningsDhwVersion`) decode engine warnings as a closed list, so `automationEngineWarningDhwVersions` records the first release that decodes each warning, and the CLI handler withholds a warning from older binaries (`cliClientIsAtLeast` and `currentCliClientVersion` in `features/admin-cli/cli-client-version.ts`). Give every new warning an entry; from 1.28.0 on, that's `openEngineWarningsDhwVersion`.
- `dhw` sends its version in `x-dhw-version` on every request. Where the `CliClientCompatibility` middleware runs (the `campaigns` and `automations` groups, and the invoice list and detail), an endpoint or group annotated with `MinimumDhwVersion` (`dhw-version.ts`) rejects a missing, malformed, or older version before its handler runs (`features/admin-cli/cli-client-version.ts`). `getInfo` lists every minimum, and a test fails if an endpoint with a minimum lacks the middleware. When a response gains a field or value that older binaries would drop and then write back, raise the minimum on the affected endpoints in the same PR as the writer. Production deploys on every push to `main`, before the `dhw` release that decodes the change publishes, so a minimum raised for a value older binaries can't decode refuses every released binary until then. For a read-only value they can't decode, withhold it from older versions in the handler instead, as engine health does with its warnings; they get the rest of the response.
- Released binaries decode only the errors their own contract declared on the endpoint. `OutdatedDhwRefusal` picks the rejection: `CliInputInvalid` (the default) where the endpoint declared it from its first release, as `campaigns` and `automations` do; `CliServiceUnavailable`, which every authenticated endpoint declared from the start, for an endpoint that gains a minimum later. The invoice list and detail require 1.25.0 (`invoicesMinimumDhwVersion`), the first release that decodes the `assistant` invoice source, and refuse older binaries with `CliServiceUnavailable`, which they print.

## Operation annotations

Every endpoint declares what its operation does, using the keys in `packages/workspace-admin-api/src/administration-operation.ts`. The annotations describe the operation, not a channel: `dhw` confirmations follow them, and any other administration channel must too. When you add or change an endpoint:

- Annotate it with exactly one of:
  - `AdministrationOperationBehavior`, for an operation every administration channel serves. Use `readOperation`, `writeOperation({ idempotent })` or `destructiveOperation({ idempotent, preview })`.
  - `AdministrationOperationVariants`, for a generic mutation endpoint. Each union member is its own operation. Add the new variant to `discountMutationOperations` or `reservationAccessMutationOperations`; the `satisfies Record<kind, …>` fails the typecheck until you do.
  - `CliOnly { reason }`, only for the CLI's own sign-in handshake and client checks.
- `destructive` means `dhw` asks before running it: it cancels, sends, deletes, revokes, publishes, issues a credential, or changes who may claim a discount. A destructive command calls `confirmChange` with the operation's reference (`<group>.<endpoint>`, or `<group>.<endpoint>.<kind>` for a variant). `apps/dhw/src/command-runtime.test.ts` runs every confirming command without `--yes` and checks that the confirmed operations and the destructive operations are the same set, so add the command's row there.
- `idempotent` is true only when repeating the same input, request ID included, has no further effect: reads, request-ID ledger writes, and writes that set a state. Sending email again or starting another job is not idempotent.
- Give a destructive operation a `preview` when a read can show what it would change: `dryRunPreview` for an endpoint with a `dryRun` input, or `readPreview(...)` naming read operations. The read operations take the operation's own arguments by name; when a read names one differently, such as `codeId` for a code deleted by `id`, use `readPreviewWithArguments({ codeId: "id" }, ...)`. Leave the preview out when no read endpoint exists yet. The MCP tools' parity test fails when a preview read needs an argument the operation doesn't take.
- Mark a schema that lets its holder act (a token, a code, a PIN) with `credential: true`. Only `CliOnly` endpoints may return one, apart from the entries in `disclosedCredentials`; today that's the one-time standalone access-code PIN.
- Put the endpoint in a group that uses `AdministrationAuthentication`; only `CliOnly` endpoints use the CLI's own bearer. Handlers take the actor and channel from `CurrentAdministrationCaller`, never from input.
- Keep a campaign port operation's `query` or `mutation` kind consistent with the endpoint's `read` or write kind; ledger operations are idempotent.

`packages/workspace-admin-api/src/administration-operation.test.ts` checks all of the above.

## Admin UI operations outside the contract

Every Admin UI operation has a contract endpoint unless it's on this list. When you add an Admin UI operation, add its endpoint in the same PR or add it here with the reason.

UI-only:

- Reservations and customers CSV exports (`app/[locale]/admin/reservations/export/route.ts`, `app/[locale]/admin/customers/export/route.ts`): a browser download in a locale-specific format. `listReservations` and `listCustomers` page the same data.
- CLI login approval and its request detail (`features/admin-cli/actions.ts`, `features/admin-cli/page-data.server.ts`): approval mints a CLI credential and is bound to the browser's one-time code, so a person approves it in the browser.
- Campaign image upload (`features/email-campaigns/admin/editor/actions.ts`): a browser file upload to Cloudinary. Markdown bodies can reference images that are already uploaded.
- The admin locale switch (`features/administration/administration-locale-switcher.tsx`): browser navigation and the account's locale preference, not administration.

`CliOnly` endpoints: `cli.getInfo`, `startAuthentication`, `getAuthenticationStatus`, `exchangeGrant`, and `getCurrentSession`. They're the CLI's own sign-in handshake and client checks, and three of them return credentials.

## Authentication and sessions

1. `dhw auth` creates a five-minute authentication request and prints an unprefixed `/admin/cli/authenticate` URL, which the proxy redirects into the operator's locale.
2. An administrator signed in with their account approves it in the administration and picks the session lifetime.
3. The CLI exchanges a single-use grant bound to its local verifier and stores the opaque bearer in macOS Keychain or the Linux Secret Service.

Rules:

- The server persists only SHA-256 digests of bearers.
- Approval records the approving administrator's account actor on the request, and exchange copies it to the session (`approved_by_account_*`). The API returns the email snapshot as `approvedByEmail` and, for released `dhw` binaries that cap `approvedBy` at 80 characters and read null as a legacy session, a shortened copy as `approvedBy` (`toAdministrationActorName`). Keep `approvedBy` within that contract; the `CLI session contract` test in `packages/workspace-admin-api` decodes with the dhw-v1.17.0 schema. `CliSessionAdministrationAuthenticationLive` resolves the session's approving administrator once per request and provides it, with the CLI session channel, as `CurrentAdministrationCaller`. Handlers take the provenance actor for invoices and access codes from it, never from CLI input.
- A session stops working when it's revoked, when it expires, when its approving account loses the administrator grant or awaits deletion, or when it has no approving account (an unlinked pre-account session). Bearer authentication reads the grant on every request, so a revocation applies on the next one. Every failure is `CliSessionUnauthorized`, and `dhw` deletes the stored credential. Exchange and approval also fail when the approver lost the grant. Each share-locks the grant row (`AccountRoleGrants.lockHeld`) in the transaction that writes the session or the grant token, so a concurrent revoke waits for that write and then undoes it.
- Revoking an administrator grant (`AdministratorRoster.revoke`, behind both the Administrators page and `administrators.revokeAdministrator`) ends that account's CLI access, and a later re-grant revives none of it. In the grant-removal transaction it clears the grant token of every approved, unexchanged request the account approved, then sets `revoked_at` on every unrevoked session it approved (`features/admin-cli/administration-cli-access.ts`). Tokens go first so an exchange racing the sweep either commits its session before the sweep reads it or finds its token gone. A failed revoke rolls back whole. Revoking an account whose grant is already gone still runs the cleanup. Single-session revocation goes through the same `revokeCliSessions`.
- Session list, rename, and revoke are scoped to the approving account.
- Expiry is computed at approval in `Europe/Prague` calendar units. `NULL` means the session never expires.
- The session label (default `dhw on <machine-name>`, or `--name`) is descriptive only. The session ID is its identity.
- The public authentication-start endpoint fails closed without a Vercel Firewall rate limit with the ID `cli-authentication-start` (10 requests per IP per minute, then 429). The Workspace Vercel project must define it.

## Output and confirmation

- `--json` reserves stdout for one final JSON result. `dhw auth --json` writes approval instructions to stderr.
- Every administration command that has a `--yes` flag runs a destructive operation and prompts for confirmation through `confirmChange`, which names that operation. With `--json` or without a TTY on both stdin and stdout, it fails unless you pass `--yes`. `dhw update --json` without `--yes` only reports an available update.
- Reservation detail includes safe access-grant metadata, never the PIN.

## Retries and idempotency

- Discount, reservation-access and standalone access-code mutations carry a client-generated request ID. `AdministrationRequestLedger` (`features/admin-cli/administration-request-ledger.service.ts`) stores the request and result per caller channel, so retrying after an ambiguous transport failure replays the stored result instead of applying the mutation twice. A replayed access mutation returns safe grant metadata without issuing another credential.
- Mutations with external effects call `applyOnceWithEffects` with a stored-result codec and a named `RecoveryPolicy` from `administration-mutation-recovery.ts`: which failures release the claim, whether recording the result is `required` or `best-effort`, and whether a retry resumes a claim left for the stale window (`resumeAfter`) or reports it in progress (`noResume`). Handlers never sequence the claim themselves. Change a policy only together with its disposable-Postgres pins in `administration-request-ledger.service.test.ts`; a wrong release can issue a second Igloohome PIN or strand a claim. Stored results are `CliStoredMutationResult`s, which never carry a PIN.
- An incomplete access request claim can be reclaimed after one minute. Recovery returns an issued grant, safely retries a failed grant, or requires provider reconciliation for every ambiguous state.
- `dhw invoices create --input <file>` decodes the file with the strict `AdministrationInvoiceCreateFileInput` schema, which rejects unknown properties at every level. The file supplies the invoice UUID, and `dhw` sends it unchanged across retries. After an uncertain attempt, rerun with the same file. The server rejects the same UUID with different input.
- Keep invoice customer data out of the generic CLI mutation ledger.
- `administration.previewInvoice` renders the same input as `createInvoice` to a PDF and writes nothing. It's a POST read and `createInvoice`'s declared preview, and it fails as create does. `dhw invoices preview --input <file>` decodes the file as `invoices create` does. A preview skips the conflict checks, so a rendered preview doesn't guarantee creation succeeds.
- The ledger (`cli_mutation_requests`, named before assistants) is scoped per administration channel: each row belongs to exactly one CLI session or one administrator assistant connection, and a request ID is unique only within its channel. Partial unique indexes replace the old primary key, so an untargeted `on conflict do nothing` still detects a repeated claim. The ledger reads the scope from `CurrentAdministrationCaller.channel` itself.

## Channels and action records

- `CurrentAdministrationCaller.channel` is a `CliSession` or an `AssistantConnection`. An assistant connection (`administrator_assistant_connections`, `AdministratorAssistantConnections.connect`) is one row per administrator account and OAuth client, so it survives a disconnect and reconnect; it records the login-email snapshot, the client ID and its published name, and a last use written at most every five minutes.
- Invoices and standalone access-code events record their provenance `source` from the channel: `dhw-cli` or `assistant`.
- `AdministrationActionRecord` runs on every authenticated group and records each `write` or `destructive` operation, read from its `AdministrationOperationBehavior` or, for a generic mutation, the variant the body names, in `administration_actions`: the operation reference, the actor and its email snapshot, the channel, and the outcome. It stores no input or output. A dry run is a read and isn't recorded: an operation whose declared preview is `dryRunPreview` and whose body decodes with the endpoint's payload schema to `dryRun: true`, from `dhw --dry-run` or an MCP preview alike. A body that doesn't decode is recorded, and the endpoint rejects it. Add it to a new authenticated group before `AdministrationAuthentication`, so it runs inside authentication.
- The row is written as `started` before the operation runs; if that write fails the request fails with `CliServiceUnavailable` and nothing runs. The outcome (`succeeded`, `replayed`, `failed` with the error tag, `defect`, `interrupted`) is written afterwards and only logged when it can't be, so a row left `started` means the outcome is unknown. Outcomes describe the request, not whether state changed. `replayed` means the request ledger found a stored result (it marks `CurrentAdministrationAction`); invoice retries replay through their own ledger and record `succeeded`.
- Released `dhw` binaries before 1.25.0 can't decode the `assistant` invoice source, so the invoice list and detail refuse them (see [Contract changes](#contract-changes)); operators update `dhw`.

## MCP tools for administrators' agents

`/api/mcp` serves every contract operation to an administrator's AI agent as a tool, derived at runtime from `WorkspaceAdminApi` in `apps/deskohub-workspace/features/administration-agent-tools/`. A new endpoint becomes a tool with no tool code: annotate it as above and the parity test (`administration-agent-tools.test.ts`) checks it. When you add an endpoint:

- Every endpoint except `CliOnly` ones gets a tool, `admin_<endpoint>` in snake case; each generic mutation variant gets its own, `admin_<endpoint without "mutate">_<kind>`. Annotations follow the operation: `readOnlyHint` for `read`, `destructiveHint` for `destructive`, `idempotentHint` from `idempotent`.
- A tool's arguments are one strict object: path parameters, query fields (as their wire strings) and the payload's fields, plus `confirm` on destructive tools. A variant's fields sit beside the payload's other fields, without its discriminator. A payload that isn't one plain object is passed whole as `payload`. Arguments that collide across these parts fail the derivation, so name them apart.
- `requestId`, `attemptId` and the invoice UUID stay required arguments; the agent sends a new UUID per intended change and repeats it only to retry.
- Every tool call runs `AdministratorAgentAuthorization.authorize` before it answers anything, so a grant that ended after the listing refuses even a preview that reads nothing, with `administration_failed` and the same `CliSessionUnauthorized` the API answers.
- A destructive tool without `confirm: true` changes nothing and answers `confirmation-required` with the declared preview: the reads' current results, or the same endpoint's dry run. `dryRun: true` runs without confirmation. Neither leaves an action record.
- Results are the success schema's JSON; a non-object answers `{ items }`, and a binary body (`getInvoicePdf`, `previewInvoice`) answers its URI, type and size with the document attached as an embedded resource. Hosts don't document how they show an attached PDF, so the structured result names it on its own. A typed error answers `isError` with `administration_failed` and the API's encoded error, whose message reaches the administrator.
- The derivation refuses an operation whose success or error schemas can carry a `credential` outside `disclosedCredentials`. The standalone access-code PIN reaches the administrator's assistant once, as `dhw` shows it.
- Tools call the API's own client in process, against a second instance of `makeWorkspaceAdminApiLayer` that no URL routes to (`administration-assistant-api.server.ts`). Its `AdministrationAuthentication` re-verifies the agent's OAuth token, runs `AdministratorAgentAuthorization.authorize`, names the client through `CustomerAgentClientDirectory.Server`, and calls `AdministratorAssistantConnections.connect` with those verified values only, so tool input never reaches the actor, channel or ledger scope. That instance refuses CLI bearers, and `/api/v1/cli` refuses OAuth tokens.
- The route lists the tools, after the customer tools, only when the token has `administration` and the grant is live for that request; a grant that can't be checked answers 503. Without access, a call is an unknown tool. A Grit rule (`lint/no-administration-agent-tools-imports.grit`) keeps every module but `app/api/mcp/route.ts` from importing the tools, so customer listings and `llms.txt` can't reach them.

## Discount targets

`--product cowork` targets every cowork tier. `cowork:open-space` and `cowork:reserved-desk` target one tier and can't be combined with `cowork`. See [discounts.md](discounts.md#cowork-tier-targets).

## Email campaigns

- The campaign contract lives in `packages/workspace-admin-api/src/email-campaigns.ts`, and `features/admin-cli/email-campaigns-api.server.ts` serves it with the services the campaign admin UI uses.
- Bodies cross the API as Markdown or as the editor's document. Markdown is `dhw`'s form: the server reads and writes both forms only through the content codec (`body/campaign-content-codec.ts`: `readCampaignContent`, `readCampaignDraftContent`, `changeCampaignContent`, `writeCampaignContent`), and `dhw` never parses Markdown itself. Markdown can't round-trip every editor document (typed `# ` reads back as a heading), so the composer and the automated Email tab read `getCampaignEditorContent` and write `bodyDocument`, the versioned TipTap JSON stored as is (`AdministrationCampaignBodyDocument` in `campaign-body-document.ts`; Workspace adds the content rules when the codec reads it). Administrators' agents get both forms like every endpoint: `admin_get_campaign_editor_content`, and `bodyDocument` beside `bodyMarkdown` in the campaign write and preview tools. Each locale's body takes one form: complete content is a union of the two, and a change refuses both keys. `getCampaign` and the write responses keep `bodyMarkdown` only: released binaries decode them strictly, so adding the document there would need a minimum bump. Bumping `campaignBodyFormatVersion` needs a migration of stored bodies, automation versions, and stored `cli_mutation_requests` results.
- `previewCampaignTemplate` takes a saved `Campaign`, unsaved `Content` held to the rules saving applies, or `UnfinishedContent`, whose body skips the content rules for links, buttons and images (`readCampaignDraftContent`). The composer's live preview sends `UnfinishedContent` through the generic campaign-operation bridge; keep it the only relaxed path and never save through it.
- `AudienceFilter` in the contract is the only audience filter schema. Workspace re-exports it from `features/email-campaigns/audience-filter.ts` as `audienceFilterSchema`. On its own it ignores excess properties, so stored filters keep decoding. The strict API inputs that embed it reject them, and `dhw` decodes filter files with the same strict parse options. Keep its encoded form stable: `email-campaigns.test.ts` pins the stored wire format byte for byte. Each condition schema lists `attribute` before `_tag`: a Schema union dispatches on the first literal key it indexes, so this order checks a condition only against its own attribute's shapes and reports errors at its fields. A change to the stored shape needs a data migration of `email_campaign_audiences.filter`, `email_campaign_sends.audience_filter`, and stored `cli_mutation_requests` results that embed an audience.
- `campaigns.getCampaignSettings` is a campaign port query, so the composer and `dhw campaigns settings` read the same settings. Its `testSendInbox` is null where campaign email isn't configured.
- `administration.listDiscountGroups` and the audience filter's discount-group options share one Dotypos read (`features/discounts/discount-groups.ts`): every group that isn't deleted and has an ID, with a blank name as null. The UI names unnamed groups, sorts, and fails open; the API fails with `CliServiceUnavailable`.
- Unparsable or invalid input fails with `CliInputInvalid` (400), and state conflicts fail with `CliMutationRejected` (409). Both messages reach the operator verbatim, so keep them actionable.
- Campaign create, campaign duplicate, and audience create go through the request ledger (`AdministrationRequestLedger.applyOnce`, through the `OperationRequestLedger` port), so a retried request replays its first response instead of leaving an extra row. `applyOnce` runs the claim, the mutation, and the stored result in one database transaction, so any failure or crash rolls all three back and frees the request ID. `applyOnce` opens it with `transaction`, so its `apply` may require `WorkspaceTransaction` (a writer that must commit with the claim) and `applyOnce` discharges it. `apply` must write only through `WorkspaceDatabase`: statements on its `db` join the transaction and a nested `transaction` is a savepoint, while external side effects (provider calls, email) don't roll back and belong in `applyOnceWithEffects`, which the discount and access mutations use. Updates, archive, and unarchive are idempotent; a confirmed send is single-use by its confirmation code, and retry needs a Failed campaign.

## Automations

- The automation contract lives in `packages/workspace-admin-api/src/email-automations.ts`; its `automations` group has one endpoint per automation operation. `dhw automations` and `dhw calendar` call it.
- `dhw` decodes `--flow-file` and `--expression` JSON with the strict parse options through `decodeJsonInput` (`apps/dhw/src/json-input.ts`), so an unknown key fails before any request.
- `dry-run` and `activate` without `--preview` poll the dry run every two seconds through `pollUntil` (`apps/dhw/src/polling.ts`) until it settles, give up after 15 minutes, and then follow `nextCursor` to print every row. Rerunning reuses the running dry run.
- `activate` gates only on `AutomationDetail.activation` (`Published` means nothing to activate) and the server's answer. It never checks readiness itself, so refusals such as `automation-draft-changed` reach the operator verbatim.
- `show`, `flow set`, `dry-run`, and the activation prompt print the server's `frequency` as a red `warning:` on stderr when `firesMoreThanHourly`. `dhw` never computes frequency, and the warning never blocks.
- A schedule may fire only on the engine's tick minutes (`emailAutomationScheduleMinutes`: :00, :15, :30, :45). `validateAutomationFlow` enforces it on every save through the contract's `scheduleMinutesOffTick`, so the Admin UI, the API and `dhw flow set` refuse the same flows with `schedule-minutes-not-allowed`. Calendar waits may use any minute. Keep the rule in that one helper rather than in the schema, so stored flows still decode.

## Reservation product-details backfill

Meeting-room and office snapshots (`workspace_reservations.reservation_details`) written before they recorded the catalog identity hold only `kind`. Audience product filters can match those rows only at family level. `dhw reservations backfill-product-details` fills them through `ReservationProductDetailsBackfill` (`features/reservation/backend/reservation-product-details-backfill.service.ts`):

- Each `POST /reservations/product-details-backfill` call reads one batch of 50 meeting-room and office rows after the `after` cursor, in ID order, and fetches only the incomplete rows from Dotypos with one `listReservations({ ids })` call. `dhw` follows `nextCursor` until it's null and totals the batches.
- A meeting room's interval must match a catalog offer exactly (`findMeetingRoomReservationDuration`). An office interval must run between Prague midnights (`getOfficeReservationSelection`); Dotypos `seats` gives the seats. The reservation note is freeform and never read.
- A row it can't resolve stays as it is and is reported with its reason: `dotypos_reservation_id_missing`, `dotypos_reservation_not_found`, `dotypos_interval_invalid`, `interval_not_in_catalog`, `dotypos_seats_invalid`, or `stored_details_malformed`. Complete rows are counted and skipped, so a rerun changes nothing.
- An update replaces only the snapshot it read and leaves `updated_at` alone, because that column orders admin activity and guards claims.
- `--dry-run` reports what it would fill without writing and needs no confirmation. A real run needs `--yes` with `--json` or without a TTY.

Don't run it in production while a deployment that predates the optional snapshot fields can still read reservations: those deployments decode snapshots strictly and reject the new keys. That includes Skew Protection, pinned late-payment recovery queue messages, and an instant rollback target. See [database-and-releases.md](../../deskohub-workspace-operations/references/database-and-releases.md).

## Customer account backfill (removed)

Release A of #682 shipped `dhw accounts backfill` (`POST /accounts/backfill`) to give every login a durable customer account, copy Dotypos links onto the accounts, and give authorless reservations an author, creating silent unverified logins for unlinked legacy customers. Release B's migration enforces all of it (the `auth.user` foreign key to `customer_accounts` and `NOT NULL` reservation authors) and fails if the backfill didn't run, so B removed the command and the endpoint; a released `dhw` that still calls it fails against B.

## Administrator role grants and legacy actor backfill

Administrators sign in with their customer accounts; the `administrator` grant authorizes the administration, the API, and CLI sessions. Records written before the switch carry a legacy Basic-auth username instead of an account actor.

- `account_role_grants` stores one row per account and role (only `administrator`): `account_id` (cascades with `auth.user`), `granted_by_account_id` (null for bootstrap grants; set to null when the granter is deleted), and `granted_at`. `AccountRoleGrants` (`features/administrators/backend/account-role-grants.service.ts`) grants, revokes, and checks. `has` reads the database on every call, so a revocation applies on the next check; never cache it.
- `AdministratorRoster` (`features/administrators/backend/administrator-roster.service.ts`) holds the grant policy for the Administrators page and the API alike: it grants only to an active account (verified login email, no pending deletion), records the caller as the granter, and refuses self-revocation. `administrators.listAdministrators`, `grantAdministrator` and `revokeAdministrator` (`dhw administrators list|grant|revoke`) call it with the caller's actor. Grant answers the same `CliResourceNotFound` for an unknown, unverified, or pending-deletion account, so the API doesn't reveal which. Self-revocation is `CliMutationRejected`. Grant and revoke are destructive; revoke takes the account ID, and without `--yes` `dhw` reads the roster first so the prompt names the email.
- Revoking the grant also revokes the account's CLI sessions and approved CLI grants (see Authentication and sessions), so a later re-grant starts with no CLI access.
- An account actor is the account id plus a snapshot of its login email. CLI authentication requests and sessions (`approved_by_account_*`) and standalone access-code events (`actor_account_*`) carry it beside the legacy username column, which is null on new rows; a CHECK constraint requires one of them. New manual invoices store the email snapshot as the document's provenance actor and write their `manual_invoice_actors` row in the issuing transaction. Issued invoices are immutable (`invoices_immutable` trigger), so a manual invoice's account actor lives in `manual_invoice_actors`. The id is set to null when the account is deleted, and the email snapshot stays. A record counts as linked once it has an email snapshot.
- `dhw administrators backfill-legacy --legacy-username <name> --email <email>` calls `POST /administrators/legacy-backfill`, served by `LegacyAdministratorBackfill` (`features/administrators/backend/legacy-administrator-backfill.service.ts`). In one transaction, under an advisory lock per username, it grants the role to the active account (verified email, no pending deletion) that signs in with the email, and links that username's unlinked CLI sessions, events, and manual invoices to the account. Manual invoices store their legacy actor only in the encrypted document, so it decrypts every manual invoice; one undecryptable invoice fails the run.
- It reports per table how many records it `linked`, were `alreadyLinked` to this account, or were `linkedToOtherAccount` (left unchanged), and whether the role was `granted` or `already_granted`. Since the account gate, nothing writes usernames anymore, so a final rerun after deploy links any records written before it. No account for the email fails with `CliResourceNotFound`, so the person must sign in once first.
- `--dry-run` reports the same result without writing and needs no confirmation. A real run needs `--yes` with `--json` or without a TTY.
- The username-to-email mapping is runtime input. Emails are PII: never commit the mapping, and keep it out of logs and issues.

## Standalone access codes

`dhw access-codes create` shares the server workflow in [dashboard.md](dashboard.md#standalone-access-codes). The CLI adds local state:

- Before sending, the CLI reserves the attempt ID in the state directory under a per-request lock file that carries an owner token. A contender never steals the lock. It waits a bounded time, then fails closed with manual-recovery instructions.
- Rerunning the same command on the same machine and session reuses the reserved ID, so an interrupted run can't create a second code.
- The reservation is released once creation concludes, so a later intentional creation gets a fresh ID. If the file can't be deleted, it's marked concluded instead.
- If the local reservation can't be written or read, the command refuses to create a code.
- After a cleanup-required error, the operator removes or verifies the named attempt's credential in the Igloohome app over Bluetooth, then reruns with `--provider-credential-removed <attempt-id>`. On a `reconciled` answer, `dhw` reissues the creation under a fresh ID in the same invocation.

## Configuration

- `DHW_BASE`: Workspace origin. Must be an HTTPS origin, or an HTTP origin on `localhost` or `127.0.0.1`. Only published releases (built with `DHW_BUILD_CHANNEL=release` by `dhw-release.yml`, see `isReleaseBuild`) default to `https://workspace.deskohub.cz`. PR artifacts, local native builds, source runs and development builds fail closed without it, except `--help` and `--version`; point them at a local or preview Workspace, and pass the production origin only to work against production on purpose.
- `DHW_CREDENTIAL_STORE`: `system` (default) uses the operating-system credential store, keyed by Workspace origin. `memory` keeps credentials for one process only.
- `DHW_REQUEST_HEADERS`: JSON object of extra API headers, such as a Vercel protection-bypass header. Values are redacted, can't override headers that `dhw` manages, and are never sent to GitHub.
- `DHW_STATE_DIR`: overrides the state directory for updater state and access-code attempt reservations.
- `DHW_NO_UPDATE_CHECK=true` disables automatic update checks. They also never run for `--json`, under `CI`, or without a TTY.

Only published releases check for or install updates. `dhw update` forces a check. Automatic checks persist the GitHub ETag and wait 30 seconds between requests. The updater accepts only a stable, immutable `dhw-v*` release asset for the build target embedded at compile time, with the expected size and SHA-256 digest and a matching self-reported version and target. Never infer the target from the host OS or architecture. Windows is unsupported.

## Checks

Run the CI-equivalent checks from `.github/workflows/dhw-ci.yml` for contract or CLI changes:

```bash
bun turbo lint --filter=@deskohub/workspace-admin-api --filter=dhw
bun turbo typecheck --filter=@deskohub/workspace-admin-api --filter=dhw
bun --cwd apps/dhw test
bun test packages/workspace-admin-api
bun turbo test:admin-cli --filter=./apps/deskohub-workspace
bun apps/dhw/src/build.ts development
DHW_BASE=http://localhost:3000 apps/dhw/dist/dhw version --json
```

`apps/dhw` tests preload `src/testing/test-isolation.preload.ts`, which replaces `Bun.secrets` and sends non-local requests to an unreachable proxy. Start `dhw` subprocesses only through `runDhw` (`src/testing/dhw-process.ts`): it passes an environment built from scratch with the memory credential store, a fresh home, no `.env` loading, and a trap that records and refuses every request outside localhost. It rejects the production origin, and the system credential store for compiled executables, which skip the preload. Never run `dhw` against production or with the system credential store in tests.

Development builds report `<version>+development`, and PR artifacts report `<version>+pr.<number>.<head-sha>`. Published releases use the plain package version.

## Releases

Release Please owns `apps/dhw/package.json`, `apps/dhw/CHANGELOG.md`, and the `dhw-v*` tags.

- A pull request that changes `apps/dhw` or `packages/workspace-admin-api` needs at least one `feat(dhw): ...` or `fix(dhw): ...` commit.
- A contract change under `packages/workspace-admin-api` must also change `apps/dhw`, because Release Please scopes the component to `apps/dhw`. `dhw-ci.yml` rejects contract-only changes.
- Files matching `*.test.ts` and `*.golden.json` do not count as releasable `dhw` changes.
- After merge, `.github/workflows/dhw-release.yml` auto-merges the Release Please pull request, then builds, attests, uploads, and publishes the binaries with `SHA256SUMS`. There's no manual release step.
- The workflow needs a GitHub App (Contents, Pull requests, and Issues read/write; Administration read) in the `DHW_RELEASE_APP_ID` variable and `DHW_RELEASE_APP_PRIVATE_KEY` secret. The repository must allow auto-merge and merge commits and have immutable releases enabled. The workflow fails closed without immutable releases.
