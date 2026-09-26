import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("runs the auth callback RSC regression in an isolated react-server process", () => {
  const result = Bun.spawnSync({
    cmd: [
      process.execPath,
      "--conditions=react-server",
      "test",
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "--parallel=1",
      "--timeout",
      "30000",
      "./features/account/components/auth-callback-rsc-fixture.ts",
    ],
    cwd: fileURLToPath(new URL("../../..", import.meta.url)),
    stderr: "pipe",
    stdout: "pipe",
  });

  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  expect(result.exitCode).toBe(0);
  expect(output).toContain("12 pass");
  expect(output).toContain("AUTH_CALLBACK_RSC_REGRESSION_PROOF");
});
