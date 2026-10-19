import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { makeAudienceFilterSchemas } from "@deskohub/workspace-admin-api";
import { Effect, Result, Schema } from "effect";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { describeCountCondition } from "./admin/audience-filter-summary";
import type { AudienceCountWording } from "./admin/audiences/audience-attribute-wording";
import { newConditionFrom } from "./admin/audiences/audience-filter-editing";
import {
  extendedCatalogue,
  extendedResolvers,
  giftCardCount,
} from "./audience-attribute-extension.typecheck";
import { audienceFactKey, countFactRequest } from "./audience-filter";
import type { AudienceResolution } from "./backend/audience-attribute-resolvers";
import { audienceEvaluationAt } from "./backend/audience-evaluation-context";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { cleanup, render } = await import("@testing-library/react");
const { CountConditionControls } = await import(
  "./admin/audiences/audience-condition-controls"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const { filter: extendedFilter } = makeAudienceFilterSchemas(extendedCatalogue);
const condition = newConditionFrom(giftCardCount);

/** The Admin UI words an added attribute brings with its entry. */
const giftCardCountWording: AudienceCountWording = {
  kind: "count",
  label: "Gift cards bought",
  lead: [{ text: "gift cards bought" }],
  choices: {},
  period: "Gift cards",
  count: "Gift card count",
  summary: {
    noun: (_params, count) => (count === 1 ? "gift card" : "gift cards"),
    period: (_params, period) => period,
    none: ({ none, period }) => `bought no ${none}${period}`,
    any: ({ none, period }) => `bought any ${none}${period}`,
    amount: (amount, period) => `bought ${amount}${period}`,
  },
};

describe("a count attribute added as one catalogue entry and its resolver", () => {
  test("defaults to its entry's condition, which the wire schema decodes", () => {
    expect(condition).toEqual({
      attribute: "giftCardCount",
      _tag: "Condition",
      params: { period: { _tag: "Last", count: 30, unit: "day" } },
      operator: "gte",
      value: 2,
    });
    expect(
      JSON.stringify(
        Schema.encodeSync(extendedFilter)(
          Schema.decodeUnknownSync(extendedFilter)(condition)
        )
      )
    ).toBe(
      '{"attribute":"giftCardCount","_tag":"Condition","params":{"period":{"_tag":"Last","count":30,"unit":"day"}},"operator":"gte","value":2}'
    );
    expect(
      Result.isFailure(
        Schema.decodeUnknownResult(extendedFilter)({
          ...condition,
          operator: "lt",
          value: 0,
        })
      )
    ).toBe(true);
  });

  test("reads in the summary from its wording", () => {
    expect(
      describeCountCondition(condition, giftCardCountWording, "en-US")
    ).toBe("bought at least 2 gift cards in the last 30 days");
    expect(
      describeCountCondition(
        { ...condition, operator: "eq", value: 0 },
        giftCardCountWording,
        "en-US"
      )
    ).toBe("bought no gift cards in the last 30 days");
  });

  test("resolves its counts through its resolver", async () => {
    const request = countFactRequest(
      giftCardCount,
      condition,
      audienceEvaluationAt(Temporal.Now.instant())
    );
    expect(audienceFactKey(request)).toContain('"giftCardCount"');
    const counts = await Effect.runPromise(
      extendedResolvers.giftCardCount.count(request, {} as AudienceResolution)
    );
    expect([...counts.values()]).toEqual([3]);
  });

  test("edits with the shared count controls, worded by its wording", () => {
    const view = render(
      <CountConditionControls
        entry={giftCardCount}
        wording={giftCardCountWording}
        value={condition}
        onChange={() => undefined}
        errorAt={() => undefined}
      />
    );
    expect(view.container.textContent).toContain("Number of");
    expect(view.container.textContent).toContain("gift cards bought");
    expect(
      view.getByRole("combobox", { name: "Gift card count comparison" })
    ).toBeDefined();
    expect(
      view.getByRole("spinbutton", { name: "Gift card count" })
    ).toBeDefined();
  });
});
