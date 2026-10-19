"use server";

import { Effect, Schema } from "effect";
import { m } from "@/features/administration/i18n";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { locales } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import {
  CampaignBodyNode,
  campaignBodyFormatVersion,
} from "../../body/campaign-body-document";
import {
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import { renderCampaignEmailPreview } from "../../body/render-campaign-email-preview";

const parseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

/**
 * Unsaved content for the live preview. The body skips the content rules, so
 * a half-finished button or link still previews; saving enforces them. That
 * is why the preview renders the editor's document here, a UI-only action,
 * rather than through the campaign port, whose preview applies the rules.
 */
const CampaignPreviewRequest = Schema.Struct({
  templateKey: CampaignTemplateKey,
  purpose: CampaignPurpose,
  locale: Schema.Literals(locales),
  content: Schema.Struct({
    subject: Schema.String,
    preheader: Schema.String,
    body: Schema.Struct({
      formatVersion: Schema.Literal(campaignBodyFormatVersion),
      doc: CampaignBodyNode,
    }),
    operationalReason: Schema.optionalKey(Schema.String),
  }),
});

const previewCampaignEmailAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.preview",
    schema: Schema.toStandardSchemaV1(CampaignPreviewRequest, {
      parseOptions,
    }),
    logInput: false,
  },
  (input, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(renderCampaignEmailPreview(input)),
      Effect.map(({ html, subject }) => ({ html, subject })),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: m.emailCampaignsEmailPreviewRenderFailed({}, { locale }),
            cause,
          })
      )
    )
);

export const previewCampaignEmail: typeof previewCampaignEmailAction = async (
  ...args: Parameters<typeof previewCampaignEmailAction>
) => {
  "use server";
  return await previewCampaignEmailAction(...args);
};
