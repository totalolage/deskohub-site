"use server";

import { Effect } from "effect";
import { m } from "@/features/administration/i18n";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import type { Locale } from "@/features/i18n";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import {
  PublicSafeActionError,
  type SafeActionFailure,
} from "@/shared/utils/safe-action-client";
import { CampaignAudienceService } from "../../backend/campaign-audience.service";
import { CampaignAudienceInUse, CampaignAudienceNotFound } from "../../errors";
import type { AudienceMessage } from "./audience-attribute-wording";
import {
  audienceReferenceStandardSchema,
  saveAudienceStandardSchema,
} from "./audience-contracts";

const audienceErrorMessage = (
  cause: SafeActionFailure,
  fallback: AudienceMessage,
  locale: Locale
) => {
  if (cause instanceof CampaignAudienceNotFound) {
    return m.emailCampaignsAudienceNotFound({}, { locale });
  }
  if (cause instanceof CampaignAudienceInUse) {
    return m.emailCampaignsAudienceInUse(
      { count: cause.draftCampaignIds.length },
      { locale }
    );
  }
  return fallback({}, { locale });
};

const toPublicAudienceError =
  (fallback: AudienceMessage, locale: Locale) => (cause: SafeActionFailure) =>
    new PublicSafeActionError({
      message: audienceErrorMessage(cause, fallback, locale),
      cause,
    });

const saveAudienceAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.save-audience",
    schema: saveAudienceStandardSchema,
  },
  ({ audienceId, title, filter }, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const audiences = yield* CampaignAudienceService;
          const audience = audienceId
            ? yield* audiences.update({ audienceId, title, filter })
            : yield* audiences.create({ title, filter });
          return { audienceId: audience.id };
        })
      ),
      Effect.provide(CampaignAudienceService.Live),
      Effect.mapError(
        toPublicAudienceError(
          m.emailCampaignsAudienceSaveFailedCheckFilters,
          locale
        )
      )
    )
);

const archiveAudienceAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.archive-audience",
    schema: audienceReferenceStandardSchema,
  },
  ({ audienceId }, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const audiences = yield* CampaignAudienceService;
          const audience = yield* audiences.archive(audienceId);
          return { audienceId: audience.id };
        })
      ),
      Effect.provide(CampaignAudienceService.Live),
      Effect.mapError(
        toPublicAudienceError(
          m.emailCampaignsAudienceArchiveFailedRetry,
          locale
        )
      )
    )
);

const unarchiveAudienceAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.unarchive-audience",
    schema: audienceReferenceStandardSchema,
  },
  ({ audienceId }, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const audiences = yield* CampaignAudienceService;
          const audience = yield* audiences.unarchive(audienceId);
          return { audienceId: audience.id };
        })
      ),
      Effect.provide(CampaignAudienceService.Live),
      Effect.mapError(
        toPublicAudienceError(
          m.emailCampaignsAudienceUnarchiveFailedRetry,
          locale
        )
      )
    )
);

const deleteAudienceAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.delete-audience",
    schema: audienceReferenceStandardSchema,
  },
  ({ audienceId }, { locale }) =>
    requireAdministratorAuthorization.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          const audiences = yield* CampaignAudienceService;
          yield* audiences.delete(audienceId);
          return { audienceId };
        })
      ),
      Effect.provide(CampaignAudienceService.Live),
      Effect.mapError(
        toPublicAudienceError(m.emailCampaignsAudienceDeleteFailedRetry, locale)
      )
    )
);

export const saveAudience: typeof saveAudienceAction = async (
  ...args: Parameters<typeof saveAudienceAction>
) => {
  "use server";
  return saveAudienceAction(...args);
};

export const archiveAudience: typeof archiveAudienceAction = async (
  ...args: Parameters<typeof archiveAudienceAction>
) => {
  "use server";
  return archiveAudienceAction(...args);
};

export const unarchiveAudience: typeof unarchiveAudienceAction = async (
  ...args: Parameters<typeof unarchiveAudienceAction>
) => {
  "use server";
  return unarchiveAudienceAction(...args);
};

export const deleteAudience: typeof deleteAudienceAction = async (
  ...args: Parameters<typeof deleteAudienceAction>
) => {
  "use server";
  return deleteAudienceAction(...args);
};
