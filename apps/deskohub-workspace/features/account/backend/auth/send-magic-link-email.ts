import {
  ConsoleEmailProviderLive,
  EmailConfigTag,
  type EmailMessage,
  type EmailServiceError,
  EmailServiceTag,
  EmailTemplateServiceTag,
  isSyntheticE2EEmailRecipient,
  magicLinkPreviewE2ELogCode,
  magicLinkSyntheticRecipientPattern,
  type NetworkError,
  ResendEmailProviderLive,
} from "@deskohub/email";
import { Data, Effect, Layer } from "effect";
import type { WorkspaceEmailLocale } from "@/emails/_components/workspace-email-layout";
import { workspaceSiteConstants } from "@/shared/utils";

/**
 * Account-owned transport failure. The original provider rejection is
 * deliberately not attached: the error must stay censored even if it escapes
 * delivery handling.
 */
export class MagicLinkDeliveryTransportError extends Data.TaggedError(
  "MagicLinkDeliveryTransportError"
)<{ readonly code: "account.magic-link.transport" }> {
  constructor() {
    super({ code: "account.magic-link.transport" });
  }
}

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
 * The recipient-derived provider route for one magic-link delivery. Auth owns
 * only this selection and the template; the actual sending, retry policy, and
 * provider machinery live in the shared `@deskohub/email`
 * `EmailServiceTag`/provider layers.
 */
export type MagicLinkEmailRoute =
  | "preview-e2e-console"
  | "resend"
  | "unconfigured";

export type MagicLinkEmailRoutingConfig = {
  /** Vercel Preview runtime flag; only Preview may use the Console route. */
  readonly isVercelPreview: boolean;
  /** Send-only Resend credential; its absence fails closed to `unconfigured`. */
  readonly resendApiKey: string | undefined;
};

export const routeMagicLinkEmail = (
  config: MagicLinkEmailRoutingConfig,
  recipient: string
): MagicLinkEmailRoute => {
  if (config.isVercelPreview && isSyntheticE2EEmailRecipient(recipient)) {
    return "preview-e2e-console";
  }
  return config.resendApiKey ? "resend" : "unconfigured";
};

/**
 * Non-secret Resend correlation identity attached to every magic-link
 * message. Through the shared provider machinery these render as the Resend
 * tags `category=account-magic-link` and `surface=workspace`; the exact-SHA
 * E2E runner may use them as one additional equality check. They never carry
 * bearer or request-specific content.
 */
export const magicLinkMessageTags = ["account-magic-link"] as const;
export const magicLinkMessageMetadata = { surface: "workspace" } as const;

export const magicLinkSender = {
  email: "reservations@workspace.deskohub.cz",
  name: workspaceSiteConstants.brand.name,
} as const;

const magicLinkEmailMessage = (
  request: MagicLinkDeliveryRequest,
  rendered: {
    readonly subject: string;
    readonly html: string;
    readonly text: string;
  }
): EmailMessage => ({
  from: magicLinkSender,
  to: { email: request.email },
  subject: rendered.subject,
  html: rendered.html,
  text: rendered.text,
  tags: [...magicLinkMessageTags],
  metadata: { ...magicLinkMessageMetadata },
});

const unconfiguredDelivery = (): Effect.Effect<
  "account.magic-link.delivery-unconfigured",
  never,
  never
> =>
  Effect.logWarning("Magic-link delivery has no configured email provider.", {
    code: "account.magic-link.delivery-unconfigured",
  }).pipe(Effect.as("account.magic-link.delivery-unconfigured" as const));

/**
 * Per-recipient provider composition over the shared service: auth selects
 * the `EmailProviderTag` layer for this recipient and provides
 * `EmailServiceTag` through the standard shared composition. No send or
 * retry logic is duplicated here.
 */
