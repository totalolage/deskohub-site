import { afterEach, expect, setSystemTime, spyOn, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Cause, Effect, Exit } from "effect";
import { getDatasourceConfig } from "../config";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import { formatWorkspaceE2EFailure } from "../errors";
import {
  fixtureCapacityLifetime,
  invalidateFixtureCapacityObservation,
  workspaceE2EFixtureCapacityPath,
  writeFixtureCapacityObservation,
} from "../fixture-capacity";
import {
  fixtureCapacityTestTable,
  makeFixtureCapacityTestObservation,
} from "../fixture-capacity.test-fixture";
import { CurrentReservationCase } from "../reservation-intents";
import {
  readReservationJournal,
  writeReservationJournal,
} from "../reservation-journal";
import * as runtime from "../runtime";
import { E2ERunContextService, makeE2ERunContext } from "../services/telemetry";
import {
  cancelSyntheticReservation,
  createSyntheticReferralHistoryReservation,
  createSyntheticReservation,
} from "./fixtures";

afterEach(async () => {
  setSystemTime();
  await invalidateFixtureCapacityObservation();
});
const now = Date.parse("2026-11-08T12:00:00Z");
const environment = makeTestE2EEnvironment({ TARGET_SHA: "a".repeat(40) });
const customerId = DotyposCustomerIdSchema.make("private-owner");

const withProvider = async (
  run: (input: {
    config: ReturnType<typeof getDatasourceConfig>;
    created: () => number;
    cancelled: () => number;
    changeTables: () => void;
  }) => Promise<void>
) => {
  let creates = 0;
  let cancels = 0;
  let changed = false;
  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token")
        return Response.json({ accessToken: "local-token" });
      if (url.pathname.endsWith("/tables"))
        return Response.json({
          data: [
            {
              ...fixtureCapacityTestTable,
              ...(changed ? { seats: "25" } : {}),
            },
          ],
        });
      if (url.pathname.endsWith("/reservations") && request.method === "POST") {
        creates++;
        return Response.json([
          {
            id: "private-reservation",
            _cloudId: "cloud",
            _branchId: "branch",
            _customerId: customerId,
            seats: "1",
            status: "CONFIRMED",
            startDate: new Date(now).toISOString(),
            endDate: new Date(now + 7200000).toISOString(),
          },
        ]);
      }
      if (request.method === "DELETE") {
        cancels++;
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 400 });
    },
  });
  try {
    await run({
      config: getDatasourceConfig({
        ...environment,
        DOTYPOS_API_URL: `http://127.0.0.1:${server.port}`,
      }),
      created: () => creates,
      cancelled: () => cancels,
      changeTables: () => {
        changed = true;
      },
    });
  } finally {
    await server.stop(true);
  }
};

