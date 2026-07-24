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
  [
    "doubly encoded raw key",
    "https://deskohub.example.test/en-US/checkout/pay?pay%2553tate=synthetic-double-key-capability",
    "synthetic-double-key-capability",
  ],
  [
    "doubly encoded raw separator",
    "https://deskohub.example.test/en-US/checkout/pay?payState%253Dsynthetic-double-separator-capability",
    "synthetic-double-separator-capability",
  ],
  [
    "mixed-case doubly encoded raw key and separator",
    "https://deskohub.example.test/en-US/checkout/pay?PaY%2553tAtE%253dsynthetic-mixed-case-capability",
    "synthetic-mixed-case-capability",
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

test.each([
  "checkoutToken",
  "payState",
  "payStateRef",
  "token",
  "state",
  "secret",
  "x-vercel-protection-bypass",
  "name",
  "message",
  "_vercel_share",
])("structurally redacts the case-insensitive %s capability across command, output, and failure paths", (key) => {
  const capability = `synthetic-${key.toLowerCase()}-capability-marker`;
  const mixedCaseKey = [...key]
    .map((character, index) =>
      index % 2 === 0 ? character.toUpperCase() : character.toLowerCase()
    )
    .join("");
  const encodedKey = mixedCaseKey.replace(
    /[A-Za-z0-9]/,
    (character) => `%${character.charCodeAt(0).toString(16)}`
  );
  const doublyEncodedKey = encodedKey.replaceAll("%", "%25");
  const urls = [
    `https://deskohub.example.test/en-US/checkout/pay?${mixedCaseKey}=${capability}`,
    `https://deskohub.example.test/en-US/checkout/pay?${encodedKey}%3D${capability}`,
    `https://deskohub.example.test/en-US/checkout/pay?${doublyEncodedKey}%253D${capability}`,
    encodeURIComponent(
      `https://deskohub.example.test/en-US/checkout/pay?${mixedCaseKey}=${capability}`
    ),
  ];

  for (const url of urls) {
    const outputs = [
      formatRunnerCommand("agent-browser", ["open", url]),
      redact(`browser stderr: ${url}`),
      formatWorkspaceE2EFailure(new Error(`navigation failed for ${url}`)),
    ];

    for (const output of outputs) {
      expect(output).not.toContain(capability);
      expect(decodeURIComponent(decodeURIComponent(output))).toContain(
        "[redacted]"
      );
    }
  }
});
