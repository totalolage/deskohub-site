import { describe, expect, test } from "bun:test";
import {
  AutomationConditionFilter,
  type AutomationConditionFilter as AutomationConditionFilterType,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import type { AudienceFilter } from "../../../audience-filter";
import { describeAudienceFilter } from "../../audience-filter-summary";
import { automationFlowFixture } from "../activation/automation-detail.test-utils";
import { describeFailedConditions } from "./automation-condition-failures";

const locale: Locale = "en-US";
const wording = {
  audiences: new Map([["regulars", "Regulars"]]),
  lookups: {},
};

const decodeConditionFilter = Schema.decodeUnknownSync(
  AutomationConditionFilter
);

const conditionFlow = (filter: AutomationConditionFilterType) =>
  automationFlowFixture({
    steps: [
      { _tag: "Condition", id: "check", filter },
      { _tag: "Send", id: "send" },
    ],
  });

const conditionClause = (position: number) =>
  m.emailAutomationRunsConditionClause({ position }, { locale });

describe("describeFailedConditions", () => {
  test("describes a failed saved-audience inclusion from the fixture flow", () => {
    expect(
      describeFailedConditions({
        failedConditions: [0],
        flow: automationFlowFixture(),
        locale,
        stepId: "check",
        wording,
      })
    ).toEqual([
      m.emailAutomationRunsConditionInAudience(
        { audience: "Regulars" },
        { locale }
      ),
    ]);
  });

  test("uses the not-in catalog entry for a saved-audience exclusion", () => {
    const flow = conditionFlow(
      decodeConditionFilter({
        _tag: "InAudience",
        audienceId: "regulars",
        operator: "notIn",
      })
    );

    expect(
      describeFailedConditions({
        failedConditions: [0],
        flow,
        locale,
        stepId: "check",
        wording,
      })
    ).toEqual([
      m.emailAutomationRunsConditionNotInAudience(
        { audience: "Regulars" },
        { locale }
      ),
    ]);
  });

  test("uses the unknown-audience catalog entry when the id has no title", () => {
    const flow = conditionFlow(
      decodeConditionFilter({
        _tag: "InAudience",
        audienceId: "deleted-audience",
        operator: "in",
      })
    );

    expect(
      describeFailedConditions({
        failedConditions: [0],
        flow,
        locale,
        stepId: "check",
        wording,
      })
    ).toEqual([
      m.emailAutomationRunsConditionInAudience(
        {
          audience: m.emailAutomationRunsConditionAudienceUnknown(
            {},
            { locale }
          ),
        },
        { locale }
      ),
    ]);
  });

  test("uses the one-based clause position when an index is past the clauses", () => {
    expect(
      describeFailedConditions({
        failedConditions: [1],
        flow: automationFlowFixture(),
        locale,
        stepId: "check",
        wording,
      })
    ).toEqual([conditionClause(2)]);
  });

  test("uses a position for every index when the condition step is unavailable", () => {
    const flow = automationFlowFixture();
    const failedConditions = [0, 3];
    const expected = failedConditions.map((index) =>
      conditionClause(index + 1)
    );

    for (const [missingFlow, stepId] of [
      [flow, "pause"],
      [flow, "missing-step"],
      [null, "check"],
    ] as const) {
      expect(
        describeFailedConditions({
          failedConditions,
          flow: missingFlow,
          locale,
          stepId,
          wording,
        })
      ).toEqual(expected);
    }
  });

  test("describes plain audience conditions in failed-index order", () => {
    const first: AudienceFilter = {
      _tag: "Condition",
      attribute: "locale",
      operator: "anyOf",
      value: ["cs-CZ"],
    };
    const second: AudienceFilter = {
      _tag: "Condition",
      attribute: "locale",
      operator: "anyOf",
      value: ["en-US"],
    };
    const filter = decodeConditionFilter({
      _tag: "Group",
      operator: "and",
      filters: [first, second],
    });
    const expected = [second, first].map((clause) =>
      describeAudienceFilter(clause, locale, wording.lookups)
    );
    const actual = describeFailedConditions({
      failedConditions: [1, 0],
      flow: conditionFlow(filter),
      locale,
      stepId: "check",
      wording,
    });

    expect(actual).toEqual(expected);
    expect(actual).toHaveLength(2);
  });

  test("uses a position for a group with a nested saved-audience leaf", () => {
    const filter = decodeConditionFilter({
      _tag: "Group",
      operator: "and",
      filters: [
        {
          _tag: "Condition",
          attribute: "locale",
          operator: "anyOf",
          value: ["cs-CZ"],
        },
        {
          _tag: "Group",
          operator: "or",
          filters: [
            {
              _tag: "InAudience",
              audienceId: "regulars",
              operator: "in",
            },
          ],
        },
      ],
    });

    expect(
      describeFailedConditions({
        failedConditions: [1],
        flow: conditionFlow(filter),
        locale,
        stepId: "check",
        wording,
      })
    ).toEqual([conditionClause(2)]);
  });
});
