import "server-only";

import { Data, Effect, Redacted } from "effect";
import { Webhook } from "standardwebhooks";

/** A webhook request whose signature verified, with the body it signed. */
interface VerifiedStandardWebhook {
  /** The sender's message id, stable across its delivery attempts. */
  readonly id: string;
  readonly body: string;
}

/**
 * A request that does not prove it comes from the holder of the secret, now:
 * it lacks the signature headers, or its signature or timestamp fails.
 */
export class StandardWebhookRejection extends Data.TaggedError(
  "StandardWebhookRejection"
)<{
  readonly reason: "headers-missing" | "verification-failed";
  readonly cause?: unknown;
}> {}

/**
 * The configured signing secret is not a base64 key, optionally prefixed with
 * `whsec_`, so no request can verify until it is corrected.
 */
class StandardWebhookSecretInvalid extends Data.TaggedError(
  "StandardWebhookSecretInvalid"
)<{
  readonly cause: unknown;
}> {}

/**
 * Verifies a request signed under the Standard Webhooks specification
 * (https://www.standardwebhooks.com): the `webhook-signature` header must
 * carry a `v1` HMAC-SHA256 of `{id}.{timestamp}.{body}` under the signing
 * secret, and `webhook-timestamp` must be within five minutes of now.
 */
export const verifyStandardWebhookRequest = Effect.fn(
  "verifyStandardWebhookRequest"
)(function* (request: Request, signingSecret: Redacted.Redacted<string>) {
  const verifier = yield* Effect.try({
    try: () => new Webhook(Redacted.value(signingSecret)),
    catch: (cause) => new StandardWebhookSecretInvalid({ cause }),
  });

  const id = request.headers.get("webhook-id");
  const timestamp = request.headers.get("webhook-timestamp");
  const signature = request.headers.get("webhook-signature");
  if (!id || !timestamp || !signature) {
    return yield* new StandardWebhookRejection({ reason: "headers-missing" });
  }

  const body = yield* Effect.promise(() => request.text());

  yield* Effect.try({
    try: () =>
      verifier.verify(
        body,
        {
          "webhook-id": id,
          "webhook-timestamp": timestamp,
          "webhook-signature": signature,
        },
        { jsonParse: false }
      ),
    catch: (cause) =>
      new StandardWebhookRejection({ reason: "verification-failed", cause }),
  });

  return { id, body } satisfies VerifiedStandardWebhook;
});
