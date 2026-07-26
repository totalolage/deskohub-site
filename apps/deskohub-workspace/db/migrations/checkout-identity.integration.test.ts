import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect, Layer } from "effect";
import EmbeddedPostgres from "embedded-postgres";
import type { Client } from "pg";
import type {
  CreateWorkspaceReservationInput,
  WorkspaceReservation,
} from "@/features/reservation/backend/workspace-reservation.repository";

mock.module("server-only", () => ({}));
mock.module("./bot-protection/bot-protection.runtime", () => ({
  isWorkspaceBotIdEnforcedAtRuntime: () => false,
}));
mock.module("botid/server", () => ({
  checkBotId: () => Promise.resolve({ isBot: false }),
}));
mock.module("next/headers", () => ({
  cookies: async () => ({ getAll: () => [] }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));
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
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../.."
);
const immutableWriterRevision = "34b07b3e045d8e9bf3468c51378c69991db70889";
const immutableWriterIdentity = {
  tree: "2cc3492aa7c4fab621d4710c728e36d800a84d29",
  preparePayState: "c8402f6d2b7a87f99d6430b3556f858ed28c5491",
  repository: "02dc6dd716ca4cbe55a38bb2d311e1fe7bcb63a6",
  keyDerivation: "f8fb05deb1919cbcf9fa1a459bb2633025ebd0c5",
  schema: "22888c3dbaec13ea0369003609b6f0fa46b3bb73",
} as const;

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

const requireCreatedDraft = (acquisition: {
  readonly _tag: string;
  readonly reservation?: WorkspaceReservation;
}) => {
  if (acquisition._tag === "created" && acquisition.reservation) {
    return acquisition.reservation;
  }
  throw new Error(
    `Expected created draft acquisition, received ${acquisition._tag}`
  );
};

let postgres: EmbeddedPostgres;
let assertionClient: Client;
let immutableWriterRoot: string;
beforeAll(async () => {
  immutableWriterRoot = await extractImmutableWriter();
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
  if (immutableWriterRoot) {
    await rm(immutableWriterRoot, { recursive: true, force: true });
  }
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
  test("real action fails closed on divergent candidates before provider start", async () => {
    const keyDerivationTime = new Date("2099-01-01T00:00:00.001Z");
    setSystemTime(keyDerivationTime);
    try {
      const advertisedPriceToken = await buildAdvertisedPriceToken();
      const [
        { freezeCheckoutKeyDerivation },
        { WorkspaceReservationRepository },
        { prepareWorkspacePayState },
        { preparePayStateSchema },
        { defineWorkspaceAction },
        { m },
      ] = await Promise.all([
        import(
          "@/features/checkout/backend/checkout/checkout-session-key.server"
        ),
        import(
          "@/features/reservation/backend/workspace-reservation.repository"
        ),
        import("@/features/reservation/actions/prepare-pay-state"),
        import("@/features/reservation/actions/prepare-pay-state.schema"),
        import("@/shared/backend/workspace-action"),
        import("@/features/i18n"),
      ]);
      const keys = freezeCheckoutKeyDerivation({
        now: () => keyDerivationTime,
      }).attempt({
        checkoutSessionId,
        checkoutAttemptId,
        reservation,
      });
      const repositoryLayer = await makeRepositoryLayer();
      await Effect.gen(function* () {
        const repository = yield* WorkspaceReservationRepository;
        yield* repository.acquireDraft(
          makeDraftInput("divergent-raw", {
            checkoutAttemptKey: keys.legacy,
            checkoutAttemptIdentityKey: testCheckoutKey(
              "divergent-raw-identity"
            ),
            checkoutAttemptCompatibilityKey: testCheckoutKey(
              "divergent-raw-compatibility"
            ),
            checkoutAttemptKeyCandidates: [keys.legacy],
          })
        );
        yield* repository.acquireDraft(
          makeDraftInput("divergent-identity", {
            checkoutAttemptKey: testCheckoutKey("divergent-identity-current"),
            checkoutAttemptIdentityKey: keys.identity,
            checkoutAttemptCompatibilityKey: testCheckoutKey(
              "divergent-identity-compatibility"
            ),
            checkoutAttemptKeyCandidates: [keys.identity],
          })
        );
      }).pipe(Effect.provide(repositoryLayer), Effect.runPromise);
      const rowsBefore = await readReservationIdentityState();
      let providerStarts = 0;
      const actionLayer = await makeProductionActionLayer(() => {
        providerStarts += 1;
      });
      const action = defineWorkspaceAction(
        {
          operation: "checkout.prepare-pay-state",
          schema: preparePayStateSchema,
        },
        (input) =>
          prepareWorkspacePayState(input, { keyDerivationTime }).pipe(
            Effect.provide(actionLayer)
          )
      );
      const errorLog = mock(() => undefined);
      const originalConsoleError = console.error;
      let result: Awaited<ReturnType<typeof action>>;
      try {
        console.error = errorLog;
        result = await action({
          locale: "en-US",
          checkoutSessionId,
          checkoutAttemptId,
          advertisedPriceToken,
          reservation,
          legalConsent: true,
        });
      } finally {
        console.error = originalConsoleError;
      }

      expect(result).toEqual({
        serverError: m.reservationErrorMessage({}, { locale: "en-US" }),
      });
      expect(providerStarts).toBe(0);
      expect(await readReservationIdentityState()).toEqual(rowsBefore);
      const emitted = JSON.stringify({ logs: errorLog.mock.calls, result });
      for (const sentinel of [
        checkoutSessionId,
        checkoutAttemptId,
        keys.identity,
        keys.legacy,
        "divergent-raw",
        "divergent-identity",
        "synthetic-customer",
      ]) {
        expect(emitted).not.toContain(sentinel);
      }
    } finally {
      setSystemTime();
    }
  });

  test("rolls back replacement identity conflicts and preserves the prior row", async () => {
    const layer = await makeRepositoryLayer();
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const result = await Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      const prior = requireCreatedDraft(
        yield* repository.acquireDraft(makeDraftInput("rollback-prior"))
      );
      const epoch = yield* repository.claimHoldCreation(prior.id);
      expect(epoch).toBeTypeOf("string");
      if (!epoch) throw new Error("Expected hold-creation epoch");
      const createdAt = Temporal.Instant.from("2099-06-10T10:00:00.000Z");
      yield* repository.beginProviderHoldCreation({ id: prior.id, epoch });
      yield* repository.recordProviderHoldCandidate({
        id: prior.id,
        epoch,
        dotyposReservationId: "rollback-prior-provider",
        reservationCreatedAt: createdAt,
      });
      yield* repository.attachHold({
        id: prior.id,
        epoch,
        dotyposReservationId: "rollback-prior-provider",
        reservationCreatedAt: createdAt,
      });
      // Model the accepted recovery-worker result after the database-clock
      // candidate fence has elapsed. The rollback scenario starts from an
      // already stabilized historical hold; it must not shortcut production
      // candidate stabilization.
      yield* Effect.promise(() =>
        assertionClient.query(
          `UPDATE "workspace_reservations"
           SET "failure_code" = $1
           WHERE "id" = $2 AND "reservation_state" = 'held'`,
          [`hold_creation_attached:${epoch}`, prior.id]
        )
      );
      const cancelling = yield* repository.claimSupersessionCancellation({
        id: prior.id,
        ownerId: "rollback-owner",
      });
      expect(cancelling?.reservationState).toBe("cancellation_claimed");
      const conflict = requireCreatedDraft(
        yield* repository.acquireDraft(makeDraftInput("rollback-conflict"))
      );
      const replacement = makeDraftInput("rollback-replacement", {
        checkoutAttemptIdentityKey: conflict.checkoutAttemptIdentityKey,
      });
      const failure = yield* repository
        .completeSupersessionAndCreateDraft({
          cancelledReservationId: prior.id,
          cancellationOwnerId: "rollback-owner",
          cancelledAt: createdAt.add({ seconds: 1 }),
          replacement,
        })
        .pipe(Effect.flip);
      const preserved = yield* repository.findById(prior.id);
      return { failure, preserved };
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(result.failure).toBeDefined();
    expect(result.preserved?.reservationState).toBe("cancellation_claimed");
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
  const providerId = `synthetic-provider-${input.winner}`;
  const providerCalls: string[] = [];
  const providerRelease = promiseWithResolvers<string>();
  const claimResults: { generation: WriterGeneration; claimed: boolean }[] = [];
  const [{ freezeCheckoutKeyDerivation }, { WorkspaceReservationRepository }] =
    await Promise.all([
      import(
        "@/features/checkout/backend/checkout/checkout-session-key.server"
      ),
      import("@/features/reservation/backend/workspace-reservation.repository"),
    ]);
  const derivation = freezeCheckoutKeyDerivation({
    now: () => new Date(input.currentTime),
  });
  const attemptKeys = derivation.attempt({
    checkoutSessionId,
    checkoutAttemptId,
    reservation,
  });
  const sessionKeys = derivation.session(checkoutSessionId);
  const draft = makeDraftInput(`mixed-${input.winner}-${input.currentTime}`, {
    checkoutSessionKey: sessionKeys.current,
    checkoutAttemptKey: attemptKeys.current,
    checkoutSessionIdentityKey: sessionKeys.identity,
    checkoutAttemptIdentityKey: attemptKeys.identity,
    checkoutSessionCompatibilityKey: sessionKeys.legacy,
    checkoutAttemptCompatibilityKey: attemptKeys.legacy,
    checkoutSessionKeyCandidates: sessionKeys.candidates,
    checkoutAttemptKeyCandidates: attemptKeys.candidates,
  });

  const run = async (generation: WriterGeneration) => {
    const modules =
      generation === "legacy"
        ? await loadImmutableWriterRequestLayerModules()
        : await loadCurrentRequestLayerModules();
    const layer = makeRequestLayer(
      {
        generation,
        gate,
        providerCalls,
        providerId,
        providerRelease,
        claimResults,
      },
      modules
    );
    return await Effect.gen(function* () {
      const repository = yield* modules.WorkspaceReservationRepository;
      if (generation === "legacy") {
        const legacyRepository = repository as typeof repository & {
          readonly createDraft: (
            input: CreateWorkspaceReservationInput
          ) => Effect.Effect<WorkspaceReservation>;
        };
        return yield* legacyRepository.createDraft(draft);
      }
      return yield* repository.acquireDraft(draft);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  };

  const results = await Promise.all([run("legacy"), run("current")]);
  const repositoryLayer = await makeRepositoryLayer();
  const observed = await Effect.gen(function* () {
    const repository = yield* WorkspaceReservationRepository;
    const reservation = yield* repository.findByAttemptKey(
      draft.checkoutAttemptKey
    );
    if (!reservation) return yield* Effect.die("Expected durable draft.");
    const epoch = yield* repository.claimHoldCreation(reservation.id);
    if (!epoch) return yield* Effect.die("Expected exactly one hold epoch.");
    expect(yield* repository.claimHoldCreation(reservation.id)).toBeNull();
    expect(
      yield* repository.beginProviderHoldCreation({ id: reservation.id, epoch })
    ).toBe(true);
    const candidate = {
      id: reservation.id,
      epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: Temporal.Instant.from("2099-06-10T10:00:00.000Z"),
    };
    yield* repository.recordProviderHoldCandidate(candidate);
    yield* repository.recordProviderHoldCandidate(candidate);
    yield* repository.attachHold(candidate);
    yield* repository.attachHold(candidate);
    return yield* repository.findById(reservation.id);
  }).pipe(Effect.provide(repositoryLayer), Effect.runPromise);

  expect(results).toHaveLength(2);
  expect(observed?.reservationState).toBe("held");
  expect(observed?.checkoutAttemptIdentityKey).toMatch(/^[a-f0-9]{64}$/);
  expect(observed?.checkoutAttemptCompatibilityKey).toMatch(/^[a-f0-9]{64}$/);
};

type WriterGeneration = "current" | "legacy";

const makeConcurrencyGate = (winner: WriterGeneration) => {
  const bothAtInsert = promiseWithResolvers<void>();
  const winnerCommitted = promiseWithResolvers<void>();
  const winnerClaimCompleted = promiseWithResolvers<void>();
  const claimsCompleted = promiseWithResolvers<void>();
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
    enterClaim: async (generation: WriterGeneration) => {
      claimEntrants += 1;
      if (generation !== winner) {
        await waitForBarrier(
          winnerClaimCompleted.promise,
          "claim",
          claimEntrants
        );
      }
    },
    markClaimCompleted: (generation: WriterGeneration) => {
      if (generation === winner) {
        winnerClaimCompleted.resolve();
        claimsCompleted.resolve();
      }
    },
    claimsCompleted: claimsCompleted.promise,
  };
};

type ConcurrencyGate = ReturnType<typeof makeConcurrencyGate>;

type RequestLayerInput = {
  readonly generation: WriterGeneration;
  readonly gate: ConcurrencyGate;
  readonly providerCalls: string[];
  readonly providerId: string;
  readonly providerRelease: ReturnType<typeof promiseWithResolvers<string>>;
  readonly claimResults: {
    generation: WriterGeneration;
    claimed: boolean;
  }[];
};

const loadCurrentRequestLayerModules = async () => {
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
    { WorkspaceReservationRepository, WorkspaceReservationRepositoryLive },
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

  return {
    BotProtectionService,
    CheckoutPricingService,
    DotyposService,
    LegalEvidenceEventRepository,
    PostHogEventService,
    ReservationHoldCleanupScheduleService,
    WorkspaceAvailabilityService,
    WorkspaceCheckoutAccessCodeService,
    WorkspaceDatabaseLive,
    WorkspaceLoggerLive,
    WorkspaceReservationRepository,
    WorkspaceReservationRepositoryLive,
    WorkspaceTableAssignmentService,
    affirmedDiscountAdvertisementQuoteCodec,
    buildCoworkReservationQuote,
  };
};

type RequestLayerModules = Awaited<
  ReturnType<typeof loadCurrentRequestLayerModules>
>;

const loadImmutableWriterRequestLayerModules =
  async (): Promise<RequestLayerModules> => {
    const [
      dotypos,
      checkoutPricing,
      checkoutQuote,
      discounts,
      botProtection,
      repositories,
      holds,
      reservationServices,
      availability,
      reservationRepository,
      database,
      posthog,
      currentLogging,
    ] = await Promise.all([
      import("@deskohub/dotypos"),
      importImmutableWriterModule(
        "features/checkout/backend/checkout/checkout-pricing.service.ts"
      ),
      importImmutableWriterModule(
        "features/checkout/checkout-quote.test-utils.ts"
      ),
      importImmutableWriterModule("features/discounts/index.ts"),
      importImmutableWriterModule(
        "shared/backend/bot-protection/bot-protection.service.ts"
      ),
      importImmutableWriterModule(
        "features/checkout/backend/repositories/index.ts"
      ),
      importImmutableWriterModule("features/checkout/backend/holds/index.ts"),
      importImmutableWriterModule(
        "features/checkout/backend/reservation/index.ts"
      ),
      importImmutableWriterModule(
        "features/reservation/backend/workspace-availability.service.ts"
      ),
      importImmutableWriterModule(
        "features/reservation/backend/workspace-reservation.repository.ts"
      ),
      importImmutableWriterModule("db/database.service.ts"),
      importImmutableWriterModule(
        "shared/backend/analytics/posthog-event.service.ts"
      ),
      import("@/shared/backend/logging/censorship"),
    ]);

    return {
      BotProtectionService: botProtection.BotProtectionService,
      CheckoutPricingService: checkoutPricing.CheckoutPricingService,
      DotyposService: dotypos.DotyposService,
      LegalEvidenceEventRepository: repositories.LegalEvidenceEventRepository,
      PostHogEventService: posthog.PostHogEventService,
      ReservationHoldCleanupScheduleService:
        holds.ReservationHoldCleanupScheduleService,
      WorkspaceAvailabilityService: availability.WorkspaceAvailabilityService,
      WorkspaceCheckoutAccessCodeService:
        reservationServices.WorkspaceCheckoutAccessCodeService,
      WorkspaceDatabaseLive: database.WorkspaceDatabaseLive,
      WorkspaceLoggerLive: currentLogging.WorkspaceLoggerLive,
      WorkspaceReservationRepository:
        reservationRepository.WorkspaceReservationRepository,
      WorkspaceReservationRepositoryLive:
        reservationRepository.WorkspaceReservationRepositoryLive,
      WorkspaceTableAssignmentService:
        reservationServices.WorkspaceTableAssignmentService,
      affirmedDiscountAdvertisementQuoteCodec:
        discounts.affirmedDiscountAdvertisementQuoteCodec,
      buildCoworkReservationQuote: checkoutQuote.buildCoworkReservationQuote,
    } as RequestLayerModules;
  };

const makeRequestLayer = (
  input: RequestLayerInput,
  modules: RequestLayerModules
) => {
  const {
    BotProtectionService,
    CheckoutPricingService,
    DotyposService,
    LegalEvidenceEventRepository,
    PostHogEventService,
    ReservationHoldCleanupScheduleService,
    WorkspaceAvailabilityService,
    WorkspaceCheckoutAccessCodeService,
    WorkspaceDatabaseLive,
    WorkspaceLoggerLive,
    WorkspaceReservationRepository,
    WorkspaceReservationRepositoryLive,
    WorkspaceTableAssignmentService,
    affirmedDiscountAdvertisementQuoteCodec,
    buildCoworkReservationQuote,
  } = modules;
  const repositoryBase = WorkspaceReservationRepositoryLive.pipe(
    Layer.provide(WorkspaceDatabaseLive)
  );
  const coordinatedRepository = Layer.effect(
    WorkspaceReservationRepository,
    Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      const legacyRepository = repository as typeof repository & {
        readonly createDraft?: (
          draft: CreateWorkspaceReservationInput
        ) => Effect.Effect<WorkspaceReservation>;
      };
      const acquireDraft = (draft: CreateWorkspaceReservationInput) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => input.gate.enterInsert(input.generation));
          const acquired = legacyRepository.createDraft
            ? {
                _tag: "created" as const,
                reservation: yield* legacyRepository.createDraft(draft),
              }
            : yield* repository.acquireDraft(draft);
          input.gate.markInsertCommitted(input.generation);
          return acquired;
        });
      const createDraft = (draft: CreateWorkspaceReservationInput) =>
        Effect.gen(function* () {
          yield* Effect.promise(() => input.gate.enterInsert(input.generation));
          if (legacyRepository.createDraft) {
            const created = yield* legacyRepository.createDraft(draft);
            input.gate.markInsertCommitted(input.generation);
            return created;
          }
          const acquired = yield* repository.acquireDraft(draft);
          input.gate.markInsertCommitted(input.generation);
          if (acquired.reservation) return acquired.reservation;
          return yield* Effect.die(
            "Current-only migration bridge received an acquisition without a reservation."
          );
        });
      return {
        ...repository,
        acquireDraft,
        // The immutable writer still invokes createDraft. This adapter stays
        // inside the mixed-version test coordinator; production exposes only
        // the tagged acquireDraft contract.
        createDraft,
        claimHoldCreation: (id) =>
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              input.gate.enterClaim(input.generation)
            );
            const claimed = yield* repository.claimHoldCreation(id);
            input.claimResults.push({
              generation: input.generation,
              claimed: Boolean(claimed),
            });
            input.gate.markClaimCompleted(input.generation);
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
          if (input.providerCalls.length > 1) {
            throw new Error("Provider creation invoked more than once.");
          }
          return { id: await input.providerRelease.promise } as never;
        }),
    } as never)
  );
};

