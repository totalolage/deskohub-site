import { setDefaultTimeout, test } from "bun:test";
import { runWorkspaceE2ESchedulingRegression } from "./e2e-scheduling/harness";

setDefaultTimeout(90_000);

test("proves the Workspace E2E dependency phases with the real Playwright scheduler", async () => {
  await runWorkspaceE2ESchedulingRegression();
});
