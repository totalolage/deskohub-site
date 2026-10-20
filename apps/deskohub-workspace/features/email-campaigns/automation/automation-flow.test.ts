import { describe, expect, test } from "bun:test";
import {
  type AutomationConditionFilterType as AutomationConditionFilter,
  type AutomationDurationUnitType as AutomationDurationUnit,
  type AutomationFlowType as AutomationFlow,
  type AutomationStepType as AutomationStep,
  AutomationStepId,
  type AutomationTriggerType as AutomationTrigger,
  type CalendarExpressionType as CalendarExpression,
  type CampaignEmailSourceType,
} from "@deskohub/workspace-admin-api";
import { Effect, Result, Schema } from "effect";
import {
  type AudienceCondition,
  audienceFilterSchema,
} from "../audience-filter";
import { ensureSavedAudienceFilter } from "../audience-filter-usage";
import {
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../campaign-identifiers";
import { AudienceFilterContextInvalid } from "../errors";
import {
  automationFlowReferences,
  automationFlowSchema,
  canonicalAutomationFlow,
  validateAutomationFlow,
} from "./automation-flow";
import {
  AutomationCalendarNeverOccurs,
  AutomationFlowInvalid,
  AutomationScheduleMinutesNotAllowed,
} from "./errors";

const send: AutomationStep = {
  _tag: "Send",
  id: AutomationStepId.make("send"),
};

const flowOf = (
  steps: readonly AutomationStep[],
  trigger: AutomationTrigger = { _tag: "AccountCreated" }
): AutomationFlow => ({ trigger, steps: [...steps, send] });

const condition = (
  id: string,
  filter: AutomationConditionFilter
): AutomationStep => ({
  _tag: "Condition",
  id: AutomationStepId.make(id),
  filter,
});

const durationWait = (
  count: number,
  unit: AutomationDurationUnit
): AutomationStep => ({
  _tag: "Wait",
  id: AutomationStepId.make("wait"),
  wait: { _tag: "Duration", count, unit },
});

const calendarWait = (expression: CalendarExpression): AutomationStep => ({
  _tag: "Wait",
  id: AutomationStepId.make("wait"),
  wait: { _tag: "Calendar", expression },
});

const group = (
  operator: "and" | "or",
  filters: readonly AutomationConditionFilter[]
): AutomationConditionFilter => ({
  _tag: "Group",
  operator,
  filters: [...filters],
});

const bookedWithinTriggerWindow: AudienceCondition = {
  attribute: "reservationCount",
  _tag: "Condition",
  params: {
    dateBasis: "booking",
    period: { _tag: "TriggerWindow", side: "after", count: 2, unit: "week" },
  },
  operator: "eq",
  value: 0,
};

const campaignEmails = (
  campaign: CampaignEmailSourceType
): AudienceCondition => ({
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: { purpose: "any", period: { _tag: "AnyTime" }, campaign },
  operator: "eq",
  value: 0,
});

const regulars = campaignAudienceIdSchema.make("regulars");
const lapsed = campaignAudienceIdSchema.make("lapsed");
const springCampaign = campaignIdSchema.make("spring-campaign");
const autumnCampaign = campaignIdSchema.make("autumn-campaign");

const inAudience = (
  audienceId: typeof regulars,
  operator: "in" | "notIn" = "in"
): AutomationConditionFilter => ({ _tag: "InAudience", audienceId, operator });

const neverOccurs: CalendarExpression = { daysOfMonth: [31], months: [2] };

const validate = (flow: AutomationFlow) =>
  Effect.runPromise(Effect.result(validateAutomationFlow(flow)));

const failureOf = async (flow: AutomationFlow) => {
  const result = await validate(flow);
  if (Result.isSuccess(result)) {
    throw new Error("Expected the flow to fail validation.");
  }
  return result.failure;
};

describe("automationFlowSchema product filters", () => {
  const decode = Schema.decodeUnknownResult(automationFlowSchema);
  const knownProduct = {
    family: "cowork",
    properties: [
      { property: "tier", operator: "anyOf", value: ["reserved-desk"] },
    ],
  };
  /** A property of another family: the contract allows it, the catalog doesn't. */
  const unknownProperty = {
    family: "cowork",
    properties: [{ property: "seats", operator: "gte", value: 1 }],
  };
  const unknownFamily = { family: "garden", properties: [] };
  /** A product filter as untrusted input: any family, any property shape. */
  type ProductInput = {
    readonly family: string;
    readonly properties: readonly object[];
  };
  const withTriggerProduct = (product: ProductInput) => ({
    trigger: { _tag: "ReservationBooked", product },
    steps: [send],
  });
  const withConditionProduct = (product: ProductInput) => ({
    trigger: { _tag: "AccountCreated" },
    steps: [
      {
        _tag: "Condition",
        id: "visited",
        filter: {
          _tag: "Group",
          operator: "or",
          filters: [
            inAudience(regulars),
            {
              attribute: "lastVisit",
              _tag: "Condition",
              params: { product },
              operator: "none",
            },
          ],
        },
      },
      send,
    ],
  });

  test.each([
    ["a trigger", withTriggerProduct],
    ["a condition", withConditionProduct],
  ])("accepts a known family's catalog property on %s", (_, flowWith) => {
    expect(Result.isSuccess(decode(flowWith(knownProduct)))).toBe(true);
  });

  test.each([
    ["a trigger", "an unknown property", withTriggerProduct, unknownProperty],
    ["a trigger", "an unknown family", withTriggerProduct, unknownFamily],
    [
      "a condition",
      "an unknown property",
      withConditionProduct,
      unknownProperty,
    ],
    ["a condition", "an unknown family", withConditionProduct, unknownFamily],
  ])("rejects %s with %s", (_, __, flowWith, product) => {
    expect(Result.isFailure(decode(flowWith(product)))).toBe(true);
  });

  test("validation reports a schema failure as flow-invalid", async () => {
    const failure = await failureOf(
      flowOf([], {
        _tag: "ReservationBooked",
        product: {
          family: "cowork",
          properties: [{ property: "seats", operator: "gte", value: 1 }],
        },
      })
    );
    expect(failure).toBeInstanceOf(AutomationFlowInvalid);
    expect(AutomationFlowInvalid.code).toBe("flow-invalid");
  });
});

describe("validateAutomationFlow waits", () => {
  test.each([
    ["minute", 9999],
    ["hour", 366 * 24],
    ["day", 366],
    ["week", 52],
    ["month", 12],
  ] as const)("accepts %s waits up to %i", async (unit, count) => {
    expect(
      Result.isSuccess(await validate(flowOf([durationWait(count, unit)])))
    ).toBe(true);
  });

  test.each([
    ["hour", 366 * 24 + 1],
    ["day", 367],
    ["week", 53],
    ["month", 13],
  ] as const)(
    "rejects %s waits of %i, longer than 366 days",
    async (unit, count) => {
      const failure = await failureOf(flowOf([durationWait(count, unit)]));
      expect(failure).toBeInstanceOf(AutomationFlowInvalid);
      expect(failure).toMatchObject({
        location: { _tag: "Step", stepId: "wait" },
      });
    }
  );
});

describe("validateAutomationFlow calendars", () => {
  test("rejects a schedule that never occurs", async () => {
    const failure = await failureOf(
      flowOf([], { _tag: "Schedule", calendar: neverOccurs })
    );
    expect(failure).toBeInstanceOf(AutomationCalendarNeverOccurs);
    expect(failure).toMatchObject({ location: { _tag: "Trigger" } });
    expect(AutomationCalendarNeverOccurs.code).toBe("calendar-never-occurs");
  });

  test("rejects a calendar wait that never occurs", async () => {
    const failure = await failureOf(flowOf([calendarWait(neverOccurs)]));
    expect(failure).toBeInstanceOf(AutomationCalendarNeverOccurs);
    expect(failure).toMatchObject({
      location: { _tag: "Step", stepId: "wait" },
    });
  });

  test("returns the flow with its calendars in canonical order", async () => {
    const flow = flowOf(
      [calendarWait({ hours: [18, 9], weekdays: ["friday", "monday"] })],
      {
        _tag: "Schedule",
        calendar: { minutes: [30, 0], months: [12, 1] },
      }
    );
    const result = await validate(flow);
    expect(Result.getOrThrow(result)).toEqual(canonicalAutomationFlow(flow));
    expect(canonicalAutomationFlow(flow)).toEqual(
      flowOf(
        [calendarWait({ hours: [9, 18], weekdays: ["monday", "friday"] })],
        {
          _tag: "Schedule",
          calendar: { minutes: [0, 30], months: [1, 12] },
        }
      )
    );
  });
});

describe("validateAutomationFlow schedule minutes", () => {
  const schedule = (calendar: CalendarExpression): AutomationTrigger => ({
    _tag: "Schedule",
    calendar,
  });

  test.each([
    ["on the hour", { hours: [9] }],
    ["at :00", { minutes: [0] }],
    ["at :15", { minutes: [15] }],
    ["at :30", { minutes: [30] }],
    ["at :45", { minutes: [45] }],
    ["at every tick", { minutes: [45, 0, 30, 15] }],
  ] as const)("accepts a schedule that fires %s", async (_, calendar) => {
    expect(
      Result.isSuccess(await validate(flowOf([], schedule(calendar))))
    ).toBe(true);
  });

  test("rejects a schedule that fires at :07 with a stable code", async () => {
    const failure = await failureOf(flowOf([], schedule({ minutes: [7] })));
    expect(failure).toBeInstanceOf(AutomationScheduleMinutesNotAllowed);
    expect(failure).toMatchObject({ minutes: [7] });
    expect(AutomationScheduleMinutesNotAllowed.code).toBe(
      "schedule-minutes-not-allowed"
    );
  });

  test("names every off-tick minute, ascending", async () => {
    const failure = await failureOf(
      flowOf([], schedule({ minutes: [50, 0, 7, 30] }))
    );
    expect(failure).toMatchObject({ minutes: [7, 50] });
  });

  test("lets a calendar wait use any minute", async () => {
    expect(
      Result.isSuccess(
        await validate(flowOf([calendarWait({ minutes: [7, 52] })]))
      )
    ).toBe(true);
  });
});

describe("audience filter context", () => {
  const contextConditions = [
    ["a trigger window", bookedWithinTriggerWindow],
    ["this campaign", campaignEmails({ _tag: "This" })],
  ] as const;

  test.each(contextConditions)(
    "condition steps accept %s",
    async (_, filter) => {
      expect(
        Result.isSuccess(await validate(flowOf([condition("check", filter)])))
      ).toBe(true);
    }
  );

  test("condition steps accept a saved audience", async () => {
    const filter = group("and", [
      inAudience(regulars),
      inAudience(lapsed, "notIn"),
    ]);
    expect(
      Result.isSuccess(await validate(flowOf([condition("check", filter)])))
    ).toBe(true);
  });

  test.each(contextConditions)(
    "the entry audience, a saved audience, rejects %s",
    async (_, filter) => {
      const result = await Effect.runPromise(
        Effect.result(ensureSavedAudienceFilter(filter))
      );
      expect(Result.isFailure(result)).toBe(true);
      expect(AudienceFilterContextInvalid.code).toBe("audience-filter-context");
    }
  );

  // A saved audience can't hold a saved-audience leaf, so an `InAudience`
  // condition never reaches a nested one. Whether the referenced audience
  // exists is the activation's database check over the flow's references.
  test("the entry audience, a saved audience, rejects a saved audience", () => {
    const decode = Schema.decodeUnknownResult(audienceFilterSchema);
    expect(Result.isFailure(decode(inAudience(regulars)))).toBe(true);
    expect(
      Result.isFailure(
        decode({
          _tag: "Group",
          operator: "and",
          filters: [inAudience(regulars)],
        })
      )
    ).toBe(true);
  });
});

describe("automationFlowReferences", () => {
  test("lists each saved audience and specific campaign the conditions name once", () => {
    const flow = flowOf([
      condition(
        "first",
        group("or", [
          inAudience(regulars),
          group("and", [
            inAudience(lapsed, "notIn"),
            campaignEmails({ _tag: "Specific", campaignId: springCampaign }),
          ]),
        ])
      ),
      durationWait(2, "day"),
      condition(
        "second",
        group("and", [
          inAudience(regulars, "notIn"),
          campaignEmails({ _tag: "This" }),
          campaignEmails({ _tag: "Specific", campaignId: autumnCampaign }),
          campaignEmails({ _tag: "Specific", campaignId: springCampaign }),
        ])
      ),
    ]);
    const references = automationFlowReferences(flow);
    expect([...references.savedAudienceIds].sort()).toEqual([lapsed, regulars]);
    expect([...references.campaignIds].sort()).toEqual([
      autumnCampaign,
      springCampaign,
    ]);
  });

  test("a lone saved-audience condition names only its audience", () => {
    expect(
      automationFlowReferences(flowOf([condition("check", inAudience(lapsed))]))
    ).toEqual({
      savedAudienceIds: [lapsed],
      campaignIds: [],
    });
  });

  test("a flow without conditions names nothing", () => {
    expect(automationFlowReferences(flowOf([durationWait(1, "day")]))).toEqual({
      savedAudienceIds: [],
      campaignIds: [],
    });
  });
});
