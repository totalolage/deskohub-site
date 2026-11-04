"use server";

import { EmailDraft, EmailValueSnapshot } from "@deskohub/workspace-admin-api";
import { Clock, Effect, Layer, Schema } from "effect";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import { isCampaignImageSource } from "@/features/email-campaigns/body/campaign-body-rules";
import { campaignImageCloudName } from "@/features/email-campaigns/body/campaign-image-account";
import {
  previewEmailDocument,
  renderEmailPreview,
  sampleEmailValues,
} from "@/features/emails/body";
import { locales } from "@/features/i18n";
import { emailsEditorActionFailureCopy } from "./editor-action-failure-copy";

const EmailDraftPreviewInput = Schema.Struct({
  draft: EmailDraft,
  locale: Schema.Literals(locales),
  /** Values the host prepared; every other value shows a synthetic sample. */
  values: Schema.optionalKey(Schema.Record(Schema.String, EmailValueSnapshot)),
});

const previewEmailDraftAction = defineAdministrationAction(
  {
    operation: "emails.admin.preview-draft",
    schema: Schema.toStandardSchemaV1(EmailDraftPreviewInput),
    failureCopy: emailsEditorActionFailureCopy,
    capabilities: Layer.empty,
  },
  Effect.fn("previewEmailDraft")(function* (input) {
    const imageCloudName = yield* campaignImageCloudName;
    const draft = previewEmailDocument(input.draft, input.locale);
    // Only images from the Deskohub Cloudinary account load in a preview.
    const document = {
      ...draft,
      structure: draft.structure.filter(
        (component) =>
          component._tag !== "Image" ||
          isCampaignImageSource(component.src, imageCloudName)
      ),
    };
    const now = Temporal.Instant.fromEpochMilliseconds(
      yield* Clock.currentTimeMillis
    );
    const { subject, html } = yield* renderEmailPreview({
      document,
      locale: input.locale,
      values: {
        ...sampleEmailValues(document, input.locale, now),
        ...input.values,
      },
    });
    return { subject, html };
  })
);

/**
 * Renders one language of an email draft as its recipients would see it,
 * with the host's prepared values or synthetic samples, for the editor's
 * preview. An unfinished draft renders what is finished.
 */
export const previewEmailDraft: typeof previewEmailDraftAction = async (
  ...args: Parameters<typeof previewEmailDraftAction>
) => {
  "use server";
  return await previewEmailDraftAction(...args);
};
