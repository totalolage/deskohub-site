import { expect, test } from "bun:test";
import { formatWorkspaceE2EFailure } from "./errors";
import { formatRunnerCommand, redact } from "./runtime";

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

test.each([
  [
    "encoded key",
    "https://deskohub.example.test/en-US/checkout/pay?pay%53tate=synthetic-encoded-key-capability",
    "synthetic-encoded-key-capability",
  ],
  [
    "encoded leading key character",
    "https://deskohub.example.test/en-US/checkout/pay?%70ayState=synthetic-leading-key-capability",
    "synthetic-leading-key-capability",
  ],
  [
    "encoded key/value separator",
    "https://deskohub.example.test/en-US/checkout/pay?payState%3Dsynthetic-separator-capability",
    "synthetic-separator-capability",
  ],
  [
    "encoded URL and encoded key",
    "https%3A%2F%2Fdeskohub.example.test%2Fen-US%2Fcheckout%2Fpay%3Fpay%2553tate%3Dsynthetic-outer-capability",
    "synthetic-outer-capability",
  ],
])("structurally redacts a %s payState query", (_, url, capability) => {
  const command = formatRunnerCommand("agent-browser", ["open", url]);
  const subprocessOutput = redact(`browser stderr: ${url}`);
  const failure = formatWorkspaceE2EFailure(
    new Error(`navigation failed for ${url}`)
  );

  for (const output of [command, subprocessOutput, failure]) {
    expect(output).not.toContain(capability);
    expect(decodeURIComponent(decodeURIComponent(output))).toContain(
      "[redacted]"
    );
  }
});
