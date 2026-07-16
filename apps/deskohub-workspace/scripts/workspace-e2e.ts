import { formatWorkspaceE2EFailure } from "../e2e/errors";
import { workspaceE2E } from "../e2e/workspace-e2e";
import { runWorkspaceEffect } from "../shared/backend/logging/censorship";

runWorkspaceEffect(workspaceE2E).catch((error) => {
  process.stderr.write(`${formatWorkspaceE2EFailure(error)}\n`);
  process.exit(1);
});
