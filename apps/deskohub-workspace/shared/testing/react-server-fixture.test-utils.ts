import { fileURLToPath } from "node:url";
import { runCommand } from "@/scripts/shared/command";

const appRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Runs a `*.rsc-fixture.ts` test file in its own Bun process under the
 * `react-server` export condition, where `react` resolves to React's server
 * build the way it does in Next's server components. Resolves with the
 * fixture run's exit code and combined output.
 */
export const runReactServerFixture = async (fixturePath: string) => {
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
      fixturePath,
    ],
    { cwd: appRoot }
  );
  return {
    exitCode: result.exitCode,
    output: `${result.stdout}${result.stderr}`,
  };
};
