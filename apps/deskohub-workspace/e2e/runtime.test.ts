import { expect, test } from "bun:test";
import { formatRunnerCommand } from "./runtime";

test("redacts the sealed payState capability from realistic browser command logging", () => {
  const syntheticCapability = "synthetic-sealed-pay-state-capability";
  const command = formatRunnerCommand("agent-browser", [
    "--session",
    "synthetic-session",
    "open",
    `https://deskohub.example.test/en-US/checkout/pay?orderId=synthetic-order&payState=${syntheticCapability}`,
  ]);

  expect(command).toContain("payState=[redacted]");
  expect(command).not.toContain(syntheticCapability);
});
