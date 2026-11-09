import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect } from "effect";
import { instantStringSchema } from "@/shared/utils/temporal";
import { createSyntheticReservation } from "./account/fixtures";
import { makeOfficeCheckoutData } from "./checkout/data";
import { getDatasourceConfig } from "./config";
import { makeTestE2EEnvironment } from "./e2e-env.test-fixture";
import {
  invalidateFixtureCapacityObservation,
  writeFixtureCapacityObservation,
} from "./fixture-capacity";
import {
  fixtureCapacityTestTable,
  makeFixtureCapacityTestObservation,
} from "./fixture-capacity.test-fixture";
import {
  CurrentReservationCase,
  recordCheckoutIntent,
  recordReservationIntent,
} from "./reservation-intents";
import {
  readReservationJournal,
  writeReservationJournal,
} from "./reservation-journal";
import { E2ERunContextService, makeE2ERunContext } from "./services/telemetry";
import { parseReservationIntents } from "./soak-ownership";

test("the real account fixture persists each far-future intent before POST and each returned ID before the next create", async () => {
  const directory = await mkdtemp(join(tmpdir(), "account-intent-"));
  const path = join(directory, "account-lane.json");
  const environment = makeTestE2EEnvironment({
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "1",
    TARGET_SHA: "a".repeat(40),
  });
  const context = makeE2ERunContext(environment);
  const caseId = "account-reservation-transitions";
  let creates = 0;
  await writeReservationJournal(path, { laneId: "account-lane" });
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/signin/token")
        return Response.json({ accessToken: "local-access-token" });
      if (url.pathname === "/clouds/cloud/tables")
        return Response.json({
          data: [fixtureCapacityTestTable],
        });
      if (
        url.pathname === "/clouds/cloud/reservations" &&
        request.method === "POST"
      ) {
        const journal = await readReservationJournal(path);
        const intents = parseReservationIntents(
          journal?.reservationIntents,
          context,
          [caseId]
        );
        expect(intents).toHaveLength(creates + 1);
        expect(Date.parse(intents[creates]!.startDate)).toBeGreaterThan(
          Date.now() + 100 * 86400000
        );
        expect(
          Date.parse(intents[creates]!.endDate) -
            Date.parse(intents[creates]!.startDate)
        ).toBe(7200000);
        if (creates === 1)
          expect(intents[0]?.reservationId).toBe("reservation-1");
        creates++;
        return Response.json([
          {
            id: `reservation-${creates}`,
            _cloudId: "cloud",
            _branchId: "branch",
            _customerId: "synthetic-account-owner",
            status: "CONFIRMED",
            startDate: intents[creates - 1]!.startDate,
            endDate: intents[creates - 1]!.endDate,
            seats: "1",
          },
        ]);
      }
      return new Response(null, { status: 400 });
    },
  });
  try {
    const config = getDatasourceConfig({
      ...environment,
      DOTYPOS_API_URL: `http://127.0.0.1:${server.port}`,
    });
    await writeFixtureCapacityObservation(
      makeFixtureCapacityTestObservation(config)
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* createSyntheticReservation(config, {
          customerId: DotyposCustomerIdSchema.make("synthetic-account-owner"),
        });
        yield* createSyntheticReservation(config, {
          customerId: DotyposCustomerIdSchema.make("synthetic-account-owner"),
        });
      }).pipe(
        Effect.provideService(E2ERunContextService, { value: context }),
        Effect.provideService(CurrentReservationCase, {
          caseId,
          journalPath: path,
        })
      )
    );
    expect(creates).toBe(2);
    const journal = await readReservationJournal(path);
    expect(
      parseReservationIntents(journal?.reservationIntents, context, [
        caseId,
      ]).map(({ reservationId }) => reservationId)
    ).toEqual(["reservation-1", "reservation-2"]);
  } finally {
    await invalidateFixtureCapacityObservation();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing journal and unregistered case refuse admission before any create", async () => {
  const context = makeE2ERunContext(makeTestE2EEnvironment());
  const input = {
    owner: { customerId: "synthetic" },
    startDate: new Date("2027-01-01"),
    endDate: new Date("2027-01-02"),
  };
  for (const current of [
    undefined,
    { caseId: "unregistered", journalPath: "unused" },
    {
      caseId: "account-reservation-transitions",
      journalPath: join(tmpdir(), `missing-${crypto.randomUUID()}.json`),
    },
  ]) {
    const exit = await Effect.runPromise(
      Effect.exit(recordReservationIntent(input)).pipe(
        Effect.provideService(E2ERunContextService, { value: context }),
        Effect.provideService(CurrentReservationCase, current)
      )
    );
    expect(exit._tag).toBe("Failure");
  }
});

test("office intent uses the actual branded instant strings, preserving its disjoint multi-day interval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "office-intent-"));
  const journalPath = join(directory, "checkout-office.json");
  const caseId = "checkout-office-paid-multi-day";
  try {
    await writeReservationJournal(journalPath, { caseId });
    const data = makeOfficeCheckoutData("https://workspace.example.test", {
      startsAt: instantStringSchema.make("2027-01-02T08:00:00Z"),
      endsAt: instantStringSchema.make("2027-01-04T16:00:00Z"),
      startsOn: "2027-01-02",
      endsOn: "2027-01-04",
      seats: 2,
    });
    const context = makeE2ERunContext(makeTestE2EEnvironment());
    const recorded = await Effect.runPromise(
      recordCheckoutIntent(data).pipe(
        Effect.provideService(E2ERunContextService, { value: context }),
        Effect.provideService(CurrentReservationCase, { caseId, journalPath })
      )
    );
    expect(recorded?.intent.startDate).toBe("2027-01-02T08:00:00.000Z");
    expect(recorded?.intent.endDate).toBe("2027-01-04T16:00:00.000Z");
    const missing = await Effect.runPromise(
      Effect.exit(recordCheckoutIntent({ ...data, office: undefined }))
    );
    expect(missing._tag).toBe("Failure");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
