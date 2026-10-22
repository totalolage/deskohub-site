import {
  type AutomationConditionFilterType as AutomationConditionFilter,
  type AutomationDurationUnitType as AutomationDurationUnit,
  type AutomationFlowType as AutomationFlow,
  type AutomationStepType as AutomationStep,
  type AutomationTriggerType as AutomationTrigger,
  AutomationFlow as automationFlowContractSchema,
  type CalendarExpressionType as CalendarExpression,
  canonicalCalendarExpression,
  type InSavedAudienceType as InSavedAudience,
  scheduleMinutesOffTick,
} from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
import { reservationProductFilterSchema } from "@/features/reservation/reservation-product-descriptor";
import { validateCalendarExpression } from "@/shared/utils/calendar-expression";
import { type AudienceFilter, audienceFilterSchema } from "../audience-filter";
import { audienceFilterUsage } from "../audience-filter-usage";
import type { CampaignAudienceId, CampaignId } from "../campaign-identifiers";
import {
  AutomationCalendarNeverOccurs,
  AutomationFlowInvalid,
  type AutomationFlowLocation,
  AutomationScheduleMinutesNotAllowed,
} from "./errors";

const triggerLocation: AutomationFlowLocation = { _tag: "Trigger" };

const stepLocation = (step: AutomationStep): AutomationFlowLocation => ({
  _tag: "Step",
  stepId: step.id,
});

const conditionFilters = (
  flow: AutomationFlow
): readonly AutomationConditionFilter[] =>
  flow.steps.flatMap((step) =>
    step._tag === "Condition" ? [step.filter] : []
  );

/**
 * A condition filter's catalogued conditions in their groups, without its
 * saved-audience leaves. A lone saved-audience leaf leaves an empty group.
 */
const catalogueConditionTree = (
  filter: AutomationConditionFilter
): AudienceFilter => {
  if (filter._tag === "InAudience") {
    return { _tag: "Group", operator: "and", filters: [] };
  }
  if (filter._tag !== "Group") {
    return filter;
  }
  return {
    ...filter,
    filters: filter.filters.flatMap((node) =>
      node._tag === "InAudience" ? [] : [catalogueConditionTree(node)]
    ),
  };
};

const savedAudienceLeaves = (
  filter: AutomationConditionFilter
): readonly InSavedAudience[] => {
  if (filter._tag === "Group") {
    return filter.filters.flatMap(savedAudienceLeaves);
  }
  return filter._tag === "InAudience" ? [filter] : [];
};

const triggerProduct = (trigger: AutomationTrigger) =>
  "product" in trigger ? trigger.product : undefined;

const isCatalogProductFilter = Schema.is(reservationProductFilterSchema);
const isCatalogAudienceFilter = Schema.is(audienceFilterSchema);

/**
 * Whether the trigger's and conditions' product filters each name a
 * property of their family's catalog with a valid value. Conditions check
 * with `audienceFilterSchema`, as saved audiences do.
 */
const hasCatalogProductFilters = (flow: AutomationFlow): boolean => {
  const product = triggerProduct(flow.trigger);
  return (
    (product === undefined || isCatalogProductFilter(product)) &&
    conditionFilters(flow).every((filter) =>
      isCatalogAudienceFilter(catalogueConditionTree(filter))
    )
  );
};

/**
 * The contract's flow schema, plus a check that every reservation product
 * filter fits its family's catalog. The Admin UI, the administration API,
 * and stored flows all decode with it.
 */
export const automationFlowSchema = automationFlowContractSchema.check(
  Schema.makeFilter(hasCatalogProductFilters, {
    message:
      "Reservation product filters must name a catalog property with a valid value.",
  })
);

const maxWaitDays = 366;

/**
 * The longest wait of each unit that lasts at most 366 days. Twelve months
 * never exceed it and thirteen always do.
 */
const maxWaitCount = {
  minute: maxWaitDays * 24 * 60,
  hour: maxWaitDays * 24,
  day: maxWaitDays,
  week: Math.floor(maxWaitDays / 7),
  month: 12,
} as const satisfies Record<AutomationDurationUnit, number>;

const ensureWaitWithinLimit = (step: AutomationStep) =>
  step._tag === "Wait" &&
  step.wait._tag === "Duration" &&
  step.wait.count > maxWaitCount[step.wait.unit]
    ? Effect.fail(
        new AutomationFlowInvalid({
          location: stepLocation(step),
          message: `Step "${step.id}" waits longer than ${maxWaitDays} days. A wait can last at most ${maxWaitDays} days, ${maxWaitCount.week} weeks or ${maxWaitCount.month} months.`,
        })
      )
    : Effect.void;

