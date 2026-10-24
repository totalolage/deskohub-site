import type {
  AudienceFilter,
  AutomationConditionFilter,
  AutomationFlow,
} from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  type AudienceValueLookups,
  describeAudienceFilter,
} from "../../audience-filter-summary";

/** Saved audience titles by id, for "in saved audience" clauses. */
type AudienceTitles = ReadonlyMap<string, string>;

/** Whether the clause holds only catalogued conditions the summary can word. */
const isAudienceFilter = (
  filter: AutomationConditionFilter
): filter is AudienceFilter =>
  filter._tag === "Group"
    ? filter.filters.every(isAudienceFilter)
    : filter._tag !== "InAudience";

const describeClause = (
  clause: AutomationConditionFilter | undefined,
  position: number,
  { audiences, lookups }: ConditionWording,
  locale: Locale
) => {
  if (clause === undefined || clause._tag === "Group") {
    return clause !== undefined && isAudienceFilter(clause)
      ? describeAudienceFilter(clause, locale, lookups)
      : m.emailAutomationRunsConditionClause({ position }, { locale });
  }
  if (clause._tag === "InAudience") {
    const audience =
      audiences.get(clause.audienceId) ??
      m.emailAutomationRunsConditionAudienceUnknown({}, { locale });
    return clause.operator === "in"
      ? m.emailAutomationRunsConditionInAudience({ audience }, { locale })
      : m.emailAutomationRunsConditionNotInAudience({ audience }, { locale });
  }
  return describeAudienceFilter(clause, locale, lookups);
};

/** A condition's top-level clauses: a group's members, or the one filter. */
const topLevelClauses = (
  filter: AutomationConditionFilter | undefined
): readonly AutomationConditionFilter[] => {
  if (filter === undefined) return [];
  return filter._tag === "Group" ? filter.filters : [filter];
};

export interface ConditionWording {
  readonly audiences: AudienceTitles;
  readonly lookups: AudienceValueLookups;
}

/**
 * The clauses of a condition step that didn't match, each as a sentence.
 * `failedConditions` indexes the step's top-level clauses; a clause the
 * flow no longer has reads as its position.
 */
export const describeFailedConditions = ({
  failedConditions,
  flow,
  locale,
  stepId,
  wording,
}: {
  readonly failedConditions: readonly number[];
  readonly flow: AutomationFlow | null;
  readonly locale: Locale;
  readonly stepId: string | null;
  readonly wording: ConditionWording;
}): readonly string[] => {
  const step = flow?.steps.find(({ id }) => id === stepId);
  const filter = step?._tag === "Condition" ? step.filter : undefined;
  const clauses = topLevelClauses(filter);
  return failedConditions.map((index) =>
    describeClause(clauses[index], index + 1, wording, locale)
  );
};
