import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { mkdtemp, readdir, readFile, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Effect, Layer } from "effect";
import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";

mock.module("server-only", () => ({}));
mock.module("@/features/legal/acceptance-snapshot", () => ({
  getLegalAcceptanceSnapshot: mock(() =>
    Effect.succeed({
      privacyPolicy: {
        path: "/legal/privacy.md",
        hash: "synthetic-privacy-hash",
        hashAlgorithm: "sha256",
      },
    })
  ),
}));

const requireFromEmbeddedPostgres = createRequire(
  import.meta.resolve("embedded-postgres")
);
const embeddedPostgresPlatformPackage = `@embedded-postgres/${process.platform}-${process.arch}`;
const embeddedPostgresPlatformEntry = requireFromEmbeddedPostgres.resolve(
  embeddedPostgresPlatformPackage
);
const { initdb } = (await import(embeddedPostgresPlatformEntry)) as {
  readonly initdb: string;
};
const embeddedPostgresPlatformRoot = dirname(
  dirname(embeddedPostgresPlatformEntry)
);
const migrationsDirectory = new URL(".", import.meta.url);

const reservation = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  date: "2099-06-10",
  coffee: false,
  name: "Synthetic Customer",
  email: "customer@example.test",
  phone: "+420 700 000 001",
};
const checkoutSessionId = "synthetic-mixed-version-session";
const checkoutAttemptId = "synthetic-mixed-version-attempt";
const cutoverAt = "2020-01-01T00:00:00.000Z";
const legacyReadUntil = "2099-01-01T00:00:00.000Z";

let postgres: EmbeddedPostgres;
let assertionClient: Client;

beforeAll(async () => {
  await hydrateEmbeddedPostgresSymlinks();
  const databaseDir = await mkdtemp(
    join(tmpdir(), "workspace-checkout-identity-")
  );
  const nativeLibraryPath = join(dirname(dirname(initdb)), "lib");
  process.env.LD_LIBRARY_PATH = [nativeLibraryPath, process.env.LD_LIBRARY_PATH]
    .filter(Boolean)
    .join(":");
  const port = await getAvailablePort();
  const password = crypto.randomUUID();
  postgres = new EmbeddedPostgres({
    databaseDir,
    password,
    persistent: false,
    port,
    onError: () => undefined,
    onLog: () => undefined,
  });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("workspace_checkout_identity");

  assertionClient = postgres.getPgClient("workspace_checkout_identity");
  await assertionClient.connect();
  await applyProductionMigrations(assertionClient);

  process.env.DATABASE_URL =
    `postgresql://postgres:${encodeURIComponent(password)}` +
    `@127.0.0.1:${port}/workspace_checkout_identity`;
}, 30_000);

beforeEach(async () => {
  await assertionClient.query(
    'TRUNCATE TABLE "workspace_reservations" CASCADE'
  );
});

afterAll(async () => {
  await assertionClient?.end();
  await postgres?.stop();
}, 30_000);

describe("production checkout identity mixed-version concurrency", () => {
  for (const scenario of [
    {
      name: "the cutover crossing",
      legacyTime: "2019-12-31T23:59:59.999Z",
      currentTime: cutoverAt,
    },
    {
      name: "the exact cutover instant",
      legacyTime: cutoverAt,
      currentTime: cutoverAt,
    },
    {
      name: "the legacy-read deadline crossing",
      legacyTime: "2098-12-31T23:59:59.999Z",
      currentTime: legacyReadUntil,
    },
    {
      name: "the exact legacy-read deadline instant",
      legacyTime: legacyReadUntil,
      currentTime: legacyReadUntil,
    },
  ] as const) {
    for (const winner of ["legacy", "current"] as const) {
      test(`${winner} wins across ${scenario.name}`, async () => {
        await assertMixedVersionOverlap({
          winner,
          legacyTime: scenario.legacyTime,
          currentTime: scenario.currentTime,
        });
      }, 30_000);
    }
  }
});

