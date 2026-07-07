import { redact } from "../e2e/runtime";
import { runWorkspaceE2E } from "../e2e/workspace-e2e";

runWorkspaceE2E().catch((error) => {
  process.stderr.write(
    `${redact(error instanceof Error ? (error.stack ?? error.message) : String(error))}\n`
  );
  process.exit(1);
});
