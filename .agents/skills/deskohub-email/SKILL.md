---
name: deskohub-email
description: Email sending, @deskohub/email, @deskohub/email-resend, @deskohub/email-posthog, EmailServiceTag, provider chain, transactional or marketing stream, provider fallback, EmailDeliveryObserver, email provider timeouts or retries.
---

# Email providers and chains

`@deskohub/email` is the service and the chain runner; it ships no provider
and reads no provider settings. Each app composes its own provider chains.
Providers live in their own packages.

## Packages

- `@deskohub/email`: `EmailServiceTag.Default` sends each message through
  its stream's chain; `EmailServiceTag.RecipientRouted` does the same but
  sends a message addressed only to `deskohub.test` recipients to Console.
  An empty chain sends to the internal Console provider
  (`isConsoleEmailDeliveryId` recognises its IDs). `EmailProviders` is the
  context service holding `transactional` and `marketing` chains
  (`ReadonlyArray<EmailProvider>`) and `marketingCategories`. Result types:
  `EmailSendResult`, `EmailSendFailure` (`{ status: "failed", provider,
  timestamp, error }`), `EmailBatchResult`.
- `@deskohub/email-resend`: `makeResendEmailProvider({ apiKey, timeouts })`
  and `deploymentResendRequestTimeouts` (5 s, 10 s for a batch, in
  production; 30 s elsewhere, by `VERCEL_ENV`). It owns Resend's retries.
  The app reads `EMAIL_API_KEY` and passes it in.
- `@deskohub/email-posthog`: `makePostHogEmailProvider(config)` (provider
  name `posthog`) sends one message per request to PostHog's transactional
  email API, and `fetchPostHogEmailStatus(config, messageId)` reads a
  message's status (`Found` or `NotFoundYet`). Config: `secretKey`
  (`Redacted`), `host` (an ingestion host such as `eu.i.posthog.com` maps to
  the app host so the secret key never reaches ingestion), `systemIdentity`,
  optional `from` and `timeout`. It sends `distinct_id` = the message's
  `recipientIdentity`, else `systemIdentity`, because PostHog would
  otherwise use the recipient email; `template_key` = the message's
  category tag. It sends no custom headers, tags, or metadata, so no
  List-Unsubscribe. Its batch sends run 4 at a time under `<batchKey>:<index>`;
  two retries, 1 s base, 5 s an attempt in production and 30 s elsewhere.

## Streams and chains

A message is `marketing` when its first tag (`message.tags?.[0]`, the
category) is in the app's `marketingCategories`, otherwise `transactional`.

| App | Composition | Transactional | Marketing |
| --- | --- | --- | --- |
| Workspace | `apps/deskohub-workspace/shared/backend/config/email.config.ts` (`workspaceEmailProviders`, `WorkspaceEmailLayer`), recipient routed | Resend | PostHog, then Resend, for category `email-campaign` |
| Boardgame Bar | `apps/deskohub-boardgame-bar/shared/backend/config/email.config.ts` | Resend or Console (`EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_TEST_MODE`, stage) | none |

Without a Resend key, Workspace sends everything to Console. The marketing
stream is the category, not the campaign purpose: operational-purpose
campaigns share `email-campaign` and also go to PostHog. PostHog stays off
the transactional stream by decision: it receives recipients and bodies, so adding it
to the transactional chain or another category changes the privacy notice
first (`deskohub-workspace-account` skill, `references/privacy-and-retention.md`).

## Fallback

`continuesEmailChain(error)` decides whether the next provider gets the
message. It continues on `EmailServiceError` with `failureKind: "provider"`
(429, 401/403/404, paused or suspended sending, a message the provider can't
take, such as several `to` addresses at PostHog) and on `NetworkError` with
`failureKind` `"provider"` or absent (timeout, transport, 5xx, after the
provider's own retries). It stops on `EmailServiceError` `"message"`
(validation, suppressed or unreachable recipient, attachments) and on
`NetworkError` `"unknown-outcome"` (a 409 for a key in flight or reused):
the message may have been sent, so any replay reuses the same key. A call
with `replay: true` keeps each message on its chain's first provider, so a
replay never sends the same message through a second provider (campaign
replay rules: `deskohub-workspace-domain` skill,
`references/email-campaigns.md`). The chain adds no retries.

A batch call fails as a whole only when its first provider failed the whole
batch and nothing fell through. Once anything fell through, the failed
subset goes to the next provider per message, and remaining failures come
back per message as `EmailSendFailure`.

## Observing delivery

`EmailDeliveryObserver` (a context reference; `.none` logs, `.all([...])`
fans out) gets `onSent` and `onFallback`. Workspace uses it to record
PostHog-accepted messages for status polling (`posthog_email_deliveries`)
and to capture the anonymous `email provider fallback` event.

## Related

- Campaign delivery, batches, replay, and status: `deskohub-workspace-domain`
  skill, `references/email-campaigns.md`.
- What PostHog receives and the send identity: `deskohub-workspace-account`
  skill, `references/posthog-identity-privacy.md`.
- PostHog sender, DNS, keys, webhook, status cron: `deskohub-workspace-operations`
  skill, `references/posthog-email-delivery.md`.
- Magic-link routing: `deskohub-workspace-account` skill,
  `references/magic-link-delivery-and-e2e.md`. Boardgame Bar addresses:
  `deskohub-boardgame-bar` skill, `references/email.md`.
