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
// target is a ready Workspace preview. The run set id is written once per
// invocation: `--repeat-each` repeats this project too, and every repeat
// must keep the first id.
test("verify the preview target and open a run set", async () => {
  const settings = makeAgentEvalSettings();
  const runtime = makeAgentEvalRuntime(settings.datasourceConfig);
  try {
    await runtime.runPromise(
      verifyAgentEvalTarget({
        expectation: {
          vercelProjectId: settings.vercelProjectId,
          ...(settings.environment.TARGET_SHA === undefined
            ? {}
            : { sha: settings.environment.TARGET_SHA }),
        },
        expectedHost: settings.config.expectedHost,
        vercelToken: settings.vercelToken,
      })
    );
  } finally {
    await runtime.dispose();
  }
  const existing = await readAgentEvalRunSet().catch(() => undefined);
  if (existing) return;
  await writeAgentEvalRunSet({
    runSetId: makeAgentEvalRunSetId(),
    startedAt: new Date().toISOString(),
  });
});
