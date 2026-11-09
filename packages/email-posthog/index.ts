/**
 * `@deskohub/email-posthog`: campaign email through PostHog's transactional
 * email API, as one provider of the `@deskohub/email` provider chain, and the
 * per-message status read that reports what happened to it.
 *
 * Both call PostHog over HTTP with Effect's `HttpClient`, not `posthog-node`:
 * the SDK client disables itself without a `phc_` project token, which email
 * does not need, and its `emails.send` takes no abort signal, so a timed-out
 * attempt would keep running and make the retry under the same key answer
 * `idempotency_key_in_flight`.
 *
 * PostHog-side prerequisites: an email channel in PostHog Workflows for the
 * sender, on a domain verified with SPF and DKIM, and a project secret API key
 * (`phs_…`) with `transactional_email:write` (send) and
 * `transactional_email:read` (status; `:write` also reads).
 *
 * ## Send
 *
 * `makePostHogEmailProvider(config)` returns an `EmailProvider` named
 * `"posthog"`. Each message is one `POST {host}/api/projects/@current/messaging/send/email/`
 * in code mode: `to`, `template_key` (the message category, `tags[0]`,
 * limited to `[A-Za-z0-9_-]` and 400 characters, else `"email"`), `subject`,
 * `html`, `text`, `from` (`config.from`, else the message sender), bare
 * `reply_to`/`cc`/`bcc` addresses, `distinct_id` (the message's
 * `recipientIdentity`, else `config.systemIdentity`, never the address), and
 * `capture_engagement: true`. The `Idempotency-Key` header is the message's
 * key; a key PostHog cannot carry becomes `deskohub-sha256:<digest>`, a
 * missing one `deskohub-generated:<uuid>`, made once before any retry.
 * Custom headers (List-Unsubscribe), tags, and metadata are not sent; dropped
 * headers are logged once per send or batch. A success is `status: "queued"`:
 * PostHog queued the email, the status read reports delivery.
 *
 * Each attempt is bounded by `config.timeout`, else 5 seconds in production
 * and 30 seconds elsewhere (`VERCEL_ENV`). A send retries twice under the same
 * key, with a jittered backoff from 1 second, and waits out a `Retry-After` of
 * up to 30 seconds; a longer one ends the retries at once.
 *
 * | PostHog answer | Retried | Surfaced failure |
 * | --- | --- | --- |
 * | 429 `throttled`, 5xx, 503 `delivery_unavailable` | yes | `EmailServiceError` provider |
 * | 409 `idempotency_key_in_flight` | yes | `NetworkError` unknown-outcome |
 * | transport failure, timeout | yes | `NetworkError` provider |
 * | 429 `quota_limited`; 401, 403, 404; 400 `transactional_email_paused`, `sender_unavailable`; 422 `sending_paused`, `sending_suspended` | no | `EmailServiceError` provider |
 * | any other 4xx (`validation_error`, `invalid_recipient`, `invalid_idempotency_key`, `template_*`, `marketing_template`, `recipient_suppressed`, `recipient_unreachable`, `idempotency_key_reused`) | no | `EmailServiceError` message |
 * | 2xx whose body fails, times out, or has no readable message id | no | `NetworkError` unknown-outcome |
 *
 * Before any request: attachments fail `EmailServiceError` message
 * (`attachments_unsupported`); more than one `to`, or more than ten `cc` or
 * `bcc`, fail `EmailServiceError` provider (`recipients_unsupported`), so the
 * next provider sends it. "provider" lets the chain try the next provider;
 * "message" and "unknown-outcome" stop it. Every failure carries PostHog's
 * error `code` (or this package's), never its `detail` text.
 *
 * `sendBatch` sends each message on its own, at most four at a time, and
 * answers one result per message in message order; it never fails as a
 * whole. A message without its own key is sent under `<batch key>:<index>`.
 * After a send fails provider-level, the batch starts no further sends and
 * fails the rest provider-level (`not_attempted`); sends in flight finish.
 * The batch ends 15 seconds after it starts in every deployment: unstarted
 * messages fail provider-level (`batch_deadline`), sends in flight are
 * abandoned as `NetworkError` unknown-outcome (`batch_deadline`), and no
 * `Retry-After` past the deadline is waited out.
 *
 * ## Status
 *
 * `fetchPostHogEmailStatus(config, messageId)` reads
 * `GET {host}/api/projects/@current/messaging/emails/{messageId}/` once, with
 * no retries. It answers `Found` with the report, or `NotFoundYet` for a 404
 * (PostHog may not know a message for a few seconds after its send), and
 * fails with `PostHogEmailStatusError` (`rate-limited` with
 * `retryAfterSeconds`, `unauthorized`, `rejected`, `unavailable`,
 * `invalid-response`).
 *
 * @module
 */
export type { PostHogEmailConnection } from "./backend/posthog-email-connection";
export {
  makePostHogEmailProvider,
  type PostHogEmailProviderConfig,
} from "./backend/posthog-email-provider";
export {
  fetchPostHogEmailStatus,
  type PostHogEmailStatus,
  type PostHogEmailStatusClientConfig,
  PostHogEmailStatusError,
  type PostHogEmailStatusLookup,
  type PostHogEmailStatusReport,
} from "./backend/posthog-email-status";
