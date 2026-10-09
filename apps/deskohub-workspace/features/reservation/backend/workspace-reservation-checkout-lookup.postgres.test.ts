import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { inArray } from "drizzle-orm";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import { type ReservationState, workspaceReservations } from "@/db/schema";
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

    // During phase 2 of a rotation, workers whose key rings contain both keys
    // in a different order can receive the same guest's first submission.
    test("creates one draft when workers with different active keys race a first submission", async () => {
      const {
        deriveCheckoutAttemptKeys,
        deriveCheckoutSessionKeys,
        deriveCheckoutSessionLockKey,
      } = await import(
        "@/features/checkout/backend/checkout/checkout-lookup-keys.server"
      );
      const originalKey = `original:${Buffer.alloc(32, 1).toString("base64url")}`;
      const rotatedKey = `rotated:${Buffer.alloc(32, 2).toString("base64url")}`;
      const reservation = Schema.decodeUnknownSync(reservationOrderSchema)({
        kind: "cowork",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+420 777 777 777",
        date: "2099-06-10",
        entryTier: "basic",
        coffee: false,
      });

      for (let round = 0; round < 5; round++) {
        const checkoutSessionId = checkoutSessionIdSchema.make(
          `session-${crypto.randomUUID()}`
        );
        const checkoutAttemptId = checkoutAttemptIdSchema.make(
          `attempt-${crypto.randomUUID()}`
        );
        const draftUnder = (keyRing: string) =>
          Effect.gen(function* () {
            const sessionKeys =
              yield* deriveCheckoutSessionKeys(checkoutSessionId);
            const attemptKeys = yield* deriveCheckoutAttemptKeys({
              checkoutSessionId,
              checkoutAttemptId,
              reservation,
            });
            return {
              checkoutSessionKey: sessionKeys.current,
              checkoutAttemptKey: attemptKeys.current,
              checkoutSessionLockKey:
                deriveCheckoutSessionLockKey(checkoutSessionId),
              acceptedCheckoutSessionKeys: sessionKeys.accepted,
              acceptedCheckoutAttemptKeys: attemptKeys.accepted,
              dotyposCustomerId: DotyposCustomerIdSchema.make(
                `customer-${round}`
              ),
              reservationPurpose: "personal" as const,
              reservationDetails: {
                kind: "cowork" as const,
                entryTier: "basic" as const,
                coffee: false,
              },
              locale: "en-US",
            };
          }).pipe(
            Effect.provideService(
              ConfigProvider.ConfigProvider,
              ConfigProvider.fromUnknown({ CHECKOUT_PAY_STATE_KEYS: keyRing })
            ),
            Effect.runSync
          );
        const firstWorker = draftUnder(`${originalKey},${rotatedKey}`);
        const secondWorker = draftUnder(`${rotatedKey},${originalKey}`);
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
        const rows = await postgres.db
          .select({
            id: workspaceReservations.id,
            checkoutSessionKey: workspaceReservations.checkoutSessionKey,
          })
          .from(workspaceReservations)
          .where(
            inArray(
              workspaceReservations.checkoutSessionKey,
              firstWorker.acceptedCheckoutSessionKeys
            )
          )
          .pipe(Effect.runPromise);
        fixtureReservationIds.push(...rows.map(({ id }) => id));

        expect(rows).toHaveLength(1);
        expect(drafts.map(({ id }) => id)).toEqual([rows[0]?.id, rows[0]?.id]);
        expect(
          new Set(drafts.map((draft) => draft.checkoutSessionKey)).size
        ).toBe(1);
      }
    });
  }
);