/** A schedule fires only on the engine's ticks (D36); calendar waits may use any minute. */
export const ensureScheduleOnTicks = (calendar: CalendarExpression) => {
  const minutes = scheduleMinutesOffTick(calendar);
  return minutes.length > 0
    ? Effect.fail(new AutomationScheduleMinutesNotAllowed({ minutes }))
    : Effect.void;
};

/** The schedule trigger's calendar and each calendar wait's, with where they are. */
const flowCalendars = (
  flow: AutomationFlow
): readonly {
  readonly location: AutomationFlowLocation;
  readonly expression: CalendarExpression;
}[] => [
  ...(flow.trigger._tag === "Schedule"
    ? [{ location: triggerLocation, expression: flow.trigger.calendar }]
    : []),
  ...flow.steps.flatMap((step) =>
    step._tag === "Wait" && step.wait._tag === "Calendar"
      ? [{ location: stepLocation(step), expression: step.wait.expression }]
      : []
  ),
];

/**
 * The flow with each calendar in canonical order, so equal flows store and
 * hash alike.
 */
export const canonicalAutomationFlow = (
  flow: AutomationFlow
): AutomationFlow => ({
  trigger:
    flow.trigger._tag === "Schedule"
      ? {
          ...flow.trigger,
          calendar: canonicalCalendarExpression(flow.trigger.calendar),
        }
      : flow.trigger,
  steps: flow.steps.map((step) =>
    step._tag === "Wait" && step.wait._tag === "Calendar"
      ? {
          ...step,
          wait: {
            ...step.wait,
            expression: canonicalCalendarExpression(step.wait.expression),
          },
        }
      : step
  ),
});

/**
 * The flow every write path stores and activation publishes: decoded with
 * `automationFlowSchema`, a schedule firing only on engine ticks, each
 * wait at most 366 days, each calendar occurring within eight years, in
 * canonical form. Condition steps may use
 * trigger windows, "this campaign" and saved audiences; the campaign's
 * entry audience is a saved audience, so its writes reject them. Whether
 * referenced audiences and campaigns exist is the caller's database check
 * over `automationFlowReferences`.
 */
export const validateAutomationFlow = (
  flow: AutomationFlow
): Effect.Effect<
  AutomationFlow,
  | AutomationFlowInvalid
  | AutomationScheduleMinutesNotAllowed
  | AutomationCalendarNeverOccurs
> =>
  Schema.decodeEffect(automationFlowSchema)(flow).pipe(
    Effect.mapError(
      (cause) => new AutomationFlowInvalid({ message: cause.message, cause })
    ),
    Effect.tap(({ trigger }) =>
      trigger._tag === "Schedule"
        ? ensureScheduleOnTicks(trigger.calendar)
        : Effect.void
    ),
    Effect.tap(({ steps }) =>
      Effect.forEach(steps, ensureWaitWithinLimit, { discard: true })
    ),
    Effect.tap((decoded) =>
      Effect.forEach(
        flowCalendars(decoded),
        ({ location, expression }) =>
          validateCalendarExpression(expression).pipe(
            Effect.mapError(
              (cause) => new AutomationCalendarNeverOccurs({ location, cause })
            )
          ),
        { discard: true }
      )
    ),
    Effect.map(canonicalAutomationFlow)
  );

/** The saved audiences and campaigns a flow's condition steps name. */
export type AutomationFlowReferences = {
  readonly savedAudienceIds: readonly CampaignAudienceId[];
  readonly campaignIds: readonly CampaignId[];
};

/**
 * The saved audiences and campaigns a flow's conditions name, each once.
 * Activation checks that they all exist.
 */
export const automationFlowReferences = (
  flow: AutomationFlow
): AutomationFlowReferences => {
  const filters = conditionFilters(flow);
  return {
    savedAudienceIds: [
      ...new Set(
        filters.flatMap(savedAudienceLeaves).map(({ audienceId }) => audienceId)
      ),
    ],
    campaignIds: [
      ...new Set(
        filters.flatMap(
          (filter) =>
            audienceFilterUsage(catalogueConditionTree(filter))
              .specificCampaignIds
        )
      ),
    ],
  };
};