const assertMixedVersionOverlap = async (input: {
  readonly winner: WriterGeneration;
  readonly legacyTime: string;
  readonly currentTime: string;
}) => {
  const gate = makeConcurrencyGate(input.winner);
  const providerId = `synthetic-provider-${input.winner}-${input.currentTime}`;
  const providerCalls: string[] = [];
  const claimResults: { generation: WriterGeneration; claimed: boolean }[] = [];
  const advertisedPriceToken = await buildAdvertisedPriceToken();

  const run = async (
    generation: WriterGeneration,
    keyDerivationTime: string
  ) => {
    const layer = await makeRequestLayer({
      generation,
      gate,
      providerCalls,
      providerId,
      claimResults,
    });
    const { prepareWorkspacePayState } = await import(
      "@/features/reservation/actions/prepare-pay-state"
    );

    try {
      return await prepareWorkspacePayState(
        {
          locale: "en-US",
          checkoutSessionId,
          checkoutAttemptId,
          advertisedPriceToken,
          reservation,
          legalConsent: true,
        },
        {
          writerGeneration: generation,
          keyDerivationTime: new Date(keyDerivationTime),
        }
      ).pipe(Effect.provide(layer), Effect.runPromise);
    } finally {
      if (generation !== input.winner) gate.closeCompetitor();
    }
  };

  const results = await Promise.allSettled([
    run("legacy", input.legacyTime),
    run("current", input.currentTime),
  ]);

  const rows = await assertionClient.query<{
    id: string;
    checkout_attempt_identity_key: string;
    dotypos_reservation_id: string | null;
    reservation_state: string;
  }>(
    `
      SELECT
        "id",
        "checkout_attempt_identity_key",
        "dotypos_reservation_id",
        "reservation_state"
      FROM "workspace_reservations"
    `
  );

  expect(rows.rows).toHaveLength(1);
  expect(claimResults.filter(({ claimed }) => claimed)).toHaveLength(1);
  expect(claimResults.find(({ claimed }) => claimed)?.generation).toBe(
    input.winner
  );
  expect(providerCalls).toEqual([providerId]);
  expect(rows.rows[0]).toMatchObject({
    dotypos_reservation_id: providerId,
    reservation_state: "held",
  });
  expect(rows.rows[0]?.checkout_attempt_identity_key).toMatch(/^[a-f0-9]{64}$/);

  const winnerIndex = input.winner === "legacy" ? 0 : 1;
  expect(results[winnerIndex]).toMatchObject({
    status: "fulfilled",
    value: { status: "ready" },
  });
  const loserIndex = winnerIndex === 0 ? 1 : 0;
  const loser = results[loserIndex];
  if (loser?.status === "fulfilled") {
    expect(loser.value).toMatchObject({ status: "ready" });
    expect(await getOrderId(loser.value.redirectUrl)).toBe(rows.rows[0]?.id);
  } else {
    expect(loser?.reason).toBeDefined();
  }
};

type WriterGeneration = "current" | "legacy";

const makeConcurrencyGate = (winner: WriterGeneration) => {
  const bothAtInsert = promiseWithResolvers<void>();
  const winnerCommitted = promiseWithResolvers<void>();
  const bothInsertsSettled = promiseWithResolvers<void>();
  const winnerClaimed = promiseWithResolvers<void>();
  const competitorClosed = promiseWithResolvers<void>();
  let insertEntrants = 0;
  let settledInserts = 0;

  return {
    winner,
    enterInsert: async () => {
      insertEntrants += 1;
      if (insertEntrants === 2) bothAtInsert.resolve();
      await bothAtInsert.promise;
    },
    waitForWinnerCommit: () => winnerCommitted.promise,
    markWinnerCommitted: () => winnerCommitted.resolve(),
    settleInsert: () => {
      settledInserts += 1;
      if (settledInserts === 2) bothInsertsSettled.resolve();
    },
    waitForBothInserts: () => bothInsertsSettled.promise,
    waitForWinnerClaim: () => winnerClaimed.promise,
    markWinnerClaimed: () => winnerClaimed.resolve(),
    closeCompetitor: () => competitorClosed.resolve(),
    waitForCompetitor: () => competitorClosed.promise,
  };
};

type ConcurrencyGate = ReturnType<typeof makeConcurrencyGate>;

