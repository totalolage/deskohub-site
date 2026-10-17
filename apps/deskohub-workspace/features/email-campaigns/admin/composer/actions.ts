"use server";

import { Effect, Match, Schema } from "effect";
import { m } from "@/features/administration/i18n";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { type Locale, locales } from "@/features/i18n";
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

const campaignSaveError =
  (locale: Locale) => (cause: { readonly _tag: string }) =>
    new PublicSafeActionError({
      message: Match.value(cause._tag).pipe(
        Match.when("CampaignContentInvalid", () =>
          m.emailCampaignsComposerSaveContentInvalid({}, { locale })
        ),
        Match.when("CampaignAudienceArchived", () =>
          m.emailCampaignsComposerSaveAudienceArchived({}, { locale })
        ),
        Match.when("CampaignAudienceNotFound", () =>
          m.emailCampaignsComposerSaveAudienceNotFound({}, { locale })
        ),
        Match.when("CampaignReadOnly", () =>
          m.emailCampaignsComposerSaveReadOnly({}, { locale })
        ),
        Match.when("CampaignNotFound", () =>
          m.emailCampaignsDraftNotFound({}, { locale })
        ),
        Match.orElse(() => m.emailCampaignsComposerSaveFailed({}, { locale }))
      ),
      cause,
    });

const campaignDeleteError =
  (locale: Locale) => (cause: { readonly _tag: string }) =>
    new PublicSafeActionError({
      message: Match.value(cause._tag).pipe(
        Match.when("CampaignReadOnly", () =>
          m.emailCampaignsDraftDeleteReadOnly({}, { locale })
        ),
        Match.when("CampaignNotFound", () =>
          m.emailCampaignsDraftNotFound({}, { locale })
        ),
        Match.orElse(() => m.emailCampaignsDraftDeleteFailed({}, { locale }))
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
  (input, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(createCampaignDraft(input)),
      Effect.provide(CampaignService.Live),
      Effect.mapError(campaignSaveError(locale))
    )
);

const updateCampaignAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.update",
    schema: Schema.toStandardSchemaV1(CampaignDraftUpdate, { parseOptions }),
  },
  (input, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(updateCampaignDraft(input)),
      Effect.provide(CampaignService.Live),
      Effect.mapError(campaignSaveError(locale))
    )
);

const deleteCampaignAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.delete",
    schema: campaignReferenceStandardSchema,
  },
  ({ campaignId }, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const campaigns = yield* CampaignService;
          yield* campaigns.delete(campaignId);
          return { campaignId };
        })
      ),
      Effect.provide(CampaignService.Live),
      Effect.mapError(campaignDeleteError(locale))
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
