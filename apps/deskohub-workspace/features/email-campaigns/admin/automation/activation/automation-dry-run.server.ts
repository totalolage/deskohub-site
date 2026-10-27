import "server-only";

import {
  type AutomationDetail,
  type AutomationDryRun,
  AutomationPreviewId,
} from "@deskohub/workspace-admin-api";
import { Effect, Option, Schema } from "effect";
import { runAdministrationPage } from "@/features/administrators/server/administration-request.server";
import {
  getSearchParam,
  type SearchParamsRecord,
} from "@/shared/utils/search-params";
import {
  campaignOperationCapabilities,
  invokeCampaignOperation,
} from "../../campaign-operation-query.server";

const decodePreviewId = Schema.decodeUnknownOption(AutomationPreviewId);

/**
 * The dry run the preview tab shows: the job `activation` names, else the
 * one the `preview` search parameter names, which keeps a failed or
 * superseded job and the last results visible once activation no longer
 * points at them. Another campaign's or an expired job shows nothing.
 */
export const loadAutomationDryRun = async (
  automation: AutomationDetail,
  searchParams: SearchParamsRecord
): Promise<AutomationDryRun | undefined> => {
  const previewId =
    automation.activation._tag === "PreviewRunning" ||
    automation.activation._tag === "Ready"
      ? Option.some(automation.activation.previewId)
      : decodePreviewId(getSearchParam(searchParams, "preview"));
  if (Option.isNone(previewId)) return undefined;
  const cursor = getSearchParam(searchParams, "cursor");
  const dryRun = await runAdministrationPage(
    "email-campaigns.admin.load-automation-dry-run",
    invokeCampaignOperation("getAutomationDryRun", {
      previewId: previewId.value,
      ...(cursor && { cursor }),
    }).pipe(
      Effect.map(Option.some),
      Effect.catchTag("OperationNotFound", () => Effect.succeedNone)
    ),
    campaignOperationCapabilities
  );
  return Option.getOrUndefined(
    Option.filter(
      dryRun,
      (candidate) => candidate.campaignId === automation.campaignId
    )
  );
};
