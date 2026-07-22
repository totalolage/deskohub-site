import { formatWorkspaceE2EFailure } from "../e2e/errors";
import { workspaceE2E } from "../e2e/workspace-e2e";
import { StandaloneWorkspaceEffect } from "../shared/backend/effect-boundary/standalone";

StandaloneWorkspaceEffect.run(
  { operation: "workspace.e2e" },
  workspaceE2E
).catch((error) => {
  process.stderr.write(`${formatWorkspaceE2EFailure(error)}\n`);
  process.exit(1);
});