for (const [family, create] of [
  ["future", createSyntheticReservation],
  ["past", createSyntheticReferralHistoryReservation],
] as const) {
  test(`${family} writer rejects missing, failed, expired, future, target/config and inventory mismatches before any POST`, async () => {
    setSystemTime(now);
    await withProvider(async ({ config, created, changeTables }) => {
      const observation = makeFixtureCapacityTestObservation(config);
      const reject = async (effect = create(config, { customerId })) => {
        const exit = await Effect.runPromise(Effect.exit(effect));
        expect(Exit.isFailure(exit)).toBe(true);
        expect(created()).toBe(0);
        if (Exit.isFailure(exit)) {
          const message = formatWorkspaceE2EFailure(Cause.squash(exit.cause));
          expect(message).toContain("Unknown");
          for (const value of [
            "private-owner",
            "private-reservation",
            "local-token",
            "127.0.0.1",
            "fingerprint",
          ])
            expect(message).not.toContain(value);
        }
      };
      await invalidateFixtureCapacityObservation();
      await reject();
      for (const invalid of [
        { ...observation, meetsRequiredCapacity: false },
        {
          ...observation,
          startMillis: now - fixtureCapacityLifetime,
          endMillis: now,
          observedMillis: now - 1000,
        },
        {
          ...observation,
          startMillis: now + 1,
          endMillis: now + 1 + fixtureCapacityLifetime,
          observedMillis: now + 1,
        },
        { ...observation, observedMillis: now + 1 },
        { ...observation, fingerprint: "f".repeat(64) },
        { ...observation, selectedTableDigest: "f".repeat(64) },
        { ...observation, inventoryDigest: "f".repeat(64) },
        { ...observation, seatCapacity: 99 },
        { ...observation, futurePeak: 24 },
        { ...observation, endMillis: now + fixtureCapacityLifetime + 1 },
      ]) {
        await writeFixtureCapacityObservation(observation);
        await writeFile(
          workspaceE2EFixtureCapacityPath,
          JSON.stringify(invalid),
          { mode: 0o600 }
        );
        await reject();
      }
      await writeFixtureCapacityObservation(observation);
      await reject(
        create(
          {
            ...config,
            fixtureCapacityTarget: {
              ...config.fixtureCapacityTarget,
              targetSha: "b".repeat(40),
            },
          },
          { customerId }
        )
      );
      await reject(
        create(
          {
            ...config,
            dotypos: { ...config.dotypos, employeeId: "another-employee" },
          },
          { customerId }
        )
      );
      setSystemTime(now - 86400000);
      const outside = create(config, { customerId });
      setSystemTime(now);
      await reject(outside);
      changeTables();
      await reject();
    });
  });

  test(`${family} writer accepts current admission and cleanup remains available after expiry`, async () => {
    setSystemTime(now);
    await withProvider(async ({ config, created, cancelled }) => {
      await writeFixtureCapacityObservation(
        makeFixtureCapacityTestObservation(config)
      );
      expect((await stat(workspaceE2EFixtureCapacityPath)).mode & 0o777).toBe(
        0o600
      );
      expect(workspaceE2EFixtureCapacityPath).not.toContain("e2e-artifacts");
      const reservation = await Effect.runPromise(
        create(config, { customerId })
      );
      expect(created()).toBe(1);
      setSystemTime(now + fixtureCapacityLifetime);
      await Effect.runPromise(
        cancelSyntheticReservation(config, reservation.reservationId!)
      );
      expect(cancelled()).toBe(1);
    });
  });

  test(`${family} cutoff is rechecked after asynchronous journal persistence before POST`, async () => {
    setSystemTime(now);
    const directory = await mkdtemp(join(tmpdir(), "fixture-cutoff-"));
    const journalPath = join(directory, "journal.json");
    await writeReservationJournal(journalPath, {});
    const write = runtime.writeJsonAtomically;
    const spy = spyOn(runtime, "writeJsonAtomically").mockImplementation(
      async (path, value) => {
        await write(path, value);
        if (path === journalPath) setSystemTime(now + fixtureCapacityLifetime);
      }
    );
    try {
      await withProvider(async ({ config, created }) => {
        await writeFixtureCapacityObservation(
          makeFixtureCapacityTestObservation(config)
        );
        const exit = await Effect.runPromise(
          create(config, { customerId }).pipe(
            Effect.provideService(CurrentReservationCase, {
              caseId: "account-reservation-transitions",
              journalPath,
            }),
            Effect.provideService(E2ERunContextService, {
              value: makeE2ERunContext(environment),
            }),
            Effect.exit
          )
        );
        expect(Exit.isFailure(exit)).toBe(true);
        expect(created()).toBe(0);
        expect(
          (await readReservationJournal(journalPath))?.reservationIntents
        ).toHaveLength(1);
      });
    } finally {
      spy.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("invalid fixture seat demand fails before provider POST", async () => {
  setSystemTime(now);
  await withProvider(async ({ config, created }) => {
    await writeFixtureCapacityObservation(
      makeFixtureCapacityTestObservation(config)
    );
    for (const seats of [0, -1, 0.5, 2, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        Exit.isFailure(
          await Effect.runPromise(
            createSyntheticReservation(config, { customerId, seats }).pipe(
              Effect.exit
            )
          )
        )
      ).toBe(true);
    }
    expect(created()).toBe(0);
  });
});
