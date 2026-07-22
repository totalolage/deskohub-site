import { formatWorkspaceE2EFailure } from "../e2e/errors";
import { workspaceE2E } from "../e2e/workspace-e2e";
import { runStandaloneWorkspaceEffect } from "../shared/backend/standalone-workspace-effect";

workspaceE2E
  .pipe(runStandaloneWorkspaceEffect("workspace.e2e"))
  .catch((error) => {
    process.stderr.write(`${formatWorkspaceE2EFailure(error)}\n`);
    process.exit(1);
  });
