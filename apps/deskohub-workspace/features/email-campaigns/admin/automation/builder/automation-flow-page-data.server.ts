import "server-only";

import type {
  AutomationConditionFilterType as AutomationConditionFilter,
  AutomationFlowType as AutomationFlow,
  CalendarExpressionType as CalendarExpression,
} from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { runAdministrationPage } from "@/features/administrators/server/administration-request.server";
import type { Locale } from "@/features/i18n";
import type {
  AudienceValueLookups,
  AudienceValueOption,
} from "../../audience-filter-summary";
import { loadAudienceValueLookups } from "../../audiences/audience-value-lookups.server";
import { describeCampaignOperationFailure } from "../../campaign-operation-failure";
import {
  campaignOperationCapabilities,
  invokeCampaignOperation,
} from "../../campaign-operation-query.server";
import { triggerPreviewKey } from "./automation-flow-editing";
import {
  type CalendarPreviewView,
  type CalendarUsage,
  calendarPreviewFailureCopy,
  calendarPreviewView,
} from "./calendar-preview";

/** What the flow builder needs beyond the automation itself. */
export type AutomationFlowBuilderData = {
  /** Value lists for condition steps' attribute pickers. */
  readonly lookups: AudienceValueLookups;
  /** Saved audiences a condition can check membership of. */
  readonly savedAudiences: readonly AudienceValueOption[];
  /**
   * The port's preview of each saved calendar, keyed by step id, or by
   * `triggerPreviewKey` for a schedule, so the first render already shows
   * every sentence and next start.
   */
  readonly calendarPreviews: Readonly<Record<string, CalendarPreviewView>>;
};

/** Each calendar in a flow with the key and usage its preview goes under. */
const flowCalendars = (
  flow: AutomationFlow | null
): readonly (readonly [string, CalendarExpression, CalendarUsage])[] =>
  flow === null
    ? []
    : [
        ...(flow.trigger._tag === "Schedule"
          ? [[triggerPreviewKey, flow.trigger.calendar, "trigger"] as const]
          : []),
        ...flow.steps.flatMap((step) =>
          step._tag === "Wait" && step.wait._tag === "Calendar"
            ? [[step.id, step.wait.expression, "wait"] as const]
            : []
        ),
      ];

/**
 * Saved audiences a condition can pick: the unarchived ones, plus archived
 * ones the flow already checks so their names still show.
 */
const loadSavedAudiences = (referenced: ReadonlySet<string>) =>
  invokeCampaignOperation("listCampaignAudiences", {}).pipe(
    Effect.map((audiences) =>
      audiences
        .filter(
          ({ id, archivedAt }) => archivedAt === null || referenced.has(id)
        )
        .map(({ id, title }) => ({ id, name: title }))
    )
  );

const loadCalendarPreviews = (flow: AutomationFlow | null, locale: Locale) =>
  Effect.all(
    Object.fromEntries(
      flowCalendars(flow).map(([key, expression, usage]) => [
        key,
        invokeCampaignOperation("previewCalendarExpression", {
          expression,
          usage,
          locale,
        }).pipe(
          Effect.map((preview) => calendarPreviewView(preview, locale)),
          Effect.catch((failure) =>
            Effect.succeed<CalendarPreviewView>({
              _tag: "Failed",
              message: describeCampaignOperationFailure(
                failure,
                calendarPreviewFailureCopy,
                locale
              ),
              code: failure.code,
            })
          )
        ),
      ])
    ),
    { concurrency: "unbounded" }
  );

const audienceIdsIn = (
  filter: AutomationConditionFilter
): readonly string[] => {
  switch (filter._tag) {
    case "Group":
      return filter.filters.flatMap(audienceIdsIn);
    case "InAudience":
      return [filter.audienceId];
    default:
      return [];
  }
};

/** Ids of the saved audiences a flow's conditions check. */
const referencedAudienceIds = (flow: AutomationFlow | null) =>
  new Set(
    flow?.steps.flatMap((step) =>
      step._tag === "Condition" ? audienceIdsIn(step.filter) : []
    )
  );

/**
 * The flow builder's lookups, saved audiences and calendar previews, read
 * through the campaign operations port.
 */
export const loadAutomationFlowBuilderData = async (
  flow: AutomationFlow | null,
  locale: Locale
): Promise<AutomationFlowBuilderData> => {
  const [lookups, { savedAudiences, calendarPreviews }] = await Promise.all([
    loadAudienceValueLookups(),
    runAdministrationPage(
      "email-campaigns.admin.load-automation-flow-builder",
      Effect.all(
        {
          savedAudiences: loadSavedAudiences(referencedAudienceIds(flow)),
          calendarPreviews: loadCalendarPreviews(flow, locale),
        },
        { concurrency: "unbounded" }
      ),
      campaignOperationCapabilities
    ),
  ]);
  return { lookups, savedAudiences, calendarPreviews };
};
