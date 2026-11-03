import { test as base } from "@playwright/test";
import { withE2ERuntime } from "../runtime-fixture";
import {
  type AgentEvalEffectRunner,
  type AgentEvalSettings,
  makeAgentEvalRuntimeLive,
  makeAgentEvalSettings,
} from "./environment";

/** One eval runtime per Playwright worker, shared by the worker's tests. */
export const agentEvalTest = base.extend<
  Record<never, never>,
  {
    readonly agentEvalSettings: AgentEvalSettings;
    readonly runEffect: AgentEvalEffectRunner;
  }
>({
  agentEvalSettings: [
    async ({ browserName: _browserName }, use) => use(makeAgentEvalSettings()),
    { scope: "worker" },
  ],
  runEffect: [
    async ({ agentEvalSettings }, use) =>
      withE2ERuntime(
        { layer: makeAgentEvalRuntimeLive(agentEvalSettings.datasourceConfig) },
        use
      ),
    { scope: "worker" },
  ],
});