const makeProductionActionLayer = async (onProviderStart: () => void) => {
  const modules = await loadCurrentRequestLayerModules();
  const {
    BotProtectionService,
    CheckoutPricingService,
    DotyposService,
    LegalEvidenceEventRepository,
    PostHogEventService,
    ReservationHoldCleanupScheduleService,
    WorkspaceAvailabilityService,
    WorkspaceCheckoutAccessCodeService,
    WorkspaceDatabaseLive,
    WorkspaceLoggerLive,
    WorkspaceReservationRepositoryLive,
    WorkspaceTableAssignmentService,
    affirmedDiscountAdvertisementQuoteCodec,
    buildCoworkReservationQuote,
  } = modules;
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
    WorkspaceReservationRepositoryLive.pipe(
      Layer.provide(WorkspaceDatabaseLive)
    ),
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
        Effect.sync(onProviderStart).pipe(
          Effect.andThen(Effect.die("Provider must not start."))
        ),
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
  const [
    { WorkspaceDatabaseLive },
    { WorkspaceReservationRepositoryLive },
    { WorkspaceLoggerLive },
  ] = await Promise.all([
    import("@/db/database.service"),
    import("@/features/reservation/backend/workspace-reservation.repository"),
    import("@/shared/backend/logging/censorship"),
  ]);
  return Layer.merge(
    WorkspaceLoggerLive,
    WorkspaceReservationRepositoryLive.pipe(
      Layer.provide(WorkspaceDatabaseLive)
    )
  );
};

