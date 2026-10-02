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

export type MagicLinkEmailRoute = "preview-e2e-console" | "configured-default";

export type MagicLinkEmailRoutingConfig = {
  readonly isVercelPreview: boolean;
};

/**
 * Only synthetic recipients in Vercel Preview use the authorized Console
 * route.
 */
export const routeMagicLinkEmail = (
  config: MagicLinkEmailRoutingConfig,
  recipient: string
): MagicLinkEmailRoute =>
  config.isVercelPreview && isSyntheticE2EEmailRecipient(recipient)
    ? "preview-e2e-console"
    : "configured-default";

/**
 * Bearer content reaches logs only through the authorized synthetic Preview
 * route.
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
          // Discard transport details after shared retries are exhausted.
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

    // The synthetic Preview route is the only bearer-log exception.
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
      // Keep provider and configuration failures within the fixed code
      // contract.
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
 * Emits the sole approved bearer-link line for synthetic protected Preview
 * runs.
 */
const emitPreviewE2EConsoleDelivery = (recipient: string, text: string) => {
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
