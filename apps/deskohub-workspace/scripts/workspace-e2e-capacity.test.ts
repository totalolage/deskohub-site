import { afterEach, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { validE2ERuntimeEnvironment } from "../e2e/e2e-env.test-fixture";
import {
  invalidateFixtureCapacityObservation,
  workspaceE2EFixtureCapacityPath,
} from "../e2e/fixture-capacity";
import { workspaceDir, writeJsonAtomically } from "../e2e/runtime";
import { runCommand } from "./shared/command";

afterEach(invalidateFixtureCapacityObservation);
const run = (...args: string[]) =>
  runCommand(
    [
      process.execPath,
      "--no-env-file",
      "--preload",
      "./scripts/workspace-e2e-capacity.test-fixture.ts",
      "./scripts/workspace-e2e-capacity.ts",
      ...args,
    ],
    {
      cwd: workspaceDir,
      timeoutMs: 15000,
      env: {
        ...validE2ERuntimeEnvironment,
        NODE_ENV: "test",
        DOTYPOS_API_URL: "https://api.dotykacka.cz/v2",
        DOTYPOS_CLOUD_ID: "123",
        TARGET_SHA: "a".repeat(40),
      },
    }
  );

test("capacity command invalidates stale admission and writes a private observation only after both capacity reports pass", async () => {
  for (const failure of [
    "--fixture-token404",
    "--fixture-checkout-unknown",
    "--fixture-checkout-failure",
    "--fixture-insufficient",
  ]) {
    await writeJsonAtomically(workspaceE2EFixtureCapacityPath, { stale: true });
    const result = await run(failure);
    expect(result.exitCode).toBe(1);
    const metadata = await stat(workspaceE2EFixtureCapacityPath).catch(
      () => undefined
    );
    expect(metadata).toBeUndefined();
    for (const value of [
      "private-selected-table",
      "private-test-token",
      "refresh-token",
      "api.dotykacka.cz",
      "fingerprint",
      "Digest",
    ])
      expect(result.stdout + result.stderr).not.toContain(value);
    if (failure === "--fixture-insufficient") {
      expect(result.stdout).toContain('"plannedFixtureSeats": 12');
      expect(result.stdout).toContain('"meetsRequiredCapacity": false');
    }
  }
  const success = await run();
  expect(success.exitCode).toBe(0);
  const observation = JSON.parse(
    await readFile(workspaceE2EFixtureCapacityPath, "utf8")
  );
  expect(observation.meetsRequiredCapacity).toBe(true);
  expect(observation.endMillis - observation.startMillis).toBe(50 * 60 * 1000);
  expect((await stat(workspaceE2EFixtureCapacityPath)).mode & 0o777).toBe(
    0o600
  );
  expect(success.stdout).toContain('"complete": true');
  for (const value of [
    "private-selected-table",
    "private-test-token",
    "refresh-token",
    "api.dotykacka.cz",
    "fingerprint",
    "Digest",
  ])
    expect(success.stdout + success.stderr).not.toContain(value);
});
