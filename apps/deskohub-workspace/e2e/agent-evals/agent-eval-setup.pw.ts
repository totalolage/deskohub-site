import "../../shared/polyfills/temporal";

import { test } from "@playwright/test";
import { makeAgentEvalRuntime, makeAgentEvalSettings } from "./environment";
import {
  makeAgentEvalRunSetId,
  readAgentEvalRunSet,
  writeAgentEvalRunSet,
} from "./run-set";
import { verifyAgentEvalTarget } from "./target";

// Agents book and pay, so the run set starts only after Vercel confirms the
// target is a ready Workspace preview built from TARGET_SHA, and every run
// checks the verified target before it seeds anything. The run set id is
// written once per invocation: `--repeat-each` repeats this project too, and
// every repeat must keep the first id.
test("verify the preview target and open a run set", async () => {
  const settings = makeAgentEvalSettings();
  const runtime = makeAgentEvalRuntime(settings.datasourceConfig);
  const target = await runtime
    .runPromise(
      verifyAgentEvalTarget({
        expectation: {
          sha: settings.targetSha,
          vercelProjectId: settings.vercelProjectId,
        },
        expectedHost: settings.config.expectedHost,
        vercelToken: settings.vercelToken,
      })
    )
    .finally(() => runtime.dispose());
  const existing = await readAgentEvalRunSet().catch(() => undefined);
  if (existing?.target.sha === target.sha) return;
  await writeAgentEvalRunSet({
    runSetId: makeAgentEvalRunSetId(),
    startedAt: new Date().toISOString(),
    target,
  });
});
