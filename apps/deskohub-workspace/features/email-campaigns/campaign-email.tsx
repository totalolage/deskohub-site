import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import type { EmailMessage, EmailRecipient } from "@deskohub/email";
import { Data, Effect, Match, Schema } from "effect";
import { Text } from "react-email";
import { WorkspaceCampaignFooter } from "@/emails/_components/workspace-campaign-footer";
import { type Locale, m } from "@/features/i18n";
import { getRuntimeMarketingPreferencesPlaceholderUrl } from "@/features/legal/marketing-preferences-access-url";
import {
  type EmailKind,
  emailKindTags,
} from "@/shared/backend/email/email-kind";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import { CampaignBodyContent } from "./body/campaign-body-content";
import type {
  CampaignLocaleContent,
  CampaignPurpose,
  CampaignTemplateKey,
} from "./body/campaign-content";
import { campaignTemplates } from "./body/campaign-templates";
import {
  type CampaignConfirmationCode,
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

type RenderedCampaignEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

/**
 * Whom a delivery addresses. A marketing recipient's footer links to the
 * same unsubscribe URL as the RFC 8058 one-click headers; an operational
 * email has neither.
 */
export type CampaignDeliveryAudience = Data.TaggedEnum<{
  Marketing: { readonly unsubscribeUrl: string };
  Operational: Record<never, never>;
}>;

export const CampaignDeliveryAudience =
  Data.taggedEnum<CampaignDeliveryAudience>();

/**
 * Why a campaign email is sent. A test email goes to an admin inbox with the
 * code that confirms the real send; a delivery goes to one frozen recipient,
 * whom its tags name for the delivery-status webhook.
 */
export type CampaignEmailOccasion = Data.TaggedEnum<{
  Test: {
    readonly to: string;
    readonly purpose: CampaignPurpose;
    readonly code: CampaignConfirmationCode;
  };
  Delivery: {
    readonly to: string;
    readonly recipient: {
      readonly sendId: CampaignSendId;
      readonly dotyposCustomerId: DotyposCustomerId;
    };
    readonly audience: CampaignDeliveryAudience;
  };
}>;

export const CampaignEmailOccasion = Data.taggedEnum<CampaignEmailOccasion>();

type CampaignEmailContent = {
  readonly templateKey: CampaignTemplateKey;
  readonly locale: Locale;
  readonly content: CampaignLocaleContent;
};

type CampaignSender = {
  readonly from: EmailRecipient;
  readonly replyTo: EmailRecipient;
};

const operationalFooter = (content: {
  readonly operationalReason?: string | undefined;
}) =>
  WorkspaceCampaignFooter.Operational({
    operationalReason: content.operationalReason,
  });

/** The footer of an email that has no recipient's preferences link. */
export const campaignPlaceholderFooter = (input: {
  readonly purpose: CampaignPurpose;
  readonly operationalReason?: string | undefined;
}) =>
  Match.value(input.purpose).pipe(
    Match.when("marketing", () =>
      getRuntimeMarketingPreferencesPlaceholderUrl.pipe(
        Effect.map((marketingPreferencesUrl) =>
          WorkspaceCampaignFooter.Marketing({ marketingPreferencesUrl })
        )
      )
    ),
    Match.when("operational", () => Effect.succeed(operationalFooter(input))),
    Match.exhaustive
  );

/**
 * Renders one locale of a campaign inside its template, as HTML and plain
 * text. A test email leads with the code that confirms the real send.
 */
const renderCampaign = (
  input: CampaignEmailContent & {
    readonly footer: WorkspaceCampaignFooter;
    readonly confirmationCode?: CampaignConfirmationCode;
  }
) => {
  const { Email } = campaignTemplates[input.templateKey];
  return renderWorkspaceEmail(
    <Email
      body={
        <>
          {input.confirmationCode && (
            <Text className="m-0 mb-4 rounded-[8px] border border-[#ffd166] border-solid bg-[#fff8e1] px-4 py-3 text-[14px] leading-[20px] text-[#1c1f3b]">
              {m.emailCampaignTestNotice(
                { code: input.confirmationCode },
                { locale: input.locale }
              )}
            </Text>
          )}
          <CampaignBodyContent body={input.content.body} />
        </>
      }
      footer={input.footer}
      locale={input.locale}
      preview={input.content.preheader}
    />
  ).pipe(
    Effect.map(
      (rendered): RenderedCampaignEmail => ({
        ...rendered,
        subject: input.content.subject,
      })
    )
  );
};

/**
 * Renders one locale of a campaign for an admin preview, with the footer of
 * its purpose and a placeholder preferences link.
 */
export const renderCampaignEmailPreview = Effect.fn(
  "renderCampaignEmailPreview"
)(function* (
  input: CampaignEmailContent & { readonly purpose: CampaignPurpose }
) {
  const { subject, html, text } = yield* renderCampaign({
    ...input,
    footer: yield* campaignPlaceholderFooter({
      purpose: input.purpose,
      operationalReason: input.content.operationalReason,
    }),
  });
  return { subject, html, text } satisfies RenderedCampaignEmail;
});

/**
 * One locale of a campaign as the email sent on `occasion`.
 *
 * A test email has the `[TEST]` subject prefix, the confirmation code, and a
 * placeholder preferences link; it carries the code in its body, so
 * providers keep it out of logs in production. A delivery's footer and
 * headers come from its audience, and its tags let the delivery-status
 * webhook find the frozen recipient.
 */
export const campaignEmailMessage = Effect.fn("campaignEmailMessage")(
  function* (
    input: CampaignEmailContent & {
      readonly occasion: CampaignEmailOccasion;
      readonly sender: CampaignSender;
      readonly deploymentEnvironment: string;
    }
  ) {
    // Spreads the sender as given: delivery passes the campaign email config,
    // and the persisted batch payload hashes cover all of its fields.
    const { sender, deploymentEnvironment } = input;
    return yield* Match.valueTags(input.occasion, {
      Test: ({ to, purpose, code }) =>
        campaignPlaceholderFooter({
          purpose,
          operationalReason: input.content.operationalReason,
        }).pipe(
          Effect.flatMap((footer) =>
            renderCampaign({ ...input, footer, confirmationCode: code })
          ),
          Effect.map(
            (email): EmailMessage => ({
              ...sender,
              to: { email: to },
              ...email,
              subject: `${testSubjectPrefix} ${email.subject}`,
              tags: [campaignTestEmailCategory],
              sensitiveContent: deploymentEnvironment === "production",
            })
          )
        ),
      Delivery: ({ to, recipient, audience }) =>
        renderCampaign({
          ...input,
          footer: Match.valueTags(audience, {
            Marketing: ({ unsubscribeUrl }) =>
              WorkspaceCampaignFooter.Marketing({
                marketingPreferencesUrl: unsubscribeUrl,
              }),
            Operational: () => operationalFooter(input.content),
          }),
        }).pipe(
          Effect.map(
            (email): EmailMessage => ({
              ...sender,
              to: { email: to },
              ...email,
              headers: Match.valueTags(audience, {
                Marketing: ({ unsubscribeUrl }) => ({
                  "List-Unsubscribe": `<${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                }),
                Operational: () => undefined,
              }),
              ...emailKindTags(campaignEmailKind, {
                campaignSendId: recipient.sendId,
                dotyposCustomerId: recipient.dotyposCustomerId,
                deploymentEnvironment,
              }),
            })
          )
        ),
    });
  }
);
