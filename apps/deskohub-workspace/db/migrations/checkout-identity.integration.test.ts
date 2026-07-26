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
import { createHmac } from "node:crypto";
import { mkdtemp, readdir, readFile, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Data, Effect, Layer } from "effect";
import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import type { CreateWorkspaceReservationInput } from "@/features/reservation/backend/workspace-reservation.repository";

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
const boundaryScenarios = [
  { name: "before cutover", currentTime: "2019-12-31T23:59:59.999Z" },
  { name: "at cutover", currentTime: cutoverAt },
  { name: "after cutover", currentTime: "2020-01-01T00:00:00.001Z" },
  {
    name: "before the legacy deadline",
    currentTime: "2098-12-31T23:59:59.999Z",
  },
  { name: "at the legacy deadline", currentTime: legacyReadUntil },
  {
    name: "after the legacy deadline",
    currentTime: "2099-01-01T00:00:00.001Z",
  },
] as const;

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
  for (const scenario of boundaryScenarios) {
    for (const winner of ["legacy", "current"] as const) {
      test(`${winner} insert wins ${scenario.name}`, async () => {
        await assertMixedVersionOverlap({
          winner,
          currentTime: scenario.currentTime,
        });
      }, 30_000);
    }
  }
});

describe("production repository identity conflict safety", () => {
  test("fails closed on divergent candidates before provider start", async () => {
    const layer = await makeRepositoryLayer();
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const rawAttempt = "a".repeat(64);
    const dedicatedAttempt = "b".repeat(64);
    let providerStarts = 0;
    const error = await Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      yield* repository.createDraft(
        makeDraftInput("divergent-a", {
          checkoutAttemptKey: rawAttempt,
          checkoutAttemptIdentityKey: "c".repeat(64),
        })
      );
      yield* repository.createDraft(
        makeDraftInput("divergent-b", {
          checkoutAttemptKey: "d".repeat(64),
          checkoutAttemptIdentityKey: dedicatedAttempt,
        })
      );
      return yield* repository
        .createDraft(
          makeDraftInput("divergent-probe", {
            checkoutAttemptKey: rawAttempt,
            checkoutAttemptIdentityKey: dedicatedAttempt,
          })
        )
        .pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              providerStarts += 1;
            })
          )
        );
    }).pipe(Effect.provide(layer), Effect.flip, Effect.runPromise);

    expect(error).toMatchObject({
      _tag: "WorkspaceReservationStateError",
      operation: "workspaceReservations.createDraft",
      reservationId: "conflicting-checkout-attempt",
    });
    expect(providerStarts).toBe(0);
    const rows = await assertionClient.query(
      'SELECT "id" FROM "workspace_reservations"'
    );
    expect(rows.rows).toHaveLength(2);
  });

  test("rolls back replacement identity conflicts and preserves the prior row", async () => {
    const layer = await makeRepositoryLayer();
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const result = await Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      const prior = yield* repository.createDraft(
        makeDraftInput("rollback-prior")
      );
      const claimed = yield* repository.claimHoldCreation(prior.id);
      expect(claimed).toBe(true);
      const createdAt = Temporal.Instant.from("2099-06-10T10:00:00.000Z");
      yield* repository.attachHold({
        id: prior.id,
        dotyposReservationId: "rollback-prior-provider",
        reservationCreatedAt: createdAt,
        reservationHoldExpiresAt: createdAt.add({ minutes: 10 }),
      });
      const cancelling = yield* repository.claimSupersessionCancellation(
        prior.id
      );
      expect(cancelling?.reservationState).toBe("cancelling");
      const conflict = yield* repository.createDraft(
        makeDraftInput("rollback-conflict")
      );
      const replacement = makeDraftInput("rollback-replacement", {
        checkoutAttemptIdentityKey: conflict.checkoutAttemptIdentityKey,
      });
      const failure = yield* repository
        .completeSupersessionAndCreateDraft({
          cancelledReservationId: prior.id,
          cancelledAt: createdAt.add({ seconds: 1 }),
          replacement,
        })
        .pipe(Effect.flip);
      const preserved = yield* repository.findById(prior.id);
      return { failure, preserved };
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result.failure).toBeDefined();
    expect(result.preserved?.reservationState).toBe("cancelling");
    expect(result.preserved?.reservationCancelledAt).toBeNull();
    const rows = await assertionClient.query<{
      reservation_state: string;
    }>(
      'SELECT "reservation_state" FROM "workspace_reservations" ORDER BY "id"'
    );
    expect(rows.rows).toHaveLength(2);
    expect(
      rows.rows.filter(
        ({ reservation_state }) => reservation_state === "cancelled"
      )
    ).toHaveLength(0);
  });
});

