import { expect, test } from "bun:test";
import { withoutInstallStorePaths } from "./build-workspace-e2e-allocation-action";

test("labels bundled modules by package path, independent of the install store's peer hash", () => {
  const moduleComment = (peerHash: string) =>
    `// ../../node_modules/.bun/@effect+platform-node@4.0.0-beta.85+${peerHash}/node_modules/@effect/platform-node/dist/NodeRuntime.js\nvar runMain2 = runMain;\n`;

  expect(withoutInstallStorePaths(moduleComment("2edc8a5f9182791f"))).toBe(
    "// ../../node_modules/@effect/platform-node/dist/NodeRuntime.js\nvar runMain2 = runMain;\n"
  );
  expect(withoutInstallStorePaths(moduleComment("1c14cfe3862623f4"))).toBe(
    withoutInstallStorePaths(moduleComment("2edc8a5f9182791f"))
  );
});

test("leaves bundled code untouched", () => {
  const code =
    'const store = "node_modules/.bun/pg@8.23.1/node_modules/pg";\n// db/postgres-connection-url.ts\n';

  expect(withoutInstallStorePaths(code)).toBe(code);
});
