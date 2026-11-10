import "server-only";

import type { PostHogDistinctId } from "@deskohub/analytics-posthog/identifiers";
import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, inArray, isNull } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { customerAccounts } from "@/db/schema/customer-accounts";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { getPostHogAccountDistinctId } from "@/features/account/posthog-account-distinct-id";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";

/** Consent reads for one batch run this many at a time. */
const consentReadConcurrency = 10;

const noIdentities = () => new Map<DotyposCustomerId, PostHogDistinctId>();

type LinkedAccount = {
  readonly accountId: CustomerAccountId;
  readonly dotyposCustomerId: DotyposCustomerId;
};

export interface ICampaignRecipientAnalyticsIdentity {
  /**
   * The PostHog person each recipient's campaign email may name, so its
   * engagement joins the account's events: the account linked to the
   * Dotypos customer, while its current analytics consent decision is a
   * grant. Recipients without one are absent: no account, no grant, or a
   * consent that couldn't be read. Never fails, since the email goes out
   * either way.
   */
  readonly forRecipients: (
    customerIds: readonly DotyposCustomerId[]
  ) => Effect.Effect<ReadonlyMap<DotyposCustomerId, PostHogDistinctId>>;
}

/**
 * Whom a campaign email is about in PostHog, read at send time from the
 * account link and the analytics consent ledger: the same rule that links a
 * reservation's lifecycle events to its author.
 */
export class CampaignRecipientAnalyticsIdentity extends Context.Service<
  CampaignRecipientAnalyticsIdentity,
  ICampaignRecipientAnalyticsIdentity
>()("@deskohub-workspace/email-campaigns/CampaignRecipientAnalyticsIdentity") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const ledger = yield* AnalyticsConsentLedger;

      /** The live accounts linked to the customers. */
      const linkedAccounts = (customerIds: readonly DotyposCustomerId[]) =>
        db
          .select({
            accountId: customerAccounts.id,
            dotyposCustomerId: customerAccounts.dotyposCustomerId,
          })
          .from(customerAccounts)
          .where(
            and(
              inArray(customerAccounts.dotyposCustomerId, [...customerIds]),
              isNull(customerAccounts.deletedAt)
            )
          )
          .pipe(
            Effect.map((rows) =>
              rows.flatMap(
                ({ accountId, dotyposCustomerId }): LinkedAccount[] =>
                  dotyposCustomerId === null
                    ? []
                    : [{ accountId, dotyposCustomerId }]
              )
            )
          );

      const grants = (accountId: CustomerAccountId) =>
        ledger.currentDecision(accountId).pipe(
          Effect.map(Option.exists(({ decision }) => decision === "grant")),
          Effect.catchTag("AnalyticsConsentUnavailable", (cause) =>
            Effect.logWarning(
              "Campaign recipient analytics consent unavailable",
              { errorType: cause._tag }
            ).pipe(Effect.as(false))
          )
        );

      const consentedAccounts = (accounts: readonly LinkedAccount[]) =>
        Effect.filter(accounts, ({ accountId }) => grants(accountId), {
          concurrency: consentReadConcurrency,
        });

      const forRecipients = Effect.fn(
        "CampaignRecipientAnalyticsIdentity.forRecipients"
      )((customerIds: readonly DotyposCustomerId[]) =>
        Effect.succeed(customerIds).pipe(
          Effect.flatMap(linkedAccounts),
          Effect.flatMap(consentedAccounts),
          Effect.map(
            (consented) =>
              new Map(
                consented.map(({ accountId, dotyposCustomerId }) => [
                  dotyposCustomerId,
                  getPostHogAccountDistinctId(accountId),
                ])
              )
          ),
          Effect.catchTag("EffectDrizzleQueryError", (cause) =>
            Effect.logWarning("Campaign recipient accounts could not be read", {
              errorType: cause._tag,
            }).pipe(Effect.as(noIdentities()))
          ),
          Effect.when(Effect.succeed(customerIds.length > 0)),
          Effect.map(Option.getOrElse(noIdentities))
        )
      );

      return { forRecipients } satisfies ICampaignRecipientAnalyticsIdentity;
    })
  );
}
