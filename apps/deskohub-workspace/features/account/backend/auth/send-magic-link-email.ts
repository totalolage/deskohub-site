import { Effect } from "effect";
import type { WorkspaceEmailLocale } from "@/emails/_components/workspace-email-layout";

/**
 * Fixed, censored result codes for magic-link delivery. These are the only
 * delivery facts that may reach logs or telemetry: never the recipient, the
 * bearer URL, the token, the rendered body, or any provider payload.
 */
export type MagicLinkDeliveryCode =
  | "account.magic-link.delivery-accepted"
  | "account.magic-link.delivery-rejected"
  | "account.magic-link.delivery-failed"
  | "account.magic-link.delivery-unconfigured";

export type MagicLinkDeliveryRequest = {
  readonly email: string;
  readonly url: string;
  readonly locale: WorkspaceEmailLocale;
};

export type MagicLinkEmailSender = (message: {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}) => Promise<{ readonly id: string | null; readonly error: unknown }>;

export type MagicLinkEmailRenderer = (
  request: MagicLinkDeliveryRequest
) => Effect.Effect<
  {
    readonly subject: string;
    readonly html: string;
    readonly text: string;
  },
  unknown
>;

/**
 * Fixed, non-secret, non-PII Resend tags attached to every magic-link
 * message. The exact-SHA E2E runner uses them as one additional equality
 * check when matching the synthetic message; they never carry bearer or
 * request-specific content.
 */
export const magicLinkCorrelationTags = [
  { name: "category", value: "account-magic-link" },
  { name: "surface", value: "workspace" },
] as const;

export const makeMagicLinkEmailDelivery = (
  sender: MagicLinkEmailSender | null,
  render: MagicLinkEmailRenderer
) => {
  const deliver = Effect.fn("MagicLinkEmailDelivery.deliver")(function* (
    request: MagicLinkDeliveryRequest
  ) {
    if (!sender) {
      yield* Effect.logWarning(
        "Magic-link delivery has no configured email provider.",
        { code: "account.magic-link.delivery-unconfigured" }
      );
      return "account.magic-link.delivery-unconfigured" as const;
    }

    return yield* Effect.gen(function* () {
      const rendered = yield* render(request);
      const sent = yield* Effect.tryPromise({
        try: () =>
          sender({
            to: request.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
          }),
        catch: () => new Error("Magic-link email transport failed."),
      });

      if (sent.error) {
        yield* Effect.logWarning(
          "Magic-link email was rejected by the provider.",
          { code: "account.magic-link.delivery-rejected" }
        );
        return "account.magic-link.delivery-rejected" as const;
      }

      yield* Effect.logInfo("Magic-link email accepted for delivery.", {
        code: "account.magic-link.delivery-accepted",
      });
      return "account.magic-link.delivery-accepted" as const;
    }).pipe(
      Effect.catch(() =>
        Effect.logWarning("Magic-link email delivery failed.", {
          code: "account.magic-link.delivery-failed",
        }).pipe(Effect.as("account.magic-link.delivery-failed" as const))
      )
    );
  });

  return { deliver };
};