const readReservationIdentityState = async () =>
  (
    await assertionClient.query<{
      checkout_attempt_compatibility_key: string;
      checkout_attempt_identity_key: string;
      checkout_attempt_key: string;
      checkout_session_compatibility_key: string;
      checkout_session_identity_key: string;
      checkout_session_key: string;
      dotypos_reservation_id: string | null;
      id: string;
      reservation_state: string;
      updated_at: Date;
    }>(`
      SELECT
        "id",
        "checkout_session_key",
        "checkout_attempt_key",
        "checkout_session_identity_key",
        "checkout_attempt_identity_key",
        "checkout_session_compatibility_key",
        "checkout_attempt_compatibility_key",
        "dotypos_reservation_id",
        "reservation_state",
        "updated_at"
      FROM "workspace_reservations"
      ORDER BY "id"
    `)
  ).rows;

const makeDraftInput = (
  suffix: string,
  overrides: Partial<CreateWorkspaceReservationInput> = {}
): CreateWorkspaceReservationInput => ({
  checkoutSessionKey: testCheckoutKey(`session-${suffix}`),
  checkoutAttemptKey: testCheckoutKey(`attempt-${suffix}`),
  checkoutSessionIdentityKey: testCheckoutKey(`session-identity-${suffix}`),
  checkoutAttemptIdentityKey: testCheckoutKey(`attempt-identity-${suffix}`),
  checkoutSessionCompatibilityKey: testCheckoutKey(
    `session-compatibility-${suffix}`
  ),
  checkoutAttemptCompatibilityKey: testCheckoutKey(
    `attempt-compatibility-${suffix}`
  ),
  checkoutSessionKeyCandidates: [
    testCheckoutKey(`session-${suffix}`),
    testCheckoutKey(`session-identity-${suffix}`),
  ],
  checkoutAttemptKeyCandidates: [
    testCheckoutKey(`attempt-${suffix}`),
    testCheckoutKey(`attempt-identity-${suffix}`),
  ],
  dotyposCustomerId: "synthetic-customer",
  customerAccessCode: `SYNTHETIC-${testCheckoutKey(suffix).slice(0, 16)}`,
  reservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  locale: "en-US",
  reservationHoldExpiresAt: Temporal.Instant.from("2099-06-10T12:00:00.000Z"),
  ...overrides,
});

