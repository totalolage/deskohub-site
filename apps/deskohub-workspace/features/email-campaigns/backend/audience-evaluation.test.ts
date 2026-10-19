import { describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Option } from "effect";
import {
  type AudienceCandidate,
  type AudienceCondition,
  type AudienceFacts,
  audienceFactKey,
  collectAudienceFactRequests,
} from "../audience-filter";
import { campaignIdSchema } from "../campaign-identifiers";
import { evaluateAudienceFilter } from "./audience-evaluation";
import {
  type AudienceEvaluationContext,
  audienceEvaluationAt,
} from "./audience-evaluation-context";

const now = Temporal.Instant.from("2026-10-15T10:00:00Z");

const candidate = (id: string): AudienceCandidate => ({
  dotyposCustomerId: DotyposCustomerIdSchema.make(id),
  locale: "cs-CZ",
  hasAccount: false,
});
const early = candidate("early");
const late = candidate("late");

const triggeredAt = (
  at: string,
  campaign = "campaign-1"
): AudienceEvaluationContext => ({
  ...audienceEvaluationAt(now),
  campaignId: Option.some(campaignIdSchema.make(campaign)),
  trigger: Option.some({
    kind: "schedule",
    at: Temporal.Instant.from(at),
    reservationId: Option.none(),
  }),
});

/** Visits in the week after the trigger. */
const visitedAfterTrigger = {
  attribute: "reservationCount",
  _tag: "Condition",
  params: {
    dateBasis: "visit",
    period: { _tag: "TriggerWindow", side: "after", count: 1, unit: "week" },
  },
  operator: "gt",
  value: 0,
} as const satisfies AudienceCondition;

/** No email from the evaluating campaign yet. */
const notMailedByThisCampaign = {
  attribute: "campaignEmailCount",
  _tag: "Condition",
  params: {
    purpose: "any",
    period: { _tag: "AnyTime" },
    campaign: { _tag: "This" },
  },
  operator: "eq",
  value: 0,
} as const satisfies AudienceCondition;

/**
 * Facts as a resolution would return them: one count per request, holding
 * the counts `byRequest` gives in request order.
 */
const factsFor = (
  condition: AudienceCondition,
  contexts: readonly AudienceEvaluationContext[],
  byRequest: readonly (readonly [AudienceCandidate, number][])[]
): AudienceFacts => ({
  counts: new Map(
    collectAudienceFactRequests(condition, contexts).counts.map(
      (request, index) => [
        audienceFactKey(request),
        new Map(
          (byRequest[index] ?? []).map(([{ dotyposCustomerId }, count]) => [
            dotyposCustomerId,
            count,
          ])
        ),
      ]
    )
  ),
  dates: new Map(),
});

const evaluate = (
  filter: AudienceCondition,
  subject: AudienceCandidate,
  context: AudienceEvaluationContext,
  facts: AudienceFacts
) =>
  evaluateAudienceFilter({
    filter,
    candidate: subject,
    context,
    facts,
    profile: Option.none(),
  });

describe("evaluateAudienceFilter with per-subject contexts", () => {
  test("reads each subject's facts for its own trigger", () => {
    const earlyTrigger = triggeredAt("2026-10-01T08:00:00Z");
    const lateTrigger = triggeredAt("2026-10-08T08:00:00Z");
    // The early subject visited in the week after its own trigger only.
    const facts = factsFor(
      visitedAfterTrigger,
      [earlyTrigger, lateTrigger],
      [[[early, 1]], [[late, 1]]]
    );

    expect(evaluate(visitedAfterTrigger, early, earlyTrigger, facts)).toBe(
      "match"
    );
    expect(evaluate(visitedAfterTrigger, late, lateTrigger, facts)).toBe(
      "match"
    );
    // The same subject in another subject's window reads that window's facts.
    expect(evaluate(visitedAfterTrigger, early, lateTrigger, facts)).toBe(
      "noMatch"
    );
  });

  test("shares one fact between subjects whose bounds agree", () => {
    const first = triggeredAt("2026-10-01T08:00:00Z");
    const second = triggeredAt("2026-10-01T08:00:00Z");
    const facts = factsFor(
      visitedAfterTrigger,
      [first, second],
      [
        [
          [early, 1],
          [late, 1],
        ],
      ]
    );
    expect(facts.counts.size).toBe(1);
    expect(evaluate(visitedAfterTrigger, early, first, facts)).toBe("match");
    expect(evaluate(visitedAfterTrigger, late, second, facts)).toBe("match");
  });

  test("reads this campaign's emails for each subject's own campaign", () => {
    const fromFirst = triggeredAt("2026-10-01T08:00:00Z", "campaign-1");
    const fromSecond = triggeredAt("2026-10-01T08:00:00Z", "campaign-2");
    // The early subject got campaign 1's email, not campaign 2's.
    const facts = factsFor(
      notMailedByThisCampaign,
      [fromFirst, fromSecond],
      [[[early, 1]], []]
    );
    expect(evaluate(notMailedByThisCampaign, early, fromFirst, facts)).toBe(
      "noMatch"
    );
    expect(evaluate(notMailedByThisCampaign, early, fromSecond, facts)).toBe(
      "match"
    );
  });
});