const magicLinkEmailServiceLayer = (
  route: Exclude<MagicLinkEmailRoute, "unconfigured">,
  routing: MagicLinkEmailRoutingConfig
) => {
  const configLayer = Layer.succeed(EmailConfigTag, {
    provider: "resend",
    defaultFrom: magicLinkSender,
    apiKey: routing.resendApiKey,
  });
  const providerLayer =
    route === "preview-e2e-console"
      ? ConsoleEmailProviderLive
      : ResendEmailProviderLive.pipe(Layer.provide(configLayer));
  return EmailServiceTag.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        EmailTemplateServiceTag.Default,
        configLayer,
        providerLayer
      )
    )
  );
};

/**
 * Builds the account magic-link delivery from the typed routing decision.
 * `deliver` returns only the fixed censored delivery codes; the bearer
 * URL, token, rendered body, recipient, and any provider payload never reach
 * logs, errors, or telemetry — except the single intentionally authorized
 * exception: the shared Console provider's one structured
 * `account.magic-link.preview-e2e` raw console line for a Preview runtime
 * delivering to exactly one synthetic recipient. Do not remove that
 * exception: the E2E runner retrieves the preview link from it.
 */
export const makeMagicLinkEmailDelivery = (
  render: MagicLinkEmailRenderer,
  routing: MagicLinkEmailRoutingConfig
) => {
  const deliverRouted = Effect.fn("MagicLinkEmailDelivery.deliver")(function* (
    request: MagicLinkDeliveryRequest,
    _route: Exclude<MagicLinkEmailRoute, "unconfigured">
  ) {
    const rendered = yield* render(request).pipe(
      Effect.tapError(() =>
        Effect.logWarning("Magic-link email delivery failed.", {
          code: "account.magic-link.delivery-failed",
        })
      ),
      Effect.orElseSucceed(() => null)
    );
    if (!rendered) return "account.magic-link.delivery-failed" as const;

    const email = yield* EmailServiceTag;
    const outcome = yield* email
      .send(magicLinkEmailMessage(request, rendered))
      .pipe(
        Effect.as(null),
        Effect.catch((error: EmailServiceError | NetworkError) => {
          // Transport failures retry inside the shared service; once they
          // exhaust, the account boundary keeps only the censored tagged
          // error. Provider rejections keep their fixed censored code.
          if (error._tag === "NetworkError") {
            return Effect.fail(new MagicLinkDeliveryTransportError());
          }
          return Effect.logWarning(
            "Magic-link email was rejected by the provider.",
            { code: "account.magic-link.delivery-rejected" }
          ).pipe(Effect.as("account.magic-link.delivery-rejected" as const));
        })
      );
    if (outcome !== null) return outcome;

    yield* Effect.logInfo("Magic-link email accepted for delivery.", {
      code: "account.magic-link.delivery-accepted",
    });
    return "account.magic-link.delivery-accepted" as const;
  });

  return {
    deliver: (
      request: MagicLinkDeliveryRequest
    ): Effect.Effect<MagicLinkDeliveryCode> => {
      const route = routeMagicLinkEmail(routing, request.email);
      if (route === "unconfigured") return unconfiguredDelivery();
      return deliverRouted(request, route).pipe(
        Effect.provide(magicLinkEmailServiceLayer(route, routing)),
        // The only remaining failures are the censored transport error and a
        // provider layer that could not be constructed from the routing
        // configuration; both collapse to fixed censored delivery codes.
        Effect.catch(
          (error: EmailServiceError | MagicLinkDeliveryTransportError) =>
            error._tag === "MagicLinkDeliveryTransportError"
              ? Effect.logWarning("Magic-link email delivery failed.", {
                  code: "account.magic-link.delivery-failed",
                }).pipe(
                  Effect.as("account.magic-link.delivery-failed" as const)
                )
              : unconfiguredDelivery()
        )
      );
    },
  };
};

export {
  isSyntheticE2EEmailRecipient,
  magicLinkPreviewE2ELogCode,
  magicLinkSyntheticRecipientPattern,
};
