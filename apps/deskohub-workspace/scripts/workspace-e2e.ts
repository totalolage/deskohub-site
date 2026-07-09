import { Cause, Effect, Exit } from "effect";
import { formatWorkspaceE2EFailure } from "../e2e/errors";
import { workspaceE2E } from "../e2e/workspace-e2e";

Effect.runPromiseExit(workspaceE2E)
  .then((exit) => {
    if (!Exit.isFailure(exit)) return;

    process.stderr.write(
      `${formatWorkspaceE2EFailure(Cause.squash(exit.cause))}\n`
    );
    process.exit(1);
  })
  .catch((error) => {
    process.stderr.write(`${formatWorkspaceE2EFailure(error)}\n`);
    process.exit(1);
  });