const makeRequestLayer = async (input: {
  readonly generation: WriterGeneration;
  readonly gate: ConcurrencyGate;
  readonly providerCalls: string[];
  readonly providerId: string;
  readonly claimResults: {
    generation: WriterGeneration;
    claimed: boolean;
  }[];
}) => {
  const [
    { DotyposService },
    { CheckoutPricingService },
    { buildCoworkReservationQuote },
    { affirmedDiscountAdvertisementQuoteCodec },
    { BotProtectionService },
    { LegalEvidenceEventRepository },
    { ReservationHoldCleanupScheduleService },
    { WorkspaceCheckoutAccessCodeService, WorkspaceTableAssignmentService },
    { WorkspaceAvailabilityService },
    {
      WorkspaceReservationRepository,
      WorkspaceReservationRepositoryLegacyWriterLive,
      WorkspaceReservationRepositoryLive,
    },
    { WorkspaceDatabaseLive },
    { PostHogEventService },
    { WorkspaceLoggerLive },
  ] = await Promise.all([
    import("@deskohub/dotypos"),
    import("@/features/checkout/backend/checkout/checkout-pricing.service"),
    import("@/features/checkout/checkout-quote.test-utils"),
    import("@/features/discounts"),
    import("@/shared/backend/bot-protection/bot-protection.service"),
    import("@/features/checkout/backend/repositories"),
    import("@/features/checkout/backend/holds"),
    import("@/features/checkout/backend/reservation"),
    import("@/features/reservation/backend/workspace-availability.service"),
    import("@/features/reservation/backend/workspace-reservation.repository"),
    import("@/db/database.service"),
    import("@/shared/backend/analytics/posthog-event.service"),
    import("@/shared/backend/logging/censorship"),
  ]);

  const repositoryBase = (
    input.generation === "legacy"
      ? WorkspaceReservationRepositoryLegacyWriterLive
      : WorkspaceReservationRepositoryLive
  ).pipe(Layer.provide(WorkspaceDatabaseLive));
  const coordinatedRepository = Layer.effect(
    WorkspaceReservationRepository,
    Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      return {
        ...repository,
        createDraft: (draft) =>
          Effect.gen(function* () {
            yield* Effect.promise(input.gate.enterInsert);
            if (input.generation !== input.gate.winner) {
              yield* Effect.promise(input.gate.waitForWinnerCommit);
            }
            const created = yield* repository
              .createDraft(draft)
              .pipe(
                Effect.onExit(() =>
                  Effect.sync(() => input.gate.settleInsert())
                )
              );
            if (input.generation === input.gate.winner) {
              input.gate.markWinnerCommitted();
            }
            yield* Effect.promise(input.gate.waitForBothInserts);
            return created;
          }),
        claimHoldCreation: (id) =>
          Effect.gen(function* () {
            if (input.generation !== input.gate.winner) {
              yield* Effect.promise(input.gate.waitForWinnerClaim);
            }
            const claimed = yield* repository.claimHoldCreation(id);
            input.claimResults.push({
              generation: input.generation,
              claimed,
            });
            if (input.generation === input.gate.winner) {
              input.gate.markWinnerClaimed();
            } else {
              input.gate.closeCompetitor();
            }
            return claimed;
          }),
      };
    })
  ).pipe(Layer.provide(repositoryBase));

  const discountableSubtotal = {
    value: 35_000,
    exponent: 2,
    currency: "CZK",
  } as const;
  const discountQuote = affirmedDiscountAdvertisementQuoteCodec.make({
    product: { kind: "cowork", tier: "basic" },
    discountableSubtotal,
    discounts: [],
    totalDiscount: { ...discountableSubtotal, value: 0 },
    discountedSubtotal: discountableSubtotal,
  });
  const quote = buildCoworkReservationQuote(reservation, { discountQuote });

  return Layer.mergeAll(
    WorkspaceLoggerLive,
    coordinatedRepository,
    Layer.succeed(CheckoutPricingService, {
      quoteAdvertisement: () => Effect.die("unused"),
      affirmAdvertisement: ({ reservation: advertisedReservation }) =>
        Effect.succeed({
          kind: "cowork" as const,
          reservation: advertisedReservation,
          quote,
          discountQuote,
        }),
      quoteForCustomer: ({ reservation: customerReservation }) =>
        Effect.succeed({
          kind: "cowork" as const,
          reservation: customerReservation,
          quote,
        }),
      affirmForPayment: () => Effect.die("unused"),
      applyDiscountCode: () => Effect.die("unused"),
    } as never),
    Layer.succeed(BotProtectionService, {
      verifyHuman: () => Effect.void,
    }),
    Layer.succeed(WorkspaceAvailabilityService, {
      getAvailability: () => Effect.die("unused"),
      ensureAvailable: () => Effect.void,
    }),
    Layer.succeed(WorkspaceCheckoutAccessCodeService, {
      generateCustomerAccessCode: Effect.succeed("SYNTHETIC-ACCESS"),
    }),
    Layer.succeed(LegalEvidenceEventRepository, {
      record: () => Effect.die("unused"),
      recordMany: (events) => Effect.succeed(events),
    } as never),
    Layer.succeed(ReservationHoldCleanupScheduleService, {
      enqueueCleanup: () => Effect.void,
    } as never),
    Layer.succeed(WorkspaceTableAssignmentService, {
      assignTableId: () => Effect.succeed("synthetic-table"),
    }),
    Layer.succeed(PostHogEventService, {
      capture: () => Effect.void,
    }),
    Layer.succeed(DotyposService, {
      findOrCreateCustomer: () =>
        Effect.succeed({ id: "synthetic-customer" } as never),
      createReservation: () =>
        Effect.promise(async () => {
          input.providerCalls.push(input.providerId);
          await input.gate.waitForCompetitor();
          return { id: input.providerId } as never;
        }),
    } as never)
  );
};

