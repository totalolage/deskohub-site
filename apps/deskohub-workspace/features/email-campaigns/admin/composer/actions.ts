"use server";

import { Effect, Match, Schema } from "effect";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { locales } from "@/features/i18n";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CampaignService } from "../../backend/campaign.service";
import {
  CampaignBodyNode,
  campaignBodyFormatVersion,
} from "../../body/campaign-body-document";
import {
  CampaignLocalizedContent,
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import {
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../../campaign-identifiers";
import { renderCampaignEmailPreview } from "../email-preview/render-campaign-email-preview";
import { campaignReferenceStandardSchema } from "../sending/contracts";

const parseOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

const CampaignDraft = Schema.Struct({
  title: Schema.Trimmed.check(Schema.isNonEmpty()),
  purpose: CampaignPurpose,
  templateKey: CampaignTemplateKey,
  audienceId: Schema.NullOr(campaignAudienceIdSchema),
  content: CampaignLocalizedContent,
});

const CampaignDraftUpdate = Schema.Struct({
  ...CampaignDraft.fields,
  campaignId: campaignIdSchema,
});

const campaignSaveError = (cause: { readonly _tag: string }) =>
  new PublicSafeActionError({
    message: Match.value(cause._tag).pipe(
      Match.when(
        "CampaignContentInvalid",
        () => "The content has problems. Fix the listed issues, then save."
      ),
      Match.when(
        "CampaignAudienceArchived",
        () => "The selected audience is archived. Choose another audience."
      ),
      Match.when(
        "CampaignAudienceNotFound",
        () => "The selected audience no longer exists."
      ),
      Match.when(
        "CampaignReadOnly",
        () => "This campaign has left Draft and can no longer be edited."
      ),
      Match.when("CampaignNotFound", () => "This campaign no longer exists."),
      Match.orElse(() => "The campaign could not be saved. Try again.")
    ),
    cause,
  });

const campaignDeleteError = (cause: { readonly _tag: string }) =>
  new PublicSafeActionError({
    message: Match.value(cause._tag).pipe(
      Match.when(
        "CampaignReadOnly",
        () => "This campaign has left Draft and can no longer be deleted."
      ),
      Match.when("CampaignNotFound", () => "This campaign no longer exists."),
      Match.orElse(() => "The campaign could not be deleted. Try again.")
    ),
    cause,
  });

const createCampaignDraft = Effect.fn("CampaignComposer.create")(function* (
  input: typeof CampaignDraft.Type
) {
  const campaigns = yield* CampaignService;
  const campaign = yield* campaigns.create(input);
  return { campaignId: campaign.id };
});

const updateCampaignDraft = Effect.fn("CampaignComposer.update")(function* (
  input: typeof CampaignDraftUpdate.Type
) {
  const campaigns = yield* CampaignService;
  const campaign = yield* campaigns.update(input);
  return { campaignId: campaign.id };
});

const createCampaignAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.create",
    schema: Schema.toStandardSchemaV1(CampaignDraft, { parseOptions }),
  },
  (input) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(createCampaignDraft(input)),
      Effect.provide(CampaignService.Live),
      Effect.mapError(campaignSaveError)
    )
);

const updateCampaignAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.update",
    schema: Schema.toStandardSchemaV1(CampaignDraftUpdate, { parseOptions }),
  },
  (input) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(updateCampaignDraft(input)),
      Effect.provide(CampaignService.Live),
      Effect.mapError(campaignSaveError)
    )
);

const deleteCampaignAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.delete",
    schema: campaignReferenceStandardSchema,
  },
  ({ campaignId }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const campaigns = yield* CampaignService;
          yield* campaigns.delete(campaignId);
          return { campaignId };
        })
      ),
      Effect.provide(CampaignService.Live),
      Effect.mapError(campaignDeleteError)
    )
);

export const createCampaign: typeof createCampaignAction = async (
  ...args: Parameters<typeof createCampaignAction>
) => {
  "use server";
  const result = await createCampaignAction(...args);
  if (result?.data) revalidateLocalizedPath("/admin/email-campaigns");
  return result;
};

export const updateCampaign: typeof updateCampaignAction = async (
  ...args: Parameters<typeof updateCampaignAction>
) => {
  "use server";
  const result = await updateCampaignAction(...args);
  if (result?.data) {
    revalidateLocalizedPath("/admin/email-campaigns");
    revalidateLocalizedPath(`/admin/email-campaigns/${result.data.campaignId}`);
  }
  return result;
};

export const deleteCampaign: typeof deleteCampaignAction = async (
  ...args: Parameters<typeof deleteCampaignAction>
) => {
  "use server";
  const result = await deleteCampaignAction(...args);
  if (result?.data) {
    revalidateLocalizedPath("/admin/email-campaigns");
    revalidateLocalizedPath(`/admin/email-campaigns/${result.data.campaignId}`);
  }
  return result;
};

/**
 * Unsaved content for the live preview. The body skips the content rules, so
 * a half-finished button or link still previews; saving enforces them.
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
  (input) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(renderCampaignEmailPreview(input)),
      Effect.map(({ html, subject }) => ({ html, subject })),
      Effect.mapError(
        (cause) =>
          new PublicSafeActionError({
            message: "The preview could not be rendered.",
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
