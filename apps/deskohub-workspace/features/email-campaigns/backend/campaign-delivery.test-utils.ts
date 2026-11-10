import type { DotyposService } from "@deskohub/dotypos";
import type { EmailServiceTag } from "@deskohub/email";
import { Layer } from "effect";
import type { WorkspaceDatabase } from "@/db/database.service";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { MarketingManagementService } from "@/features/legal/backend/marketing-management.service";
import { CampaignBatchDelivery } from "./campaign-batch-delivery.service";
import { CampaignDeliveryService } from "./campaign-delivery.service";
import type { CampaignEmailConfig } from "./campaign-email.config";
import { CampaignRecipientAnalyticsIdentity } from "./campaign-recipient-analytics-identity.service";
import { CampaignUnsubscribeService } from "./campaign-unsubscribe.service";

/**
 * The campaign batch protocol and the one-off delivery service on the
 * Dotypos, email provider and sender configuration a test supplies, with
 * real unsubscribe links and recipient analytics identities read through
 * `analyticsConsent` (the real ledger unless the test supplies one). The
 * test provides the Workspace database.
 */
export const campaignDeliveryTestLayer = <E, R>(
  dependencies: Layer.Layer<
    DotyposService | EmailServiceTag | CampaignEmailConfig,
    E,
    R
  >,
  analyticsConsent: Layer.Layer<
    AnalyticsConsentLedger,
    never,
    WorkspaceDatabase
  > = AnalyticsConsentLedger.Default
) => {
  const batches = CampaignBatchDelivery.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        dependencies,
        CampaignRecipientAnalyticsIdentity.Default.pipe(
          Layer.provide(analyticsConsent)
        ),
        CampaignUnsubscribeService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              MarketingConsentLedger.Default,
              MarketingManagementService.Default
            )
          )
        )
      )
    )
  );
  return CampaignDeliveryService.Default.pipe(Layer.provideMerge(batches));
};
