import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import type { EmailServiceError } from "@deskohub/email/backend/service";
import { type Config, Data, Effect, Predicate } from "effect";
import type { WorkspaceEmailLocale } from "@/emails/_components/workspace-email-layout";
import {
  WorkspaceEmailLayer,
  workspaceDefaultFromAddress,
} from "@/shared/backend/config/email.config";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  accountMagicLinkEmailCategoryTag,
  accountMagicLinkEmailSurface,
  isSyntheticE2EEmailRecipient,
  magicLinkDevelopmentLogCode,
  magicLinkPreviewE2ELogCode,
} from "./magic-link-policy";

/**
 * Account-owned transport failure. The original provider rejection is
 * deliberately not attached: the error must stay censored even if it escapes
 * delivery handling.
 */
class MagicLinkDeliveryTransportError extends Data.TaggedError(
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
  | "account.magic-link.delivery-failed";

export type MagicLinkDeliveryRequest = {
  readonly email: string;
  readonly url: string;
  /** The sign-in code sent with the link, while sign-in codes are on. */
  readonly code?: string;
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
  EmailServiceError
>;

export type MagicLinkDeliveryEnvironment = {
  readonly isVercelPreview: boolean;
  /** `next dev` on a developer machine; never a Vercel deployment or test. */
  readonly isLocalDevelopment: boolean;
};

/**
 * Both signals must agree: `next dev` sets `NODE_ENV=development`, while
 * Vercel builds run with `production` and `bun test` with `test`.
 */
export const magicLinkDeliveryEnvironment = (runtime: {
  readonly VERCEL_ENV: "production" | "preview" | "development";
  readonly NODE_ENV: string | undefined;
}): MagicLinkDeliveryEnvironment => ({
  isVercelPreview: runtime.VERCEL_ENV === "preview",
  isLocalDevelopment:
    runtime.VERCEL_ENV === "development" && runtime.NODE_ENV === "development",
});

/** The only magic-link lines allowed to carry bearer content. */
type AuthorizedMagicLinkLine =
  | {
      readonly code: typeof magicLinkPreviewE2ELogCode;
      readonly recipient: string;
      readonly message: string;
      readonly text: string;
    }
  | {
      readonly code: typeof magicLinkDevelopmentLogCode;
      readonly recipient: string;
      readonly message: string;
      readonly url: string;
      readonly signInCode?: string;
    };

/**
 * The shared email service picks the provider by recipient. Bearer content
 * reaches logs only after Console accepted the message, and then only for
 * synthetic E2E recipients in Vercel Preview or any recipient in local
 * development, where nothing else delivers the link.
 */
const authorizedMagicLinkLine = (
  environment: MagicLinkDeliveryEnvironment,
  request: MagicLinkDeliveryRequest,
  text: string,
  provider: string
): AuthorizedMagicLinkLine | undefined => {
  if (provider !== "console") return undefined;
  if (
    environment.isVercelPreview &&
    isSyntheticE2EEmailRecipient(request.email)
  ) {
    return {
      code: magicLinkPreviewE2ELogCode,
      recipient: request.email,
      message: "Synthetic preview magic-link text body for E2E retrieval.",
      text,
    };
  }
  if (environment.isLocalDevelopment) {
    return {
      code: magicLinkDevelopmentLogCode,
      recipient: request.email,
      message: "Development magic link; open the url to sign in.",
      url: request.url,
      signInCode: request.code,
    };
  }
  return undefined;
};

export const makeMagicLinkEmailDelivery = (
  render: MagicLinkEmailRenderer,
  environment: MagicLinkDeliveryEnvironment
): {
  readonly deliver: (
    request: MagicLinkDeliveryRequest
  ) => Effect.Effect<MagicLinkDeliveryCode>;
} => {
  const deliverRendered = Effect.fn("MagicLinkEmailDelivery.deliver")(
    function* (request: MagicLinkDeliveryRequest) {
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
      const sent = yield* email
        .send(magicLinkEmailMessage(request, rendered))
        .pipe(
          // Discard transport details after shared retries are exhausted.
          Effect.catchTag("NetworkError", () =>
            Effect.fail(new MagicLinkDeliveryTransportError())
          ),
          Effect.catchTag("EmailServiceError", () =>
            Effect.logWarning(
              "Magic-link email was rejected by the provider.",
              {
                code: "account.magic-link.delivery-rejected",
              }
            ).pipe(Effect.as("account.magic-link.delivery-rejected" as const))
          )
        );
      if (Predicate.isString(sent)) return sent;

      const line = authorizedMagicLinkLine(
        environment,
        request,
        rendered.text,
        sent.provider
      );
      if (line) emitAuthorizedMagicLinkLine(line);

      yield* Effect.logInfo("Magic-link email accepted for delivery.", {
        code: "account.magic-link.delivery-accepted",
      });
      return "account.magic-link.delivery-accepted" as const;
    }
  );

  const deliver = Effect.fn("account.magic-link.deliver")(function* (
    request: MagicLinkDeliveryRequest
  ) {
    return yield* deliverRendered(request).pipe(
      Effect.provide(WorkspaceEmailLayer),
      // Keep transport and configuration failures within the fixed code
      // contract.
      Effect.catch(
        (_error: Config.ConfigError | MagicLinkDeliveryTransportError) =>
          Effect.logWarning("Magic-link email delivery failed.", {
            code: "account.magic-link.delivery-failed",
          }).pipe(Effect.as("account.magic-link.delivery-failed" as const))
      )
    );
  });

  return { deliver };
};

const magicLinkSender = {
  email: workspaceDefaultFromAddress,
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

/**
 * Emits the approved bearer-link lines for synthetic protected Preview runs
 * and local development.
 */
const emitAuthorizedMagicLinkLine = (line: AuthorizedMagicLinkLine) => {
  // biome-ignore lint/suspicious/noConsole: Explicitly authorized Preview E2E and local development link delivery channel
  console.log(JSON.stringify(line));
};