const buildAdvertisedPriceToken = async () => {
  const [
    { buildAdvertisedPriceState, sealAdvertisedPriceState },
    { buildCoworkReservationQuote },
  ] = await Promise.all([
    import("@/features/checkout/backend/checkout"),
    import("@/features/checkout/checkout-quote.test-utils"),
  ]);
  const quote = buildCoworkReservationQuote(reservation);
  return await Effect.gen(function* () {
    const state = yield* buildAdvertisedPriceState({
      kind: "cowork",
      locale: "en-US",
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          entryTier: reservation.entryTier,
          coffee: reservation.coffee,
          date: reservation.date,
        },
      },
      quote,
    });
    return yield* sealAdvertisedPriceState(state);
  }).pipe(Effect.runPromise);
};

const getOrderId = async (redirectUrl: string) => {
  const { openPayState, payStateTokenQueryParam } = await import(
    "@/features/checkout/backend/checkout"
  );
  const token = new URL(redirectUrl, "https://deskohub.test").searchParams.get(
    payStateTokenQueryParam
  );
  return token ? Effect.runSync(openPayState(token)).orderId : undefined;
};

const applyProductionMigrations = async (client: Client) => {
  await client.query(`
    CREATE OR REPLACE FUNCTION uuid_generate_v7()
    RETURNS uuid
    LANGUAGE sql
    VOLATILE
    AS $$ SELECT gen_random_uuid() $$;
  `);
  const directories = (
    await readdir(migrationsDirectory, {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const directory of directories) {
    const migration = await readFile(
      new URL(`./${directory}/migration.sql`, migrationsDirectory),
      "utf8"
    );
    for (const statement of migration.split("--> statement-breakpoint")) {
      const sql = statement.trim();
      if (!sql || sql === 'CREATE EXTENSION IF NOT EXISTS "pg_uuidv7";') {
        continue;
      }
      await client.query(sql);
    }
  }
};

const promiseWithResolvers = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const getAvailablePort = async () =>
  await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a local PostgreSQL test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });

const hydrateEmbeddedPostgresSymlinks = async () => {
  const symlinkSpecs = JSON.parse(
    await readFile(
      join(embeddedPostgresPlatformRoot, "native", "pg-symlinks.json"),
      "utf8"
    )
  ) as readonly { readonly source: string; readonly target: string }[];

  await Promise.all(
    symlinkSpecs.map(async ({ source, target }) => {
      const sourcePath = join(embeddedPostgresPlatformRoot, source);
      const targetPath = join(embeddedPostgresPlatformRoot, target);
      await symlink(
        relative(dirname(targetPath), sourcePath),
        targetPath
      ).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    })
  );
};
