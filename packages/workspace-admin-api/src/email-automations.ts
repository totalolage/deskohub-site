import { Schema } from "effect";
import { ReservationProductFilter } from "./audience-attribute-kinds";
import {
  type AudienceCondition,
  type AudienceFilterOf,
  audienceAttributeCatalogue,
  makeAudienceFilterSchemas,
} from "./audience-filter";
import { CalendarExpression } from "./calendar-expression";
import { AdministrationCampaignAudienceId } from "./campaign-identifiers";

/** Stable id of a flow step. A run's position is a step id, not an index. */
export const AutomationStepId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,31}$/)
)
  .pipe(Schema.brand("AutomationStepId"))
  .annotate({
    identifier: "AutomationStepId",
    description:
      "Stable id of a flow step, unique within the flow: lowercase letters, digits and hyphens, at most 32.",
  });
export type AutomationStepId = typeof AutomationStepId.Type;

/** The reservation product filter of a reservation trigger; audiences use the same schema. */
const reservationTriggerFields = {
  product: Schema.optionalKey(ReservationProductFilter),
};

/** What starts a run: a calendar schedule or one of five customer events. */
export const AutomationTrigger = Schema.Union([
  Schema.TaggedStruct("Schedule", { calendar: CalendarExpression }),
  Schema.TaggedStruct("ReservationBooked", reservationTriggerFields),
  Schema.TaggedStruct("ReservationCancelled", reservationTriggerFields),
  Schema.TaggedStruct("ReservationStarted", reservationTriggerFields),
  Schema.TaggedStruct("ReservationFinished", reservationTriggerFields),
  Schema.TaggedStruct("AccountCreated", {}),
]).annotate({
  identifier: "AutomationTrigger",
  description:
    "A Prague-time calendar schedule, or a reservation booked, cancelled, started or finished (optionally for one product), or an account created.",
});
export type AutomationTrigger = typeof AutomationTrigger.Type;

/**
 * "Is (not) in saved audience". It is evaluated against the audience's
 * current definition, so an audience edit takes effect without a new version.
 */
export const InSavedAudience = Schema.TaggedStruct("InAudience", {
  audienceId: AdministrationCampaignAudienceId,
  operator: Schema.Literals(["in", "notIn"]),
}).annotate({
  identifier: "InSavedAudience",
  description:
    "Whether the customer is (in) or isn't (notIn) in a saved audience, by its current definition.",
});
export type InSavedAudience = typeof InSavedAudience.Type;

/** A condition step's leaf: a catalogued attribute condition or saved-audience membership. */
export type AutomationConditionLeaf = AudienceCondition | InSavedAudience;
export type AutomationConditionFilter =
  AudienceFilterOf<AutomationConditionLeaf>;

/** A condition step's filter: the audience builder's AND/OR groups plus "in saved audience" leaves. */
export const AutomationConditionFilter: Schema.Codec<AutomationConditionFilter> =
  makeAudienceFilterSchemas(audienceAttributeCatalogue, {
    extraLeaves: [InSavedAudience],
  }).filter.annotate({
    identifier: "AutomationConditionFilter",
    description:
      "Nested AND/OR tree of audience attribute conditions and saved-audience membership.",
  });

export const automationDurationUnits = [
  "minute",
  "hour",
  "day",
  "week",
  "month",
] as const;
export const AutomationDurationUnit = Schema.Literals(automationDurationUnits);
export type AutomationDurationUnit = typeof AutomationDurationUnit.Type;

/** A wait step: a relative delay, or until a calendar expression holds. */
export const AutomationWait = Schema.Union([
  Schema.TaggedStruct("Duration", {
    count: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9999 })),
    unit: AutomationDurationUnit,
  }),
  Schema.TaggedStruct("Calendar", { expression: CalendarExpression }),
]).annotate({ identifier: "AutomationWait" });
export type AutomationWait = typeof AutomationWait.Type;

export const AutomationStep = Schema.Union([
  Schema.TaggedStruct("Condition", {
    id: AutomationStepId,
    filter: AutomationConditionFilter,
  }),
  Schema.TaggedStruct("Wait", { id: AutomationStepId, wait: AutomationWait }),
  Schema.TaggedStruct("Send", { id: AutomationStepId }),
]).annotate({ identifier: "AutomationStep" });
export type AutomationStep = typeof AutomationStep.Type;

export const automationFlowMaxSteps = 20;

/**
 * One trigger and a single path of steps ending in exactly one send. Future
 * branches nest their own steps with their own ids, so runs, timelines and
 * receipts keep addressing steps by id.
 */
export const AutomationFlow = Schema.Struct({
  trigger: AutomationTrigger,
  steps: Schema.Array(AutomationStep),
})
  .check(
    Schema.makeFilter(
      ({ steps }) =>
        steps.length >= 1 && steps.length <= automationFlowMaxSteps,
      { description: `1–${automationFlowMaxSteps} steps.` }
    ),
    Schema.makeFilter(
      ({ steps }) =>
        steps.filter((step) => step._tag === "Send").length === 1 &&
        steps.at(-1)?._tag === "Send",
      { description: "Exactly one send step, and it is last." }
    ),
    Schema.makeFilter(
      ({ steps }) => new Set(steps.map(({ id }) => id)).size === steps.length,
      { description: "Step ids are unique." }
    )
  )
  .annotate({
    identifier: "AutomationFlow",
    description:
      "An automation's trigger and its steps: conditions and waits, ending in exactly one send.",
  });
export type AutomationFlow = typeof AutomationFlow.Type;
