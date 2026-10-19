import "../../shared/polyfills/temporal";

import { test as base } from "@playwright/test";
import { locales } from "@/features/i18n";
import { workspaceAgentEvalPlaywrightTimeout } from "../timeouts";
import {
  type AgentEvalRuntime,
  makeAgentEvalRuntime,
  makeAgentEvalSettings,
} from "./environment";
import { agentEvalTaskBudgetMs, runAgentEvalCase } from "./run";
import { type AgentEvalRunSet, readAgentEvalRunSet } from "./run-set";
import { agentEvalTaskIds } from "./tasks";

const settings = makeAgentEvalSettings();

const test = base.extend<
  Record<never, never>,
  {
    readonly agentEvalRuntime: AgentEvalRuntime;
    readonly runSet: AgentEvalRunSet;
  }
>({
  agentEvalRuntime: [
    async ({ browserName: _browserName }, use) => {
      const runtime = makeAgentEvalRuntime(settings.datasourceConfig);
      try {
        await use(runtime);
      } finally {
        await runtime.dispose();
      }
    },
    { scope: "worker" },
  ],
  runSet: [
    async ({ browserName: _browserName }, use) =>
      use(await readAgentEvalRunSet()),
    { scope: "worker" },
  ],
});

// One test per task, locale, and harness; the config's repeatEach runs each
// of them several times. A failed eval is a result, not a test failure: only
// preparation, the harness spawn boundary, or cleanup errors fail a test.
for (const taskId of agentEvalTaskIds) {
  for (const locale of locales) {
    for (const harness of settings.harnesses) {
      test(`${taskId} ${locale} ${harness.id}`, async ({
        agentEvalRuntime,
        headless,
        launchOptions,
        runSet,
      }, testInfo) => {
        test.setTimeout(
          workspaceAgentEvalPlaywrightTimeout(agentEvalTaskBudgetMs(taskId))
        );
        const result = await runAgentEvalCase({
          harness,
          headless,
          lane: {
            lane: testInfo.parallelIndex,
            lanes: testInfo.config.workers,
          },
          launchOptions,
          locale,
          outputDir: testInfo.outputDir,
          repeat: testInfo.repeatEachIndex,
          runSet,
          runtime: agentEvalRuntime,
          settings,
          taskId,
        });
        testInfo.annotations.push({
          description: result.success
            ? "passed"
            : `failed: ${result.reason} (${result.failureCategory})`,
          type: "agent eval",
        });
      });
    }
  }
}
