import { workspaceE2EPaymentCaseLanes } from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace checkout payment lane 1", () => {
  registerWorkspaceE2ECases(workspaceE2EPaymentCaseLanes[0], { serial: true });
});