const assertMixedVersionOverlap = async (input: {
  readonly winner: WriterGeneration;
  readonly currentTime: string;
}) => {
  const gate = makeConcurrencyGate(input.winner);
  const providerId = `synthetic-provider-${input.winner}-${input.currentTime}`;
  const providerCalls: string[] = [];
  const claimResults: { generation: WriterGeneration; claimed: boolean }[] = [];
  const advertisedPriceToken = await buildAdvertisedPriceToken();

  const run = async (generation: WriterGeneration) => {
    const layer = await makeRequestLayer({
      generation,
      gate,
      providerCalls,
      providerId,
      claimResults,
    });
    if (generation === "legacy") {
      return await (await makeImmutableLegacyWriter()).pipe(
        Effect.provide(layer),
        Effect.runPromise
      );
    }
    const { prepareWorkspacePayState } = await import(
      "@/features/reservation/actions/prepare-pay-state"
    );
    return await prepareWorkspacePayState(
      {
        locale: "en-US",
        checkoutSessionId,
        checkoutAttemptId,
        advertisedPriceToken,
        reservation,
        legalConsent: true,
      },
      { keyDerivationTime: new Date(input.currentTime) }
    ).pipe(Effect.provide(layer), Effect.runPromise);
  };

  const results = await Promise.allSettled([run("legacy"), run("current")]);

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

  const barrierFailures = results.flatMap((result) =>
    result.status === "rejected" &&
    result.reason instanceof Error &&
    result.reason.message.startsWith("Mixed-version ")
      ? [result.reason.message]
      : []
  );
  expect(barrierFailures).toEqual([]);
  expect(rows.rows).toHaveLength(1);
  expect(claimResults).toHaveLength(2);
  expect(claimResults.filter(({ claimed }) => claimed)).toHaveLength(1);
  expect(providerCalls).toEqual([providerId]);
  expect(rows.rows[0]).toMatchObject({
    dotypos_reservation_id: providerId,
    reservation_state: "held",
  });
  expect(rows.rows[0]?.checkout_attempt_identity_key).toMatch(/^[a-f0-9]{64}$/);

  const ready = results.filter(
    (result) =>
      result.status === "fulfilled" &&
      typeof result.value === "object" &&
      result.value !== null &&
      "status" in result.value &&
      result.value.status === "ready"
  );
  expect(ready).toHaveLength(1);
  const failedClosed = results.filter(
    (result) =>
      result.status === "rejected" ||
      (result.status === "fulfilled" &&
        typeof result.value === "object" &&
        result.value !== null &&
        "status" in result.value &&
        result.value.status === "error")
  );
  expect(failedClosed).toHaveLength(1);
};

type WriterGeneration = "current" | "legacy";

class LegacyWriterConflictFailure extends Data.TaggedError(
  "LegacyWriterConflictFailure"
)<{
  readonly kind: "claim_conflict";
}> {}

