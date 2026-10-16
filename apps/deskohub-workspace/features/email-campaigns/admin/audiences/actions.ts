"use server";

import { Effect } from "effect";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import {
  PublicSafeActionError,
  type SafeActionFailure,
} from "@/shared/utils/safe-action-client";
import { CampaignAudienceService } from "../../backend/campaign-audience.service";
import { CampaignAudienceInUse, CampaignAudienceNotFound } from "../../errors";
import {
  audienceReferenceStandardSchema,
  saveAudienceStandardSchema,
} from "./audience-contracts";

const inUseMessage = ({ draftCampaignIds }: CampaignAudienceInUse) =>
  `${
    draftCampaignIds.length === 1
      ? "A draft campaign uses"
      : `${draftCampaignIds.length} draft campaigns use`
  } this audience, so it can only be archived. Move those drafts to another audience before deleting it.`;

const audienceErrorMessage = (cause: SafeActionFailure, fallback: string) => {
  if (cause instanceof CampaignAudienceNotFound) {
    return "This audience no longer exists.";
  }
  if (cause instanceof CampaignAudienceInUse) return inUseMessage(cause);
  return fallback;
};

const toPublicAudienceError =
  (fallback: string) => (cause: SafeActionFailure) =>
    new PublicSafeActionError({
      message: audienceErrorMessage(cause, fallback),
      cause,
    });

const saveAudienceAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.save-audience",
    schema: saveAudienceStandardSchema,
  },
  ({ audienceId, title, filter }) =>
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
          "The audience could not be saved. Check the filters and try again."
        )
      )
    )
);

const archiveAudienceAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.archive-audience",
    schema: audienceReferenceStandardSchema,
  },
  ({ audienceId }) =>
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
        toPublicAudienceError("The audience could not be archived. Try again.")
      )
    )
);

const unarchiveAudienceAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.unarchive-audience",
    schema: audienceReferenceStandardSchema,
  },
  ({ audienceId }) =>
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
          "The audience could not be unarchived. Try again."
        )
      )
    )
);

const deleteAudienceAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.delete-audience",
    schema: audienceReferenceStandardSchema,
  },
  ({ audienceId }) =>
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
        toPublicAudienceError("The audience could not be deleted. Try again.")
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
