import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { type ReservationState, workspaceReservations } from "@/db/schema";
import {
  type CheckoutAttemptKey,
  type CheckoutSessionKey,
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
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
  }
);
