import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import type { EmailMessage, EmailRecipient } from "@deskohub/email";
import { Option, Schema } from "effect";
import {
  type EmailKind,
  emailKindTags,
} from "@/shared/backend/email/email-kind";
import {
  type CampaignSendId,
  campaignSendIdSchema,
} from "./campaign-identifiers";

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

/** Resend `category` tag of campaign test emails, which aren't deliveries. */
const campaignTestEmailCategory = "email-campaign-test";

const testSubjectPrefix = "[TEST]";

export type RenderedCampaignEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

type CampaignSender = {
  readonly from: EmailRecipient;
  readonly replyTo: EmailRecipient;
};

/**
 * One campaign delivery. A marketing email carries the RFC 8058 one-click
 * unsubscribe headers for `unsubscribeUrl`; an operational email has none.
 * The tags let the delivery-status webhook find the frozen recipient.
 */
export const campaignDeliveryMessage = (input: {
  readonly sender: CampaignSender;
  readonly to: string;
  readonly email: RenderedCampaignEmail;
  readonly unsubscribeUrl: Option.Option<string>;
  readonly recipient: {
    readonly sendId: CampaignSendId;
    readonly dotyposCustomerId: DotyposCustomerId;
  };
  readonly deploymentEnvironment: string;
}): EmailMessage => ({
  ...input.sender,
  to: { email: input.to },
  ...input.email,
  headers: Option.match(input.unsubscribeUrl, {
    onNone: () => undefined,
    onSome: (url) => ({
      "List-Unsubscribe": `<${url}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }),
  }),
  ...emailKindTags(campaignEmailKind, {
    campaignSendId: input.recipient.sendId,
    dotyposCustomerId: input.recipient.dotyposCustomerId,
    deploymentEnvironment: input.deploymentEnvironment,
  }),
});

/**
 * One test email. It carries the confirmation code in its body, so
 * providers keep it out of logs in production; outside production the
 * Console provider is where the admin reads it.
 */
export const campaignTestMessage = (input: {
  readonly sender: CampaignSender;
  readonly to: string;
  readonly email: RenderedCampaignEmail;
  readonly deploymentEnvironment: string;
}): EmailMessage => ({
  ...input.sender,
  to: { email: input.to },
  ...input.email,
  subject: `${testSubjectPrefix} ${input.email.subject}`,
  tags: [campaignTestEmailCategory],
  sensitiveContent: input.deploymentEnvironment === "production",
});
