"use server";

import { Effect } from "effect";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import type { Locale } from "@/features/i18n";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { PublicSafeActionError } from "@/shared/utils/safe-action-client";
import { CampaignService } from "../../backend/campaign.service";
import { CampaignSendService } from "../../backend/campaign-send.service";
import {
  type CampaignSendingFailure,
  describeCampaignSendingFailure,
} from "./campaign-sending-failure";
import {
  campaignReferenceStandardSchema,
  campaignRetryStandardSchema,
  campaignSendStandardSchema,
  campaignTestSendStandardSchema,
} from "./contracts";

// Each handler declares its context parameter so that Effect.fn passes it on
// to the pipe, which reports failures in the admin's locale.
const toPublicSendingError =
  (locale: Locale) => (cause: CampaignSendingFailure) =>
    new PublicSafeActionError({
      message: describeCampaignSendingFailure(cause, locale),
      cause,
    });

const campaignPath = (campaignId: string) =>
  `/admin/email-campaigns/${campaignId}`;

const testSendAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.test-send",
    schema: campaignTestSendStandardSchema,
    logInput: false,
  },
  Effect.fn(
    function* ({ campaignId, extraRecipients }, { locale }) {
      yield* requireAdministratorAuthorization;
      const sending = yield* CampaignSendService;
      const receipt = yield* sending.testSend({
        campaignId,
        extraRecipients,
      });
      return {
        recipients: receipt.recipients,
        locales: receipt.locales,
        codeExpiry: formatAdministrationDateTime(
          receipt.codeExpiresAt.toString(),
          locale
        ),
      };
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(CampaignSendService.Live),
        Effect.mapError(toPublicSendingError(locale))
      )
  )
);

const sendAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.send",
    schema: campaignSendStandardSchema,
    logInput: false,
  },
  Effect.fn(
    function* ({ campaignId, confirmationCode }, _context) {
      yield* requireAdministratorAuthorization;
      const sending = yield* CampaignSendService;
      return yield* sending.send({ campaignId, confirmationCode });
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(CampaignSendService.Live),
        Effect.mapError(toPublicSendingError(locale))
      )
  )
);

const retryUndeliveredAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.retry-undelivered",
    schema: campaignRetryStandardSchema,
  },
  Effect.fn(
    function* ({ campaignId, includeUnconfirmed }, _context) {
      yield* requireAdministratorAuthorization;
      const sending = yield* CampaignSendService;
      return yield* sending.retryUndelivered({
        campaignId,
        includeUnconfirmed,
      });
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(CampaignSendService.Live),
        Effect.mapError(toPublicSendingError(locale))
      )
  )
);

const duplicateAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.duplicate",
    schema: campaignReferenceStandardSchema,
  },
  Effect.fn(
    function* ({ campaignId }, _context) {
      yield* requireAdministratorAuthorization;
      const campaigns = yield* CampaignService;
      const copy = yield* campaigns.duplicate(campaignId);
      return { campaignId: copy.id };
    },
    (effect, _input, { locale }) =>
      effect.pipe(
        Effect.provide(CampaignService.Live),
        Effect.mapError(toPublicSendingError(locale))
      )
  )
);

// Revalidate in the bridges rather than inside the Effect: a fiber resumed by
// a database callback can run under another request's Next.js work store.

export const sendCampaignTest: typeof testSendAction = async (
  ...args: Parameters<typeof testSendAction>
) => {
  "use server";
  return await testSendAction(...args);
};

export const sendCampaign: typeof sendAction = async (
  ...args: Parameters<typeof sendAction>
) => {
  "use server";
  const result = await sendAction(...args);
  if (result?.data) {
    revalidateLocalizedPath("/admin/email-campaigns");
    revalidateLocalizedPath(campaignPath(args[0].campaignId));
  }
  return result;
};

export const retryUndeliveredCampaignRecipients: typeof retryUndeliveredAction =
  async (...args: Parameters<typeof retryUndeliveredAction>) => {
    "use server";
    const result = await retryUndeliveredAction(...args);
    if (result?.data) {
      revalidateLocalizedPath("/admin/email-campaigns");
      revalidateLocalizedPath(campaignPath(args[0].campaignId));
    }
    return result;
  };

export const duplicateCampaign: typeof duplicateAction = async (
  ...args: Parameters<typeof duplicateAction>
) => {
  "use server";
  const result = await duplicateAction(...args);
  if (result?.data) revalidateLocalizedPath("/admin/email-campaigns");
  return result;
};
