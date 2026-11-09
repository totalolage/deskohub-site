import {
  EmailConfigTag,
  EmailDeliveryObserver,
  type EmailProvider,
  type EmailProviderChains,
  EmailProviders,
  EmailServiceTag,
  makeEmailConfigLayer,
} from "@deskohub/email";
import {
  deploymentResendRequestTimeouts,
  makeResendEmailProvider,
} from "@deskohub/email-resend";
import { Config, Effect, Layer } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";

export const workspaceDefaultFromAddress = "reservations@workspace.deskohub.cz";

const EmailConfigLayer = makeEmailConfigLayer(
  Config.succeed({
    email: workspaceDefaultFromAddress,
    name: workspaceSiteConstants.brand.name,
  })
);

/**
 * Categories the Workspace sends as marketing mail: campaign deliveries
 * (`campaignEmailKind.category`). Every other message is transactional.
 */
export const workspaceMarketingCategories: ReadonlySet<string> = new Set([
  "email-campaign",
]);

/**
 * The Workspace's provider chains. Transactional mail goes only through
 * Resend. Marketing mail tries `posthog` first when it is given, then
 * Resend. Without Resend every chain is empty, so every message goes to
 * Console and an environment without credentials never sends real mail.
 */
export const workspaceEmailProviders = (providers: {
  readonly resend: EmailProvider | undefined;
  readonly posthog?: EmailProvider;
}): EmailProviderChains => {
  if (!providers.resend) {
    return {
      transactional: [],
      marketing: [],
      marketingCategories: workspaceMarketingCategories,
    };
  }
  return {
    transactional: [providers.resend],
    marketing: providers.posthog
      ? [providers.posthog, providers.resend]
      : [providers.resend],
    marketingCategories: workspaceMarketingCategories,
  };
};

const WorkspaceEmailProvidersLayer = Layer.effect(
  EmailProviders,
  Effect.gen(function* () {
    const config = yield* EmailConfigTag;
    const apiKey = config.apiKey?.trim();
    const resend = apiKey
      ? makeResendEmailProvider({
          apiKey,
          timeouts: yield* deploymentResendRequestTimeouts,
        })
      : undefined;
    // PostHog integration: build the PostHog provider here and pass it as
    // `posthog`.
    return workspaceEmailProviders({ resend });
  })
);

/**
 * Every delivery observer of the Workspace, combined. PostHog integration
 * adds the delivery tracking and fallback analytics observers to the list.
 */
const WorkspaceEmailDeliveryObserverLayer = Layer.succeed(
  EmailDeliveryObserver,
  EmailDeliveryObserver.all([EmailDeliveryObserver.none])
);

/**
 * Routes each message by recipient: mail only for `EMAIL_TEST_DOMAIN`
 * recipients goes to Console, everything else through its stream's chain.
 */
export const WorkspaceEmailLayer = EmailServiceTag.RecipientRouted.pipe(
  Layer.provide(
    Layer.mergeAll(
      WorkspaceEmailProvidersLayer,
      WorkspaceEmailDeliveryObserverLayer
    )
  ),
  Layer.provideMerge(EmailConfigLayer)
);
