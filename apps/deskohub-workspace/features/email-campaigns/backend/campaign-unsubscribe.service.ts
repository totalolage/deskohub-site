import "server-only";

import { and, eq } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  emailCampaignAutomationVersions,
  emailCampaignRecipients,
  emailCampaignSends,
  emailCampaigns,
} from "@/db/schema";
import { appendVercelPreviewProtectionBypass } from "@/features/checkout/backend/checkout/vercel-preview-protection-bypass";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import {
  type MarketingManagementError,
  MarketingManagementService,
} from "@/features/legal/backend/marketing-management.service";
import { getRuntimeMarketingPreferencesAccessUrl } from "@/features/legal/marketing-preferences-access-url";
import {
  getWorkspaceRuntimeCallbackOrigin,
  type WorkspaceUrlConfigError,
} from "@/shared/backend/config/workspace-url.config";
import { currentInstant } from "@/shared/utils/temporal";
import {
  type CampaignUnsubscribeRecipient,
  openCampaignUnsubscribeToken,
  signCampaignUnsubscribeToken,
} from "../campaign-unsubscribe-token";
import { CampaignUnsubscribeTokenInvalid } from "../errors";
import { sendAutomationVersion, sendPurpose } from "./campaign-send-selection";
import { loadCampaignSigningKeys } from "./campaign-signing-keys";

/** Path of the one-click unsubscribe endpoint (`List-Unsubscribe`). */
const campaignUnsubscribePath = "/api/email-campaigns/unsubscribe";

type CampaignUnsubscribeOutcome = "withdrawn" | "unchanged";

export interface ICampaignUnsubscribeService {
  /**
   * The link a marketing email carries for one frozen recipient, in its
   * `List-Unsubscribe` header and its footer. A POST to it unsubscribes
   * (RFC 8058); opening it shows the marketing preferences.
   */
  readonly unsubscribeUrl: (
    recipient: CampaignUnsubscribeRecipient
  ) => Effect.Effect<string, WorkspaceUrlConfigError>;
  /**
   * Withdraws the marketing consent of the token's recipient. A repeated
   * request finds the consent withdrawn and changes nothing.
   */
  readonly unsubscribe: (
    token: string
  ) => Effect.Effect<
    CampaignUnsubscribeOutcome,
    CampaignUnsubscribeTokenInvalid | EffectDrizzleQueryError
  >;
  /** A fresh marketing preferences link for the token's recipient. */
  readonly preferencesUrl: (
    token: string
  ) => Effect.Effect<
    string,
    | CampaignUnsubscribeTokenInvalid
    | EffectDrizzleQueryError
    | MarketingManagementError
    | WorkspaceUrlConfigError
  >;
}

/** One-click unsubscribe links of marketing campaign emails. */
export class CampaignUnsubscribeService extends Context.Service<
  CampaignUnsubscribeService,
  ICampaignUnsubscribeService
>()("@deskohub-workspace/email-campaigns/CampaignUnsubscribeService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const consents = yield* CustomerMarketingConsentRepository;
      const marketingManagement = yield* MarketingManagementService;
      const keys = yield* loadCampaignSigningKeys("unsubscribe-token");

      /**
       * Opens the token and checks that it names a recipient of a marketing
       * send, so a token for any other email can't touch consent.
       */
      const findRecipient = Effect.fn(
        "CampaignUnsubscribeService.findRecipient"
      )(function* (token: string) {
        const recipient = yield* Option.match(
          openCampaignUnsubscribeToken(keys, token),
          {
            onNone: () => Effect.fail(new CampaignUnsubscribeTokenInvalid()),
            onSome: Effect.succeed,
          }
        );
        const [row] = yield* db
          .select({ purpose: sendPurpose })
          .from(emailCampaignRecipients)
          .innerJoin(
            emailCampaignSends,
            eq(emailCampaignSends.id, emailCampaignRecipients.sendId)
          )
          .innerJoin(
            emailCampaigns,
            eq(emailCampaigns.id, emailCampaignSends.campaignId)
          )
          .leftJoin(emailCampaignAutomationVersions, sendAutomationVersion)
          .where(
            and(
              eq(emailCampaignRecipients.sendId, recipient.sendId),
              eq(
                emailCampaignRecipients.dotyposCustomerId,
                recipient.dotyposCustomerId
              )
            )
          );
        if (row?.purpose !== "marketing") {
          return yield* new CampaignUnsubscribeTokenInvalid();
        }
        return recipient;
      });

      return {
        unsubscribeUrl: Effect.fn("CampaignUnsubscribeService.unsubscribeUrl")(
          function* (recipient) {
            const url = new URL(
              campaignUnsubscribePath,
              yield* getWorkspaceRuntimeCallbackOrigin
            );
            url.searchParams.set(
              "token",
              signCampaignUnsubscribeToken(keys[0], recipient)
            );
            appendVercelPreviewProtectionBypass(url);
            return url.href;
          }
        ),
        unsubscribe: Effect.fn("CampaignUnsubscribeService.unsubscribe")(
          function* (token) {
            const { dotyposCustomerId } = yield* findRecipient(token);
            const withdrawn = yield* consents.withdrawActive({
              dotyposCustomerId,
              withdrawnAt: yield* currentInstant,
            });
            return withdrawn ? "withdrawn" : "unchanged";
          }
        ),
        preferencesUrl: Effect.fn("CampaignUnsubscribeService.preferencesUrl")(
          function* (token) {
            const { dotyposCustomerId } = yield* findRecipient(token);
            const accessToken =
              yield* marketingManagement.issue(dotyposCustomerId);
            return yield* getRuntimeMarketingPreferencesAccessUrl(accessToken);
          }
        ),
      } satisfies ICampaignUnsubscribeService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerMarketingConsentRepository.Default,
        MarketingManagementService.Default
      )
    ),
    Layer.provide(WorkspaceDatabase.Default)
  );
}