const testCheckoutKey = (value: string) =>
  createHash("sha256").update(value).digest("hex");

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

const extractImmutableWriter = async () => {
  const git = (...args: readonly string[]) =>
    execFileSync("git", args, {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();

  expect(git("rev-parse", `${immutableWriterRevision}^{tree}`)).toBe(
    immutableWriterIdentity.tree
  );
  expect(
    git(
      "rev-parse",
      `${immutableWriterRevision}:apps/deskohub-workspace/features/reservation/actions/prepare-pay-state.ts`
    )
  ).toBe(immutableWriterIdentity.preparePayState);
  expect(
    git(
      "rev-parse",
      `${immutableWriterRevision}:apps/deskohub-workspace/features/reservation/backend/workspace-reservation.repository.ts`
    )
  ).toBe(immutableWriterIdentity.repository);
  expect(
    git(
      "rev-parse",
      `${immutableWriterRevision}:apps/deskohub-workspace/features/checkout/backend/checkout/checkout-session-key.server.ts`
    )
  ).toBe(immutableWriterIdentity.keyDerivation);
  expect(
    git(
      "rev-parse",
      `${immutableWriterRevision}:apps/deskohub-workspace/db/schema/workspace-reservations.ts`
    )
  ).toBe(immutableWriterIdentity.schema);

  const destination = await mkdtemp(
    join(tmpdir(), "workspace-immutable-writer-")
  );
  const archive = execFileSync(
    "git",
    [
      "archive",
      "--format=tar",
      immutableWriterRevision,
      "package.json",
      "tsconfig.json",
      "apps/deskohub-workspace",
    ],
    {
      cwd: repositoryRoot,
      maxBuffer: 100 * 1024 * 1024,
    }
  );
  execFileSync("tar", ["-x", "-C", destination], {
    input: archive,
    maxBuffer: 100 * 1024 * 1024,
  });
  await symlink(
    join(repositoryRoot, "node_modules"),
    join(destination, "node_modules")
  );
  await symlink(
    join(repositoryRoot, "apps/deskohub-workspace/node_modules"),
    join(destination, "apps/deskohub-workspace/node_modules")
  );
  await cp(
    join(repositoryRoot, "apps/deskohub-workspace/features/i18n/paraglide"),
    join(destination, "apps/deskohub-workspace/features/i18n/paraglide"),
    { recursive: true }
  );
  return destination;
};

const importImmutableWriterModule = (applicationPath: string) =>
  import(
    pathToFileURL(
      join(immutableWriterRoot, "apps/deskohub-workspace", applicationPath)
    ).href
  );

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
