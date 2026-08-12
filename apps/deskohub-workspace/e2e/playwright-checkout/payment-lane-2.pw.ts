import { workspaceE2EPaymentCaseLanes } from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace checkout payment lane 2", () => {
  registerWorkspaceE2ECases(workspaceE2EPaymentCaseLanes[1], { serial: true });
});
