import "../../shared/polyfills/temporal";

import { Cause, Effect, Exit } from "effect";
import { log } from "../runtime";
import { agentEvalTest as test } from "./fixtures";
import {
  formatAgentEvalSummaryMarkdown,
  summarizeAgentEvalResults,
} from "./results";
import { reconcileAgentEvalRun } from "./run";
import {
  listAgentEvalJournalOwners,
  readAgentEvalRunResults,
  readAgentEvalRunSet,
  writeAgentEvalSummary,
} from "./run-set";

// Teardown of the setup project: runs after every eval, passed or failed.
// Each run cleans up after itself; this repeats the idempotent cleanup for
// runs that were interrupted, then writes the run set's results table.
test("reconcile run accounts and summarize results", async ({
  agentEvalSettings: settings,
  runEffect,
}) => {
  const runSet = await readAgentEvalRunSet().catch(() => undefined);
  if (!runSet) return;
  const failures: unknown[] = [];
  for (const ownerId of await listAgentEvalJournalOwners(runSet.runSetId)) {
    const exit = await runEffect(
      Effect.exit(
        reconcileAgentEvalRun(
          settings.datasourceConfig,
          runSet.runSetId,
          ownerId
        )
      )
    );
    if (Exit.isFailure(exit)) failures.push(Cause.squash(exit.cause));
  }

  const summary = summarizeAgentEvalResults(
    runSet,
    await readAgentEvalRunResults(runSet.runSetId)
  );
  const markdownPath = await writeAgentEvalSummary(summary);
  log(formatAgentEvalSummaryMarkdown(summary));
  log(`Agent eval results: ${markdownPath}`);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `${failures.length} agent eval runs could not be cleaned up`
    );
  }
});
