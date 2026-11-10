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
  makePostHogEmailProvider,
  type PostHogEmailConnection,
} from "@deskohub/email-posthog";
import {
  deploymentResendRequestTimeouts,
  makeResendEmailProvider,
} from "@deskohub/email-resend";
import { Config, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { campaignEmailKind } from "@/features/email-campaigns/campaign-email-kind";
import { makeEmailFallbackAnalyticsObserver } from "@/shared/backend/analytics/email-fallback-analytics-observer";
import { ServerAnalytics } from "@/shared/backend/analytics/server-analytics.service";
import { makePostHogDeliveryTrackingObserver } from "@/shared/backend/email/posthog-delivery-tracking-observer";
import { workspaceSiteConstants } from "@/shared/utils";
import { configuredPostHogEmailConnection } from "./posthog-email.config";

export const workspaceDefaultFromAddress = "reservations@workspace.deskohub.cz";

const EmailConfigLayer = makeEmailConfigLayer(
  Config.succeed({
    email: workspaceDefaultFromAddress,
    name: workspaceSiteConstants.brand.name,
  })
);

/** The kinds of email the Workspace sends as marketing mail: campaign deliveries. */
const workspaceMarketingEmailKinds = [campaignEmailKind];

/**
 * Categories the Workspace sends as marketing mail. Every other message is
 * transactional.
 */
export const workspaceMarketingCategories: ReadonlySet<string> = new Set(
  workspaceMarketingEmailKinds.map(({ category }) => category)
);

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
 * The PostHog email provider of the configured connection. Campaign messages
 * carry the campaign sender, so PostHog sends from the same address as
 * Resend.
 */
const makeWorkspacePostHogEmailProvider = (
  connection: PostHogEmailConnection
) =>
  makePostHogEmailProvider({
    ...connection,
    systemIdentity: workspaceEmailSystemIdentity,
  });

const makeWorkspaceEmailProvidersLayer = (
  postHog: Option.Option<PostHogEmailConnection>
) =>
  Layer.effect(
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
      return workspaceEmailProviders({
        resend,
        ...Option.match(postHog, {
          onNone: () => ({}),
          onSome: (connection) => ({
            posthog: makeWorkspacePostHogEmailProvider(connection),
          }),
        }),
      });
    })
  );

/**
 * Every delivery observer of the Workspace, combined: the fallback analytics
 * observer reports each message one provider failed and the next took over,
 * and with PostHog configured, the tracking observer records each message
 * PostHog accepted so its status gets polled. `database` is built only then.
 */
const makeWorkspaceEmailDeliveryObserverLayer = (
  postHog: Option.Option<PostHogEmailConnection>,
  database: Layer.Layer<WorkspaceDatabase>
) =>
  Option.isNone(postHog)
    ? Layer.effect(
        EmailDeliveryObserver,
        Effect.map(makeEmailFallbackAnalyticsObserver, (fallbackAnalytics) =>
          EmailDeliveryObserver.all([fallbackAnalytics])
        )
      ).pipe(Layer.provide(ServerAnalytics.Live))
    : Layer.effect(
        EmailDeliveryObserver,
        Effect.all([
          makeEmailFallbackAnalyticsObserver,
          makePostHogDeliveryTrackingObserver(workspaceMarketingEmailKinds),
        ]).pipe(Effect.map(EmailDeliveryObserver.all))
      ).pipe(Layer.provide([ServerAnalytics.Live, database]));

/**
 * Routes each message by recipient: mail only for `EMAIL_TEST_DOMAIN`
 * recipients goes to Console, everything else through its stream's chain.
 * Campaign mail goes through PostHog first when `POSTHOG_EMAIL_SECRET_KEY` is
 * set (production once PostHog email is set up); its deliveries are then
 * tracked in `database`, which must be the one a caller's transactions use.
 */
export const makeWorkspaceEmailLayer = (
  database: Layer.Layer<WorkspaceDatabase>
) =>
  EmailServiceTag.RecipientRouted.pipe(
    Layer.provide(
      Layer.unwrap(
        Effect.map(configuredPostHogEmailConnection, (postHog) =>
          Layer.mergeAll(
            makeWorkspaceEmailProvidersLayer(postHog),
            makeWorkspaceEmailDeliveryObserverLayer(postHog, database)
          )
        )
      )
    ),
    Layer.provideMerge(EmailConfigLayer)
  );

/** The Workspace email service over the deployment's database. */
export const WorkspaceEmailLayer = makeWorkspaceEmailLayer(
  WorkspaceDatabase.Default
);
