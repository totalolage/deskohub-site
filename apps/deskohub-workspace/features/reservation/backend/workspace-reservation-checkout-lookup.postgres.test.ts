import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { type ReservationState, workspaceReservations } from "@/db/schema";
import {
  deriveCheckoutAttemptKeys,
  deriveCheckoutSessionKeys,
  deriveCheckoutSessionLockKey,
} from "@/features/checkout/backend/checkout/checkout-lookup-keys.server";
import {
  deriveRingKeyedCheckoutAttemptKey,
  deriveRingKeyedCheckoutSessionKey,
  findKeyIdPrefixedLookupKey,
} from "@/features/checkout/backend/checkout/checkout-lookup-keys.test-utils";
import {
  type CheckoutAttemptKey,
  type CheckoutSessionKey,
  checkoutAttemptIdSchema,
  checkoutAttemptKeySchema,
  checkoutSessionIdSchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { reservationOrderSchema } from "@/features/reservation/reservation-order";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CreateWorkspaceReservationDraftInput,
  type IWorkspaceReservationRepository,
  WorkspaceReservationRepository,
} from "./workspace-reservation.repository";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "WorkspaceReservationRepository checkout lookup across key rotation on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    let reservations: IWorkspaceReservationRepository;
    const fixtureReservationIds: WorkspaceReservationId[] = [];

    const uniqueKey = (label: string) => `${label}:${crypto.randomUUID()}`;

    const insertReservation = (input: {
      readonly checkoutSessionKey: CheckoutSessionKey;
      readonly checkoutAttemptKey: CheckoutAttemptKey;
      readonly reservationState: ReservationState;
      readonly createdAt: string;
    }) =>
      Effect.gen(function* () {
        const id = workspaceReservationIdSchema.make(
          `reservation-${crypto.randomUUID()}`
        );
        yield* postgres.db.insert(workspaceReservations).values({
          id,
          checkoutSessionKey: input.checkoutSessionKey,
          checkoutAttemptKey: input.checkoutAttemptKey,
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `customer-${crypto.randomUUID()}`
          ),
          reservationState: input.reservationState,
          paymentState: "not_started",
          fulfillmentState: "not_started",
          ...(input.reservationState === "cancelled" && {
            dotyposReservationId: `dotypos-${crypto.randomUUID()}` as never,
            reservationCancelledAt: Temporal.Instant.from(input.createdAt),
          }),
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
          createdAt: Temporal.Instant.from(input.createdAt),
        });
        fixtureReservationIds.push(id);
        return id;
      }).pipe(Effect.runPromise);

    beforeAll(async () => {
      reservations = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* WorkspaceReservationRepository;
        }).pipe(
          Effect.provide(
            WorkspaceReservationRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      );
    });

    afterEach(async () => {
      if (fixtureReservationIds.length === 0) return;
      await postgres.db
        .delete(workspaceReservations)
        .where(inArray(workspaceReservations.id, fixtureReservationIds))
        .pipe(Effect.runPromise);
      fixtureReservationIds.length = 0;
    });

    test("finds an attempt stored under any accepted derivation", async () => {
      const storedAttemptKey = checkoutAttemptKeySchema.make(
        uniqueKey("original")
      );
      const id = await insertReservation({
        checkoutSessionKey: checkoutSessionKeySchema.make(
          uniqueKey("original")
        ),
        checkoutAttemptKey: storedAttemptKey,
        reservationState: "draft",
        createdAt: "2026-01-01T12:00:00Z",
      });

      const found = await reservations
        .findByAttemptKeys([
          checkoutAttemptKeySchema.make(uniqueKey("rotated")),
          storedAttemptKey,
        ])
        .pipe(Effect.runPromise);
      const missing = await reservations
        .findByAttemptKeys([
          checkoutAttemptKeySchema.make(uniqueKey("rotated")),
        ])
        .pipe(Effect.runPromise);

      expect(found?.id).toBe(id);
      expect(missing).toBeNull();
    });

    test("returns the session key stored by the session's latest reservation", async () => {
      const storedSessionKey = checkoutSessionKeySchema.make(
        uniqueKey("original")
      );
      await insertReservation({
        checkoutSessionKey: storedSessionKey,
        checkoutAttemptKey: checkoutAttemptKeySchema.make(uniqueKey("attempt")),
        reservationState: "cancelled",
        createdAt: "2026-01-01T12:00:00Z",
      });

      const stored = await reservations
        .findStoredCheckoutSessionKey([
          checkoutSessionKeySchema.make(uniqueKey("rotated")),
          storedSessionKey,
        ])
        .pipe(Effect.runPromise);
      const unknown = await reservations
        .findStoredCheckoutSessionKey([
          checkoutSessionKeySchema.make(uniqueKey("rotated")),
        ])
        .pipe(Effect.runPromise);

      expect(stored).toBe(storedSessionKey);
      expect(unknown).toBeNull();
    });

    const keyRing = `original:${Buffer.alloc(32, 1).toString("base64url")}`;
    const rotatedKeyRing = `rotated:${Buffer.alloc(32, 2).toString("base64url")}`;
    const reservation = Schema.decodeUnknownSync(reservationOrderSchema)({
      kind: "cowork",
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420 777 777 777",
      date: "2099-06-10",
      entryTier: "basic",
      coffee: false,
    });

    const newSubmission = () => ({
      checkoutSessionId: checkoutSessionIdSchema.make(
        `session-${crypto.randomUUID()}`
      ),
      checkoutAttemptId: checkoutAttemptIdSchema.make(
        `attempt-${crypto.randomUUID()}`
      ),
      reservation,
    });
    type Submission = ReturnType<typeof newSubmission>;

    const draftDetails = {
      dotyposCustomerId: DotyposCustomerIdSchema.make("customer-id"),
      reservationPurpose: "personal" as const,
      reservationDetails: {
        kind: "cowork" as const,
        entryTier: "basic" as const,
        coffee: false,
      },
      locale: "en-US",
    };

    /**
     * Draft input as `prepare-pay-state` builds it. `stores` overrides the
     * format of the keys written to a new row, simulating a worker on the
     * other side of the prefixed-write flip; `current` is used otherwise.
     */
    const draftInput = (
      submission: Submission,
      options: {
        readonly keyRing: string;
        readonly stores?: "ring-keyed" | "key-id-prefixed";
      }
    ): CreateWorkspaceReservationDraftInput => {
      const activeKid = options.keyRing.slice(0, options.keyRing.indexOf(":"));
      const { sessionKeys, attemptKeys } = Effect.gen(function* () {
        return {
          sessionKeys: yield* deriveCheckoutSessionKeys(
            submission.checkoutSessionId
          ),
          attemptKeys: yield* deriveCheckoutAttemptKeys(submission),
        };
      }).pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            CHECKOUT_PAY_STATE_KEYS: options.keyRing,
          })
        ),
        Effect.runSync
      );

      return {
        ...draftDetails,
        ...{
          "ring-keyed": {
            checkoutSessionKey: deriveRingKeyedCheckoutSessionKey(
              options.keyRing,
              submission.checkoutSessionId
            ),
            checkoutAttemptKey: deriveRingKeyedCheckoutAttemptKey(
              options.keyRing,
              submission
            ),
          },
          "key-id-prefixed": {
            checkoutSessionKey: findKeyIdPrefixedLookupKey(
              sessionKeys,
              activeKid
            ),
            checkoutAttemptKey: findKeyIdPrefixedLookupKey(
              attemptKeys,
              activeKid
            ),
          },
          current: {
            checkoutSessionKey: sessionKeys.current,
            checkoutAttemptKey: attemptKeys.current,
          },
        }[options.stores ?? "current"],
        checkoutSessionLockKey: deriveCheckoutSessionLockKey(
          submission.checkoutSessionId
        ),
        acceptedCheckoutSessionKeys: sessionKeys.accepted,
        acceptedCheckoutAttemptKeys: attemptKeys.accepted,
      };
    };

    /**
     * `createDraft` of a worker from before keyed lookup keys: ring-keyed keys,
     * no advisory lock, and only exact-key lookups after a conflict.
     */
    const createDraftAsEarlierWorker = (submission: Submission) =>
      Effect.gen(function* () {
        const checkoutSessionKey = deriveRingKeyedCheckoutSessionKey(
          keyRing,
          submission.checkoutSessionId
        );
        const checkoutAttemptKey = deriveRingKeyedCheckoutAttemptKey(
          keyRing,
          submission
        );
        const [inserted] = yield* postgres.db
          .insert(workspaceReservations)
          .values({
            id: workspaceReservationIdSchema.make(
              `reservation-${crypto.randomUUID()}`
            ),
            checkoutSessionKey,
            checkoutAttemptKey,
            reservationState: "draft",
            paymentState: "not_started",
            fulfillmentState: "not_started",
            ...draftDetails,
          })
          .onConflictDoNothing()
          .returning({ id: workspaceReservations.id });
        if (inserted) return inserted.id;

        const [existingAttempt] = yield* postgres.db
          .select({ id: workspaceReservations.id })
          .from(workspaceReservations)
          .where(
            eq(workspaceReservations.checkoutAttemptKey, checkoutAttemptKey)
          )
          .limit(1);
        if (existingAttempt) return existingAttempt.id;

        const [currentAttempt] = yield* postgres.db
          .select({ id: workspaceReservations.id })
          .from(workspaceReservations)
          .where(
            and(
              eq(workspaceReservations.checkoutSessionKey, checkoutSessionKey),
              ne(workspaceReservations.reservationState, "cancelled")
            )
          )
          .orderBy(desc(workspaceReservations.createdAt))
          .limit(1);
        return currentAttempt?.id ?? null;
      }).pipe(Effect.runPromise);

    const sessionRows = async (input: CreateWorkspaceReservationDraftInput) => {
      const rows = await postgres.db
        .select({
          id: workspaceReservations.id,
          checkoutSessionKey: workspaceReservations.checkoutSessionKey,
          checkoutAttemptKey: workspaceReservations.checkoutAttemptKey,
        })
        .from(workspaceReservations)
        .where(
          inArray(
            workspaceReservations.checkoutSessionKey,
            input.acceptedCheckoutSessionKeys
          )
        )
        .pipe(Effect.runPromise);
      fixtureReservationIds.push(...rows.map(({ id }) => id));
      return rows;
    };

    const pollUntilBlockedBy = async (pid: number | undefined) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const { rowCount } = await postgres.pool.query(
          "select 1 from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))",
          [pid]
        );
        if (rowCount) return;
        await Bun.sleep(20);
      }
      throw new Error("The draft insert never waited on the other writer.");
    };

    // Rows stored by workers from before keyed lookup keys stay in flight
    // after those workers drain.
    test("resumes a draft an earlier worker stored for the same attempt", async () => {
      const submission = newSubmission();
      const input = draftInput(submission, { keyRing });

      const earlierId = await createDraftAsEarlierWorker(submission);
      const draft = await reservations
        .createDraft(input)
        .pipe(Effect.runPromise);

      expect(input.checkoutSessionKey).not.toBe(
        deriveRingKeyedCheckoutSessionKey(keyRing, submission.checkoutSessionId)
      );
      expect(draft.id).toBe(earlierId);
      expect(await sessionRows(input)).toHaveLength(1);
    });

    test("returns an attempt another writer stores after the draft lookup", async () => {
      const submission = newSubmission();
      const input = draftInput(submission, { keyRing });
      const writerId = workspaceReservationIdSchema.make(
        `reservation-${crypto.randomUUID()}`
      );
      fixtureReservationIds.push(writerId);

      // A writer that skips the draft lock keeps its row uncommitted until the
      // draft's insert waits on it, so the draft's lookups ran before the row
      // existed.
      const writer = await postgres.pool.connect();
      let pendingDraft: Promise<unknown> | undefined;
      try {
        await writer.query("begin");
        await drizzle({ client: writer })
          .insert(workspaceReservations)
          .values({
            id: writerId,
            checkoutSessionKey: input.checkoutSessionKey,
            checkoutAttemptKey: input.checkoutAttemptKey,
            reservationState: "cancelled",
            paymentState: "not_started",
            fulfillmentState: "not_started",
            dotyposReservationId: `dotypos-${crypto.randomUUID()}` as never,
            reservationCancelledAt: Temporal.Now.instant(),
            ...draftDetails,
          });
        const { rows } = await writer.query<{ readonly pid: number }>(
          "select pg_backend_pid()::int as pid"
        );
        const writerPid = rows[0]?.pid;

        const draft = reservations.createDraft(input).pipe(Effect.runPromise);
        pendingDraft = draft;
        await pollUntilBlockedBy(writerPid);
        await writer.query("commit");

        expect((await draft).id).toBe(writerId);
      } finally {
        await writer.query("rollback").catch(() => {});
        writer.release();
        // A draft that never waited on the other writer stores its own
        // row, so let it finish and register every row for cleanup.
        await pendingDraft?.catch(() => {});
        await sessionRows(input);
      }
    });

    // While the prefixed-write deployment rolls out, Vercel keeps finishing
    // in-flight requests on the ring-keyed-write deployment.
    test("creates one draft when ring-keyed and prefixed writers race a first submission", async () => {
      for (let round = 0; round < 5; round++) {
        const submission = newSubmission();
        const ringKeyedWriter = draftInput(submission, {
          keyRing,
          stores: "ring-keyed",
        });
        const prefixedWriter = draftInput(submission, {
          keyRing,
          stores: "key-id-prefixed",
        });
        expect(ringKeyedWriter.checkoutSessionKey).not.toBe(
          prefixedWriter.checkoutSessionKey
        );

        const drafts = await Effect.all(
          [
            reservations.createDraft(ringKeyedWriter),
            reservations.createDraft(prefixedWriter),
          ],
          { concurrency: "unbounded" }
        ).pipe(Effect.runPromise);
        const rows = await sessionRows(ringKeyedWriter);

        expect(rows).toHaveLength(1);
        expect(drafts.map(({ id }) => id)).toEqual([rows[0]?.id, rows[0]?.id]);
      }
    });

    // During the activate phase of a rotation, workers whose key rings contain
    // both keys in a different order can receive the same first submission.
    test("creates one draft when workers with different active keys race a first submission", async () => {
      for (let round = 0; round < 5; round++) {
        const submission = newSubmission();
        const firstWorker = draftInput(submission, {
          keyRing: `${keyRing},${rotatedKeyRing}`,
          stores: "key-id-prefixed",
        });
        const secondWorker = draftInput(submission, {
          keyRing: `${rotatedKeyRing},${keyRing}`,
          stores: "key-id-prefixed",
        });
        expect(firstWorker.checkoutSessionKey).not.toBe(
          secondWorker.checkoutSessionKey
        );

        const drafts = await Effect.all(
          [
            reservations.createDraft(firstWorker),
            reservations.createDraft(secondWorker),
          ],
          { concurrency: "unbounded" }
        ).pipe(Effect.runPromise);
        const rows = await sessionRows(firstWorker);

        expect(rows).toHaveLength(1);
        expect(drafts.map(({ id }) => id)).toEqual([rows[0]?.id, rows[0]?.id]);
        expect(
          new Set(drafts.map((draft) => draft.checkoutSessionKey)).size
        ).toBe(1);
      }
    });
  }
);
