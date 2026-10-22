import { expect, test } from "bun:test";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import {
  automationJourneyTitlePrefix,
  planAutomationJourney,
} from "./automation-journey-plan";

const runId = workspaceE2ERunIdSchema.make("20261022180000-ab12");
const otherRunId = workspaceE2ERunIdSchema.make("20261022180000-cd34");

test("scopes every created title to the run, so suite cleanup finds only its own rows", () => {
  const plan = planAutomationJourney(runId);
  const prefix = automationJourneyTitlePrefix(runId);

  expect(plan.campaignTitle.startsWith(prefix)).toBe(true);
  expect(plan.audienceTitle.startsWith(prefix)).toBe(true);
  expect(
    plan.campaignTitle.startsWith(automationJourneyTitlePrefix(otherRunId))
  ).toBe(false);
});

test("gives each journey its own customer tag", () => {
  expect(planAutomationJourney(runId).customerTag).not.toBe(
    planAutomationJourney(runId).customerTag
  );
});
