import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "@/scripts/shared/command";

test("runs the overview request-sharing proof in an isolated RSC Bun process", async () => {
  const result = await runCommand(
    [
      process.execPath,
      "--conditions=react-server",
      "test",
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "--parallel=1",
      "--timeout",
      "30000",
      "./features/administration/page-data.server.rsc-fixture.ts",
    ],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)) }
  );

  const output = `${result.stdout}${result.stderr}`;
  expect(result.exitCode).toBe(0);
  expect(output).toContain("3 pass");
  expect(output).toContain("RSC_PAGE_DATA_REQUEST_SHARING_PROOF");
});
