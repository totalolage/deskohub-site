import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "mobile-release.ts");

// Runs the CLI without any signing or Expo credentials, so a refused flag
// combination must fail before the build starts.
const runBuild = async (...args: readonly string[]) => {
  const outDirectory = mkdtempSync(join(tmpdir(), "mobile-release-test-"));
  rmSync(outDirectory, { recursive: true });
  const {
    ANDROID_KEYSTORE_BASE64: _base64,
    ANDROID_KEYSTORE_PASSWORD: _password,
    ANDROID_KEYSTORE_PATH: _path,
    EXPO_TOKEN: _token,
    ...env
  } = process.env;
  const child = Bun.spawn(
    ["bun", script, "build", ...args, "--out-dir", outDirectory],
    { env, stderr: "pipe", stdout: "pipe" }
  );
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;
  const createdOutput = existsSync(outDirectory);
  rmSync(outDirectory, { force: true, recursive: true });
  return { createdOutput, exitCode, stderr };
};

describe("mobile-release.ts build --signing", () => {
  test("refuses debug signing for a release tag", async () => {
    const result = await runBuild(
      "--signing",
      "debug",
      "--tag",
      "mobile-v0.0.0"
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--signing debug");
    expect(result.createdOutput).toBe(false);
  });

  test("refuses an unknown signing mode", async () => {
    const result = await runBuild("--signing", "upload");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--signing");
    expect(result.createdOutput).toBe(false);
  });
});
