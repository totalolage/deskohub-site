import { Layer } from "effect";
import { AutomationDryRun } from "../automation/backend/automation-dry-run.service";
import { AutomationEngineHealth } from "../automation/backend/automation-engine-health.service";
import { AutomationLifecycle } from "../automation/backend/automation-lifecycle.service";
import { AutomationRunLog } from "../automation/backend/automation-run-log.service";

export type AutomationServiceStubs = {
  readonly lifecycle?: Partial<AutomationLifecycle["Service"]>;
  readonly dryRuns?: Partial<AutomationDryRun["Service"]>;
  readonly runLog?: Partial<AutomationRunLog["Service"]>;
  readonly engineHealth?: Partial<AutomationEngineHealth["Service"]>;
};

/**
 * The automation services `CampaignOperations` composes, stubbed: an
 * operation a test doesn't stub dies if it's called.
 */
export const automationServiceStubs = (stubs: AutomationServiceStubs = {}) =>
  Layer.mergeAll(
    Layer.mock(AutomationLifecycle, stubs.lifecycle ?? {}),
    Layer.mock(AutomationDryRun, stubs.dryRuns ?? {}),
    Layer.mock(AutomationRunLog, stubs.runLog ?? {}),
    Layer.mock(AutomationEngineHealth, stubs.engineHealth ?? {})
  );
