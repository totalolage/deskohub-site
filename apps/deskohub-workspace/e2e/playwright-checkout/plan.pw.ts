import { expect } from "@playwright/test";
import { Effect } from "effect";
import { getConfig, getDatasourceConfig } from "../config";
import type { Runner } from "../runtime";
import { WorkspaceE2ECaseService } from "../services/cases";
import { workspaceE2ECaseIds } from "./case-catalog";
import {
  readWorkspaceE2EPreparation,
  writeWorkspaceE2ERunPlan,
} from "./run-plan";
import { runtimeTest as test } from "./runtime-fixtures";

test("build the workspace checkout case plan", async ({
  environment,
  runContext,
  runEffect,
}) => {
  const config = getConfig(environment);
  const datasourceConfig = getDatasourceConfig(environment);
  const preparation = await readWorkspaceE2EPreparation();
  const run: Runner = async () => ({
    exitCode: 0,
    stderr: "",
    stdout: "",
  });
  const actualCaseIds = await runEffect(
    Effect.gen(function* () {
      const caseService = yield* WorkspaceE2ECaseService;
      const cases = yield* caseService.makeCases({
        allocation: runContext.allocation,
        config,
        datasourceConfig,
        flowStates: [],
        preparation,
        run,
      });
      return cases.map(({ id }) => id).toSorted();
    })
  );

  expect(actualCaseIds).toEqual([...workspaceE2ECaseIds].toSorted());
  await writeWorkspaceE2ERunPlan({ preparation, runContext, version: 1 });
});
