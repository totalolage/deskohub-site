import { randomUUID } from "node:crypto";
import type { WorkspaceE2ERunId } from "../run-identifiers";

/**
 * Every title the journey creates starts with this run-scoped prefix, so the
 * suite cleanup can find a crashed run's rows and never another run's.
 */
export const automationJourneyTitlePrefix = (runId: WorkspaceE2ERunId) =>
  `Workspace E2E automation ${runId} `;

/**
 * One run's automation journey. The tag is unique to the run, so the
 * audience gate and the condition step admit only this case's own synthetic
 * customer, whatever other checkout cases book while the automation is
 * active.
 */
export interface AutomationJourneyPlan {
  readonly audienceTitle: string;
  readonly body: string;
  readonly campaignTitle: string;
  readonly customerTag: string;
  readonly subject: string;
}

export const planAutomationJourney = (
  runId: WorkspaceE2ERunId,
  key: string = randomUUID().replaceAll("-", "").slice(0, 16)
): AutomationJourneyPlan => {
  const prefix = automationJourneyTitlePrefix(runId);
  return {
    audienceTitle: `${prefix}${key} audience`,
    body: `Synthetic Workspace E2E automation body ${key}.`,
    campaignTitle: `${prefix}${key} campaign`,
    customerTag: `e2e-automation-${key}`,
    subject: `Workspace E2E automation ${key}`,
  };
};
