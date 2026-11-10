import {
  EmailConfigTag,
  EmailDeliveryObserver,
  type EmailProvider,
  type EmailProviderChains,
  EmailProviders,
  EmailServiceTag,
  makeEmailConfigLayer,
} from "@deskohub/email";
import { makePostHogEmailProvider } from "@deskohub/email-posthog";
import {
  deploymentResendRequestTimeouts,
  makeResendEmailProvider,
} from "@deskohub/email-resend";
import { Config, Effect, Layer, Option, Redacted } from "effect";
import { makeEmailFallbackAnalyticsObserver } from "@/shared/backend/analytics/email-fallback-analytics-observer";
import { ServerAnalytics } from "@/shared/backend/analytics/server-analytics.service";
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

/**
 * The PostHog distinct id of campaign mail to a recipient without a consented
 * customer account, so PostHog never keys a person by the recipient's
 * address. Engagement events of all such recipients share this one person.
 */
export const workspaceEmailSystemIdentity = "workspace-email-system";

/**
 * The PostHog email provider, when `POSTHOG_EMAIL_SECRET_KEY` is set
 * (production). It sends through the `POSTHOG_API_HOST` project. Campaign
 * messages carry the campaign sender, so PostHog sends from the same address
 * as Resend.
 */
const configuredPostHogEmailProvider = Effect.gen(function* () {
  const secretKey = (yield* Config.option(
    Config.string("POSTHOG_EMAIL_SECRET_KEY")
  )).pipe(
    Option.map((key) => key.trim()),
    Option.filter((key) => key !== "")
  );
  const host = yield* Config.option(Config.string("POSTHOG_API_HOST"));
  return Option.isSome(secretKey) && Option.isSome(host)
    ? makePostHogEmailProvider({
        secretKey: Redacted.make(secretKey.value),
        host: host.value,
        systemIdentity: workspaceEmailSystemIdentity,
      })
    : undefined;
});

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
    const posthog = yield* configuredPostHogEmailProvider;
    return workspaceEmailProviders({ resend, ...(posthog && { posthog }) });
  })
);

/**
 * Every delivery observer of the Workspace, combined: the fallback analytics
 * observer reports each message one provider failed and the next took over.
 */
const WorkspaceEmailDeliveryObserverLayer = Layer.effect(
  EmailDeliveryObserver,
  Effect.map(makeEmailFallbackAnalyticsObserver, (fallbackAnalytics) =>
    EmailDeliveryObserver.all([fallbackAnalytics])
  )
).pipe(Layer.provide(ServerAnalytics.Live));

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
