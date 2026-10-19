import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  deferAfterCompileVariable,
  withDeferrableAfterCompile,
} from "./next-build-after-compile.mjs";
import { runCommand } from "./shared/command";

const hook = async () => undefined;
const context = { defaultConfig: {} };

describe("withDeferrableAfterCompile", () => {
  afterEach(() => {
    delete process.env[deferAfterCompileVariable];
  });

  test("keeps the after-compile hook unless the runner defers it", async () => {
    const config = withDeferrableAfterCompile(async () => ({
      compiler: { removeConsole: true, runAfterProductionCompile: hook },
    }));
    expect(await config("phase-production-build", context)).toEqual({
      compiler: { removeConsole: true, runAfterProductionCompile: hook },
    });

    process.env[deferAfterCompileVariable] = "1";
    expect(await config("phase-production-build", context)).toEqual({
      compiler: { removeConsole: true },
    });
  });

  test("leaves a config without the hook as it is", async () => {
    process.env[deferAfterCompileVariable] = "1";
    const config = withDeferrableAfterCompile({ distDir: "build" });
    expect(await config("phase-production-build", context)).toEqual({
      distDir: "build",
    });
  });
});

describe.skipIf(Bun.which("node") === null)("Workspace Next config", () => {
  // Synthetic production settings that turn on PostHog's source-map upload;
  // loading the config contacts nothing.
  const productionEnvironment = {
    PATH: process.env.PATH,
    POSTHOG_API_KEY: "phx_synthetic",
    POSTHOG_PROJECT_ID: "1",
    VERCEL_ENV: "production",
  };
  const hasHook = async (env: Readonly<Record<string, string | undefined>>) => {
    const { stdout } = await runCommand(
      [
        "node",
        "--input-type=module",
        "-e",
        `const { default: config } = await import(${JSON.stringify(join(import.meta.dir, "..", "next.config.mjs"))});
const resolved = await config("phase-production-build", { defaultConfig: {} });
process.stdout.write(String(typeof resolved.compiler?.runAfterProductionCompile === "function"));`,
      ],
      { env, timeoutMs: 30_000 }
    );
    return stdout;
  };

  test("defers PostHog's production source-map hook to the runner", async () => {
    expect(await hasHook(productionEnvironment)).toBe("true");
    expect(
      await hasHook({
        ...productionEnvironment,
        [deferAfterCompileVariable]: "1",
      })
    ).toBe("false");
  }, 60_000);
});
