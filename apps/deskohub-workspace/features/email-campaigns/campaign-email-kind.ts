import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Schema } from "effect";
import type { EmailKind } from "@/shared/backend/email/email-kind";
import { campaignSendIdSchema } from "./campaign-identifiers";

const CampaignEmailMetadata = Schema.Struct({
  campaignSendId: campaignSendIdSchema,
  dotyposCustomerId: DotyposCustomerIdSchema,
});

/** The frozen recipient a campaign delivery's tags name. */
export type CampaignEmailRecipient = typeof CampaignEmailMetadata.Type;

/**
 * A campaign delivery. Its tags name the frozen recipient, so delivery
 * reports find it even before its message ID is stored.
 */
export const campaignEmailKind: EmailKind<CampaignEmailRecipient> = {
  category: "email-campaign",
  metadata: Schema.toStandardSchemaV1(CampaignEmailMetadata),
};
