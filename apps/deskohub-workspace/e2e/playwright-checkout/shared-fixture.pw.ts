import { workspaceE2ESharedFixtureCaseIds } from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace checkout shared fixture", () => {
  registerWorkspaceE2ECases(workspaceE2ESharedFixtureCaseIds, {
    serial: true,
  });
});
