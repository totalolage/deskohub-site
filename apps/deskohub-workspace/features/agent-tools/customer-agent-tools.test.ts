import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { publishedCustomerAgentTools } from "./customer-agent-tools";

test("publishes no administration tool to customers' agents", () => {
  for (const tool of publishedCustomerAgentTools) {
    expect(tool.access).not.toBe("administration");
    expect(tool.name.startsWith("admin_")).toBe(false);
  }
});