const makeImmutableLegacyWriter = async () => {
  const [{ DotyposService }, { WorkspaceReservationRepository }] =
    await Promise.all([
      import("@deskohub/dotypos"),
      import("@/features/reservation/backend/workspace-reservation.repository"),
    ]);

  return Effect.gen(function* () {
    const rawPayStateKeys = process.env.CHECKOUT_PAY_STATE_KEYS;
    if (!rawPayStateKeys) {
      return yield* Effect.die(
        "Synthetic test Pay-state material was not configured."
      );
    }
    const derive = (payload: object) =>
      createHmac("sha256", rawPayStateKeys)
        .update(JSON.stringify(payload))
        .digest("hex");
    const checkoutSessionKey = derive({ checkoutSessionId });
    const checkoutAttemptKey = derive({
      checkoutSessionId,
      checkoutAttemptId,
      reservation: {
        name: reservation.name,
        email: reservation.email,
        phone: reservation.phone,
        kind: reservation.kind,
        date: reservation.date,
        entryTier: reservation.entryTier,
        coffee: reservation.coffee,
        monitorOption: null,
      },
    });
    const reservations = yield* WorkspaceReservationRepository;
    const dotypos = yield* DotyposService;
    const draft = yield* reservations.createDraft({
      checkoutSessionKey,
      checkoutAttemptKey,
      checkoutSessionIdentityKey: checkoutSessionKey,
      checkoutAttemptIdentityKey: checkoutAttemptKey,
      dotyposCustomerId: "synthetic-customer",
      customerAccessCode: "SYNTHETIC-ACCESS",
      reservationDetails: {
        kind: "cowork",
        entryTier: reservation.entryTier,
        coffee: reservation.coffee,
      },
      locale: "en-US",
      reservationHoldExpiresAt: Temporal.Instant.from(
        "2099-06-10T12:00:00.000Z"
      ),
    });
    const claimed = yield* reservations.claimHoldCreation(draft.id);
    if (!claimed) {
      return yield* new LegacyWriterConflictFailure({
        kind: "claim_conflict",
      });
    }
    const created = yield* dotypos.createReservation({} as never);
    if (
      !created ||
      typeof created !== "object" ||
      !("id" in created) ||
      typeof created.id !== "string"
    ) {
      return yield* Effect.die("Synthetic provider did not return an ID.");
    }
    const createdAt = Temporal.Instant.from("2099-06-10T10:00:00.000Z");
    yield* reservations.attachHold({
      id: draft.id,
      dotyposReservationId: created.id,
      reservationCreatedAt: createdAt,
      reservationHoldExpiresAt: createdAt.add({ minutes: 10 }),
    });
    return { status: "ready" as const, reservationId: draft.id };
  });
};

const makeConcurrencyGate = (winner: WriterGeneration) => {
  const bothAtInsert = promiseWithResolvers<void>();
  const winnerCommitted = promiseWithResolvers<void>();
  const bothAtClaim = promiseWithResolvers<void>();
  let insertEntrants = 0;
  let claimEntrants = 0;

  return {
    winner,
    enterInsert: async (generation: WriterGeneration) => {
      insertEntrants += 1;
      if (insertEntrants === 2) bothAtInsert.resolve();
      await waitForBarrier(bothAtInsert.promise, "insert", insertEntrants);
      if (generation !== winner) {
        await waitForBarrier(
          winnerCommitted.promise,
          "winner_commit",
          insertEntrants
        );
      }
    },
    markInsertCommitted: (generation: WriterGeneration) => {
      if (generation === winner) winnerCommitted.resolve();
    },
    enterClaim: async () => {
      claimEntrants += 1;
      if (claimEntrants === 2) bothAtClaim.resolve();
      await waitForBarrier(bothAtClaim.promise, "claim", claimEntrants);
    },
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
            yield* Effect.promise(() =>
              input.gate.enterInsert(input.generation)
            );
            const created = yield* repository.createDraft(draft);
            input.gate.markInsertCommitted(input.generation);
            return created;
          }),
        claimHoldCreation: (id) =>
          Effect.gen(function* () {
            yield* Effect.promise(input.gate.enterClaim);
            const claimed = yield* repository.claimHoldCreation(id);
            input.claimResults.push({
              generation: input.generation,
              claimed,
            });
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
        Effect.sync(() => {
          input.providerCalls.push(input.providerId);
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

const makeRepositoryLayer = async () => {
  const [{ WorkspaceDatabaseLive }, { WorkspaceReservationRepositoryLive }] =
    await Promise.all([
      import("@/db/database.service"),
      import("@/features/reservation/backend/workspace-reservation.repository"),
    ]);
  return WorkspaceReservationRepositoryLive.pipe(
    Layer.provide(WorkspaceDatabaseLive)
  );
};

const makeDraftInput = (
  suffix: string,
  overrides: Partial<CreateWorkspaceReservationInput> = {}
): CreateWorkspaceReservationInput => ({
  checkoutSessionKey: `session-${suffix}`,
  checkoutAttemptKey: `attempt-${suffix}`,
  checkoutSessionIdentityKey: `session-identity-${suffix}`,
  checkoutAttemptIdentityKey: `attempt-identity-${suffix}`,
  dotyposCustomerId: "synthetic-customer",
  customerAccessCode: "SYNTHETIC-ACCESS",
  reservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  locale: "en-US",
  reservationHoldExpiresAt: Temporal.Instant.from("2099-06-10T12:00:00.000Z"),
  ...overrides,
});

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

const waitForBarrier = async (
  barrier: Promise<void>,
  stage: "claim" | "insert" | "winner_commit",
  entrants: number
) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      barrier,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Mixed-version ${stage} barrier stopped at ${entrants} entrant(s).`
              )
            ),
          5_000
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
