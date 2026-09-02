# Magic-link delivery and protected-preview retrieval

Research date: 2026-09-02

This note resolves the research question in
[Research magic-link delivery and protected-preview retrieval](https://github.com/totalolage/deskohub-site/issues/343).
It records current primary-source facts and viable arrangements; it does not
implement or provision one.

## Executive finding

The viable arrangement is to keep production and test email authority separate:

- Production uses the existing Resend path with a sending-only, domain-scoped
  API key. Production message retrieval credentials are never available to CI.
- Preview auth delivery uses a separate Resend team/account and domain that may
  contain only synthetic messages. The deployed preview receives only a
  sending-only, domain-scoped key for that test tenant.
- The protected GitHub E2E environment receives a different full-access key for
  that synthetic-only tenant. The runner uses Resend's list and retrieve APIs to
  find the message for a unique Resend test address, extracts the bearer link in
  memory, validates its exact immutable-preview origin, and never prints it.
- Focused local tests use an injected fake delivery callback. A human local flow
  either uses explicitly supplied credentials for the synthetic Resend tenant or
  remains disabled and fails closed.

Resend does not offer a read-only API-key permission: keys are either full access
or sending access. A CI retrieval key therefore has broad authority inside its
tenant. Isolating it in a synthetic-only tenant is the security boundary that
keeps production mailbox and domain authority out of exact-SHA code.

The SMTP server configured in the Neon dashboard belongs to managed Neon Auth.
Better Auth runs in the Workspace application and calls an application-owned
`sendMagicLink` callback. Reusing the SMTP service would require a new transport
and separately provisioned Vercel credentials, and SMTP alone does not provide a
deterministic message-retrieval API. It is not the shortest viable path while
Workspace already uses Resend.

## Better Auth's delivery boundary

Better Auth creates and verifies the token but delegates delivery to the
application. The magic-link plugin calls `sendMagicLink` with `email`, `url`,
and `token`; the URL is the bearer credential. The plugin's documentation also
warns that awaiting delivery can enable timing attacks and recommends triggering
delivery without blocking the response. See the official
[magic-link plugin](https://better-auth.com/docs/plugins/magic-link).

The callback must therefore:

1. hand the message to an owned provider capability;
2. return the same outward sign-in response regardless of account existence or
   provider timing;
3. keep the email, raw token, complete URL, and rendered body out of logs,
   traces, exception messages, and provider metadata; and
4. expose delivery failure only through fixed internal codes and aggregate
   operational signals.

The callback is not a test hook. Preview E2E should exercise the production-shaped
callback and provider API, then retrieve the resulting synthetic message out of
band.

## Existing Workspace email path

Workspace currently selects one global provider from
[`email.config.ts`](../../../../../apps/deskohub-workspace/shared/backend/config/email.config.ts):
Resend or console. The shared message type includes recipients, content, tags,
and metadata in
[`email.types.ts`](../../../../../packages/email/types/email.types.ts).

Neither current provider can safely carry a magic link unchanged:

- [`console-provider.ts`](../../../../../packages/email/backend/providers/console-provider.ts)
  logs sender, recipients, subject, tags, and metadata. In development it prints
  the text body and the first 500 HTML characters, which would expose the bearer
  URL and recipient.
- [`resend-provider.ts`](../../../../../packages/email/backend/providers/resend-provider.ts)
  attaches the full message to Effect log annotations and logs provider responses
  and addressing metadata. A magic-link message passing through this boundary
  could reach logs or traces even if Better Auth itself is configured correctly.

Implementation must first establish a safe auth-email logging boundary. It may
adapt the shared provider or add a purpose-specific auth delivery capability, but
its telemetry may contain only fixed event codes, provider name, non-sensitive
status, latency, and opaque delivery ID. Do not attach or stringify the message,
provider request, provider response, or thrown SDK object.

The current protected-preview contract sets `EMAIL_PROVIDER=console` in Preview
and reserves Resend for Production; see
[`preview-workflow.md`](../../deskohub-workspace-e2e/references/preview-workflow.md).
Real preview magic-link delivery requires a deliberate narrow change to that
contract. The two viable choices are:

1. send every Preview email through the synthetic Resend tenant; or
2. retain console delivery for reservation/checkout messages and select the
   synthetic Resend provider only for auth messages.

The first is less configuration but consumes provider quota for unrelated E2E
emails and changes established checkout behavior. The second creates a
purpose-aware provider boundary but limits external delivery and privileged
retrieval to auth. This is a later implementation decision; a single global
Preview provider must not be changed accidentally as a side effect of auth.

## Resend capabilities and constraints

### Synthetic addresses

Resend supplies test recipients that work without delivering to a real inbox.
`delivered@resend.dev` simulates successful delivery, and plus-address labels such
as `delivered+user1@resend.dev` are supported for distinct test cases. See
[What email addresses to use for testing](https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing).

Every E2E run can therefore generate a unique, non-PII address whose label encodes
only a random run identifier. The address must still be registered with the E2E
redactor before any request or diagnostic operation. These addresses prove the
real Resend API request and stored message path; they do not prove delivery to a
third-party mailbox.

Resend's official
[Playwright E2E guide](https://resend.com/docs/knowledge-base/end-to-end-testing-with-playwright)
uses the test addresses for real API calls and notes that they count toward the
account's daily quota. Existing Workspace provider serialization and rate-limit
constraints still apply.

### Retrieval API

Resend provides:

- [`GET /emails`](https://resend.com/docs/api-reference/emails/list-emails) to
  list sent emails with pagination and addressing metadata; and
- [`GET /emails/:id`](https://resend.com/docs/api-reference/emails/retrieve-email)
  to retrieve a sent message, including its HTML/text content and tags.

The list API does not document an exact-recipient server-side filter. The runner
must page only through a bounded recent time window, match the exact unique
recipient locally, and reject zero or multiple matches. Adding non-secret run and
commit tags when sending provides another equality check, but tags are not bearer
credentials and must not contain PII.

Resend stores message content by default. Disabling storage removes the ability to
retrieve message content and is subject to plan/configuration constraints; see
[How do I ensure sensitive data isn't stored on Resend?](https://resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend).
Content retention must remain enabled only in the synthetic test tenant for the
retrieval window. Production retention is an independent policy and never a CI
dependency.

### API-key authority

Resend documents only two API-key permissions:

- `sending_access`, optionally restricted to one domain; and
- `full_access`, which can create, delete, get, and update account resources.

See the official [API Keys introduction](https://resend.com/docs/dashboard/api-keys/introduction)
and [Create API Key API](https://resend.com/docs/api-reference/api-keys/create-api-key).
There is no documented read-only message-retrieval scope. The preview application
should receive a sending-only key. The CI runner needs a full-access key to list
and retrieve messages, but only for the isolated synthetic tenant. It must never
receive the production team's key or a key capable of sending from a production
domain.

## Environment-by-environment arrangement

### Production

- Use the existing Resend service and production sending domain.
- Give Vercel Production a sending-only key restricted to that domain.
- Do not put any Resend full-access key in Vercel, GitHub Actions, local checked-in
  files, or preview settings.
- Keep production recipient/content retention and operational monitoring outside
  the E2E workflow.
- Report delivery by fixed codes and opaque delivery IDs only. Never use provider
  message retrieval as an application feature.

### Preview and exact-SHA E2E

- Create a separate Resend tenant/team whose messages and domains are guaranteed
  synthetic-only. Its name and IDs are non-secret configuration; its keys are
  secrets.
- Give the Workspace Vercel Preview environment only a sending-only key scoped to
  the test domain. The application cannot list messages with that key.
- Store a distinct full-access retrieval key in the protected Workspace E2E
  GitHub environment. Exact-SHA code will necessarily receive it, so the isolated
  tenant is the blast-radius boundary. Do not reuse a personal or production-team
  key.
- Generate a unique `delivered+<opaque-run-id>@resend.dev` recipient for each
  lifecycle. Request a magic link through the protected immutable preview.
- Poll the list API with a bounded deadline and recent timestamp, match the exact
  recipient and non-secret run tags, retrieve that exact message ID, and reject
  ambiguity.
- Parse the one expected auth URL in memory. Before navigation, require HTTPS,
  the exact immutable preview host for the pushed SHA, the expected Better Auth
  callback path, and no unexpected redirect target.
- Register the recipient, URL, raw token/query, session cookie, and provider
  payload with the redactor before they can reach failure attachments. Do not
  include them in Playwright traces, HARs, screenshots, console output, step
  titles, GitHub summaries, or thrown messages.
- Exercise the real Better Auth verification route and resulting session cookie.
  Do not read the token from Postgres, add a token-returning route, ship
  `testUtils`, toggle a browser-controlled delivery mode, or add a Cloudflare
  tunnel/webhook.
- Clean up only records created by the run where the provider API and retention
  policy support that safely. Cleanup failure must not trigger broad deletion.

Vercel Deployment Protection remains orthogonal. The browser and direct preview
requests continue using the established automation-bypass header/cookie. Resend
retrieval is an outbound GitHub-to-Resend API call and needs no tunnel into the
protected deployment.

### Local development and focused tests

- Unit and integration tests inject a fake mail sender or renderer and capture
  the callback argument in process. This is test composition, not a deployed
  route or runtime environment switch.
- The normal local app must not print magic links. With no explicit delivery
  credentials, requesting a magic link remains disabled or fails closed with a
  generic response and a fixed internal diagnostic code.
- A developer who needs a complete local browser flow can explicitly supply a
  sending-only key for the synthetic tenant and retrieve the message using their
  own separately authorized tooling, or use an immutable preview.

## SMTP and dedicated mailbox alternatives

### Configured Neon SMTP

The SMTP values entered in Neon's dashboard configure managed Neon Auth; they do
not become application environment variables. Better Auth's app-owned callback
would need an SMTP library/transport plus host, port, username, password, sender,
TLS policy, retry policy, and Vercel environment provisioning. The current shared
email package has no SMTP provider.

SMTP submission also does not expose a standard API for listing and retrieving
the delivered message. A deterministic E2E flow would still require the SMTP
vendor's proprietary message API or a dedicated receiving mailbox. Recreating
that path adds code and operations without displacing Resend's existing production
integration, so it is not recommended for this implementation.

### Dedicated third-party test mailbox

A service such as a disposable test inbox can also expose messages by API. It is
viable if the team later leaves Resend or disables message storage, but it adds a
provider, credentials, retention policy, and another delivery dependency. Resend's
own synthetic recipients plus list/retrieve APIs already satisfy the exact-preview
requirement with fewer moving parts.

Do not use a shared human inbox. It makes correlation nondeterministic, introduces
real PII, and requires CI to hold credentials that typically grant broad mailbox
access.

## Failure and observability contract

The E2E runner should distinguish fixed, non-sensitive failure categories:

- auth request rejected;
- provider message not observed before deadline;
- ambiguous synthetic message match;
- message retrieval failed;
- message contains no single valid auth link;
- auth link origin/path mismatch;
- verification failed; and
- session not established.

Diagnostics may include the exact preview deployment ID/SHA, elapsed time,
attempt count, provider HTTP status class, and opaque delivery ID. They may not
include recipient, message body, subject if it embeds user data, provider response,
bearer URL, token, cookie, or database verification row.

## Decisions enabled by these facts

Later planning can now choose:

1. route every Preview email through the synthetic Resend tenant versus select
   external delivery only for auth;
2. the protected GitHub environment and retention window for the isolated
   full-access retrieval key;
3. the exact non-secret correlation tags, polling deadline, and cleanup policy;
   and
4. whether human local end-to-end use merits explicit synthetic credentials or
   should remain preview-only.

No production mailbox retrieval credential, generic SMTP transport, Cloudflare
tunnel, deployed test bypass, database token reader, or real recipient is required.
