import {
  AdministrationCampaignRecipientSkipReason,
  AdministrationDotyposCustomerId,
  AutomationRunOutcome,
  AutomationRunState,
  AutomationStepId,
  AutomationVersionNumber,
} from "@deskohub/workspace-admin-api";
import { Option, Predicate, Schema } from "effect";
import type { AdministrationListParams } from "@/features/administration/list-href";

/** The run log's filters and page, as its URL carries them. */
export interface AutomationRunFilters {
  readonly state: Option.Option<AutomationRunState>;
  readonly outcome: Option.Option<AutomationRunOutcome>;
  readonly skipReason: Option.Option<AdministrationCampaignRecipientSkipReason>;
  readonly stepId: Option.Option<AutomationStepId>;
  readonly versionNumber: Option.Option<AutomationVersionNumber>;
  readonly customerId: Option.Option<AdministrationDotyposCustomerId>;
  readonly cursor: Option.Option<string>;
}

export type AutomationRunSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

const param = (
  searchParams: AutomationRunSearchParams,
  name: string
): Option.Option<string> => {
  const value = searchParams[name];
  return Option.fromNullishOr(
    Predicate.isString(value) ? value : value?.[0]
  ).pipe(
    Option.map((text) => text.trim()),
    Option.filter((text) => text.length > 0)
  );
};

/** The filters in a run log URL; a value the port wouldn't accept is dropped. */
export const parseAutomationRunFilters = (
  searchParams: AutomationRunSearchParams
): AutomationRunFilters => ({
  state: param(searchParams, "state").pipe(
    Option.flatMap(Schema.decodeUnknownOption(AutomationRunState))
  ),
  outcome: param(searchParams, "outcome").pipe(
    Option.flatMap(Schema.decodeUnknownOption(AutomationRunOutcome))
  ),
  skipReason: param(searchParams, "skipReason").pipe(
    Option.flatMap(
      Schema.decodeUnknownOption(AdministrationCampaignRecipientSkipReason)
    )
  ),
  stepId: param(searchParams, "step").pipe(
    Option.flatMap(Schema.decodeUnknownOption(AutomationStepId))
  ),
  versionNumber: param(searchParams, "version").pipe(
    Option.map(Number),
    Option.flatMap(Schema.decodeUnknownOption(AutomationVersionNumber))
  ),
  customerId: param(searchParams, "customer").pipe(
    Option.flatMap(Schema.decodeUnknownOption(AdministrationDotyposCustomerId))
  ),
  cursor: param(searchParams, "cursor"),
});

/** The URL params of `filters`, for links that keep or change them. */
export const automationRunFilterParams = (
  filters: AutomationRunFilters
): AdministrationListParams => ({
  state: Option.getOrUndefined(filters.state),
  outcome: Option.getOrUndefined(filters.outcome),
  skipReason: Option.getOrUndefined(filters.skipReason),
  step: Option.getOrUndefined(filters.stepId),
  version: Option.getOrUndefined(Option.map(filters.versionNumber, String)),
  customer: Option.getOrUndefined(filters.customerId),
  cursor: Option.getOrUndefined(filters.cursor),
});

/** Whether any filter narrows the list, so an empty page means "no match". */
export const hasAutomationRunFilters = (filters: AutomationRunFilters) =>
  [
    filters.state,
    filters.outcome,
    filters.skipReason,
    filters.stepId,
    filters.versionNumber,
    filters.customerId,
  ].some((value: Option.Option<unknown>) => Option.isSome(value));
