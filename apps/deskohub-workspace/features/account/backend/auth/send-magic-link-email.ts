import {
  ConfiguredEmailProviderLayer,
  ConsoleEmailProviderLive,
  type EmailConfigTag,
  type EmailMessage,
  type EmailProviderTag,
  type EmailServiceError,
  EmailServiceTag,
  EmailTemplateServiceTag,
  type NetworkError,
} from "@deskohub/email";
import { type Config, Data, Effect, Layer } from "effect";
import type { WorkspaceEmailLocale } from "@/emails/_components/workspace-email-layout";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  accountMagicLinkEmailCategoryTag,
  accountMagicLinkEmailSurface,
  isSyntheticE2EEmailRecipient,
  magicLinkPreviewE2ELogCode,
} from "./magic-link-policy";

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
export type MagicLinkEmailRoute = "preview-e2e-console" | "configured-default";

export type MagicLinkEmailRoutingConfig = {
  /**
   * Vercel Preview runtime flag. Only a Preview runtime may force the shared
   * Console provider for synthetic recipients; every other recipient context
   * uses the `EmailConfigLayer` configured default provider.
   */
  readonly isVercelPreview: boolean;
};

/**
 * Synthetic E2E recipients in a Vercel Preview runtime force the shared
 * Console provider (the single authorized `account.magic-link.preview-e2e`
 * line). Every other recipient context — including non-synthetic Preview,
 * development, and production — uses the `EmailConfigLayer` configured default
 * provider.
 */
export const routeMagicLinkEmail = (
  config: MagicLinkEmailRoutingConfig,
  recipient: string
): MagicLinkEmailRoute =>
  config.isVercelPreview && isSyntheticE2EEmailRecipient(recipient)
    ? "preview-e2e-console"
    : "configured-default";

/**
 * Builds the account magic-link delivery from the typed routing decision.
 * `deliver` returns only the fixed censored delivery codes; the bearer
 * URL, token, rendered body, recipient, and any provider payload never reach
 * logs, errors, or telemetry — except the single intentionally authorized
 * exception: one `account.magic-link.preview-e2e` raw console line for a
 * Preview runtime delivering to exactly one synthetic recipient. Do not remove
 * that exception: the E2E runner retrieves the preview link from it.
 */
export const makeMagicLinkEmailDelivery = (
  render: MagicLinkEmailRenderer,
  routing: MagicLinkEmailRoutingConfig
): {
  readonly deliver: (
    request: MagicLinkDeliveryRequest
  ) => Effect.Effect<MagicLinkDeliveryCode>;
} => {
  const deliverRouted = Effect.fn("MagicLinkEmailDelivery.deliver")(function* (
    request: MagicLinkDeliveryRequest,
    route: MagicLinkEmailRoute
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

    // The one explicitly authorized bearer-material line, gated to the
    // synthetic Preview route and emitted only after a successful shared
    // Console send.
    if (route === "preview-e2e-console") {
      emitPreviewE2EConsoleDelivery(request.email, rendered.text);
    }

    yield* Effect.logInfo("Magic-link email accepted for delivery.", {
      code: "account.magic-link.delivery-accepted",
    });
    return "account.magic-link.delivery-accepted" as const;
  });

  const deliver = Effect.fn("account.magic-link.deliver")(function* (
    request: MagicLinkDeliveryRequest
  ) {
    const route = routeMagicLinkEmail(routing, request.email);
    return yield* deliverRouted(request, route).pipe(
      Effect.provide(magicLinkEmailServiceLayer(route)),
      // The only remaining failures are the censored transport error and a
      // provider layer that could not be constructed from the configured
      // default provider (the production Console guard and the fail-closed
      // missing delivering credential); both collapse to fixed censored
      // delivery codes.
      Effect.catch(
        (
          error:
            | Config.ConfigError
            | EmailServiceError
            | MagicLinkDeliveryTransportError
        ) =>
          error._tag === "MagicLinkDeliveryTransportError"
            ? Effect.logWarning("Magic-link email delivery failed.", {
                code: "account.magic-link.delivery-failed",
              }).pipe(Effect.as("account.magic-link.delivery-failed" as const))
            : unconfiguredDelivery()
      )
    );
  });

  return { deliver };
};

const magicLinkSender = {
  email: "reservations@workspace.deskohub.cz",
  name: workspaceSiteConstants.brand.name,
} as const;

/**
 * Every magic-link message carries bearer material (the sign-in URL), so it is
 * marked sensitive and every provider suppresses recipient, subject, body, and
 * any development banner output for it.
 */
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
  tags: [accountMagicLinkEmailCategoryTag],
  metadata: { surface: accountMagicLinkEmailSurface },
  sensitiveContent: true,
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
 * Per-recipient provider composition over the shared service. Synthetic
 * Preview recipients force the shared Console provider; every other recipient
 * context uses the shared `ConfiguredEmailProviderLayer` resolved from the
 * `EmailConfigLayer` configured default. No send or retry logic is duplicated
 * here.
 */
const magicLinkEmailServiceLayer = (
  route: MagicLinkEmailRoute
): Layer.Layer<EmailServiceTag, Config.ConfigError | EmailServiceError> => {
  const providerLayer: Layer.Layer<
    EmailProviderTag,
    EmailServiceError,
    EmailConfigTag
  > =
    route === "preview-e2e-console"
      ? ConsoleEmailProviderLive
      : ConfiguredEmailProviderLayer;
  return EmailServiceTag.Default.pipe(
    Layer.provide(EmailTemplateServiceTag.Default),
    Layer.provide(providerLayer),
    Layer.provide(EmailConfigLayer)
  );
};

/**
 * The one explicitly authorized bearer-material log line: a protected Vercel
 * Preview delivering an auth magic link to an exact synthetic E2E recipient
 * prints the rendered TEXT body (which carries the magic link) as a single
 * structured raw-`console.log` line, bypassing Effect/OTel censorship so the
 * E2E runner can read it from Vercel runtime logs. Called only after a
 * successful shared Console send, for exactly one synthetic recipient.
 */
const emitPreviewE2EConsoleDelivery = (recipient: string, text: string) => {
  // Raw console output is the point: the E2E runner reads this line from
  // Vercel runtime logs, outside Effect/OTel logging censorship.
  // biome-ignore lint/suspicious/noConsole: Explicitly authorized preview E2E link delivery channel
  console.log(
    JSON.stringify({
      code: magicLinkPreviewE2ELogCode,
      recipient,
      message: "Synthetic preview magic-link text body for E2E retrieval.",
      text,
    })
  );
};
