import { expect, test } from "bun:test";
import { Effect } from "effect";
import { workspaceE2EFullDateAllocation } from "../allocation";
import type { DatasourceConfig, WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { type makeWorkspaceE2ECases, sequenceWorkspaceE2EPreparation } from ".";

test("case construction requires no deployment identity", () => {
  const input: Parameters<typeof makeWorkspaceE2ECases>[0] = {
    allocation: workspaceE2EFullDateAllocation,
    config: makeConfig(),
    datasourceConfig: makeDatasourceConfig(),
    flowStates: [],
    run: makeRunner(),
  };

  expect(input).not.toHaveProperty("deploymentId");
});

test("overlaps independent discovery with seeding before availability", async () => {
  let availabilityStartCount = 0;
  let releaseAvailability: () => void = () => undefined;
  let releaseFixtures: () => void = () => undefined;
  let releaseIndependent: () => void = () => undefined;
  let signalAvailabilityStarted: () => void = () => undefined;
  let signalFixturesStarted: () => void = () => undefined;
  let signalIndependentStarted: () => void = () => undefined;
  const availabilityRelease = new Promise<void>((resolve) => {
    releaseAvailability = resolve;
  });
  const availabilityStarted = new Promise<void>((resolve) => {
    signalAvailabilityStarted = resolve;
  });
  const fixtureRelease = new Promise<void>((resolve) => {
    releaseFixtures = resolve;
  });
  const fixturesStarted = new Promise<void>((resolve) => {
    signalFixturesStarted = resolve;
  });
  const independentRelease = new Promise<void>((resolve) => {
    releaseIndependent = resolve;
  });
  const independentStarted = new Promise<void>((resolve) => {
    signalIndependentStarted = resolve;
  });
  const availability = (id: string) =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        availabilityStartCount += 1;
        if (availabilityStartCount === 2) signalAvailabilityStarted();
        return id;
      }),
      (startedId) =>
        Effect.promise(() => availabilityRelease).pipe(Effect.as(startedId)),
      () => Effect.void
    );

  const preparation = Effect.runPromise(
    sequenceWorkspaceE2EPreparation({
      availability: Effect.all(
        [availability("cowork"), availability("meeting-room")],
        { concurrency: "unbounded" }
      ),
      fixtures: Effect.acquireUseRelease(
        Effect.sync(() => signalFixturesStarted()),
        () => Effect.promise(() => fixtureRelease),
        () => Effect.void
      ),
      independent: Effect.acquireUseRelease(
        Effect.sync(() => signalIndependentStarted()),
        () =>
          Effect.promise(() => independentRelease).pipe(Effect.as("dotypos")),
        () => Effect.void
      ),
    })
  );

  await Promise.all([fixturesStarted, independentStarted]);
  await new Promise<void>((resolve) => setTimeout(resolve, 10));
  expect(availabilityStartCount).toBe(0);
  releaseFixtures();
  await availabilityStarted;
  expect(availabilityStartCount).toBe(2);
  releaseAvailability();
  releaseIndependent();
  await expect(preparation).resolves.toEqual([
    ["cowork", "meeting-room"],
    "dotypos",
  ]);
});

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});

const makeDatasourceConfig = (): DatasourceConfig => ({
  databaseUrl: "postgresql://preview.example.test/workspace",
  databaseUrlUnpooled: "postgresql://preview-direct.example.test/workspace",
  dotypos: {
    apiTimeout: 5_000,
    apiUrl: "https://dotypos.example.test",
    branchId: "branch",
    clientId: "client",
    clientSecret: "client-secret",
    cloudId: "cloud",
    employeeId: "employee",
    refreshToken: "refresh-token",
  },
  expectedCurrency: "EUR",
  nexiApiOrigin: "https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp",
  timeouts: workspaceE2ETimeouts,
});

const makeRunner = (): Runner => async () => ({
  exitCode: 0,
  stderr: "",
  stdout: "",
});
