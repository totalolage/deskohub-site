import { workspaceE2EPaymentCaseLanes } from "./case-catalog";
import { registerWorkspaceE2ECases, test } from "./fixtures";

test.describe("workspace checkout payment lane 3", () => {
  registerWorkspaceE2ECases(workspaceE2EPaymentCaseLanes[2], { serial: true });
});
