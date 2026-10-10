import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
} from "@deskohub/igloohome";
import { Effect } from "effect";
import { workspaceReservations } from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ReservationAccessRepository } from "./reservation-access.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const deviceId = IgloohomeDeviceIdSchema.make("synthetic-keypad");
const target = {
  deviceId,
  scheduledAccessStartsAt: Temporal.Instant.from("2030-03-04T08:00:00Z"),
  accessStartsAt: Temporal.Instant.from("2030-03-04T08:00:00Z"),
  accessEndsAt: Temporal.Instant.from("2030-03-04T17:00:00Z"),
};

describe.skipIf(!testDatabase)(
  "ReservationAccessRepository on disposable Postgres",
  () => {
    const postgres = testDatabase;
    if (!postgres) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await postgres.pool.query(
        "delete from reservation_access_grants where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await postgres.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const insertReservation = async () => {
      const id = crypto.randomUUID();
      const reservationId = workspaceReservationIdSchema.make(
        `reservation-${id}`
      );
      reservationIds.push(reservationId);
      await Effect.runPromise(
        postgres.db.insert(workspaceReservations).values({
          id: reservationId,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${id}`),
          dotyposCustomerId: DotyposCustomerIdSchema.make(`customer-${id}`),
          dotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-reservation-${id}`
          ),
          reservationState: "confirmed",
          paymentState: "not_started",
          fulfillmentState: "not_started",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
        })
      );
      return reservationId;
    };

    const run = <A, E>(
      operation: (
        repository: typeof ReservationAccessRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* ReservationAccessRepository);
        }).pipe(
          Effect.provide(ReservationAccessRepository.Default),
          Effect.provide(postgres.layer)
        )
      );

    const issueGrant = async (reservationId: WorkspaceReservationId) => {
      const accessCode = AlgoPinSchema.make("123456789");
      const grant = await run((repository) =>
        repository.ensure({ reservationId, ...target })
      );
      const startedAt = Temporal.Now.instant();
      expect(
        await run((repository) =>
          repository.claim({ id: grant.id, reservationId, startedAt })
        )
      ).toBe(true);
      await run((repository) =>
        repository.markIssued({
          id: grant.id,
          reservationId,
          accessCode,
          pinId: IgloohomePinIdSchema.make("synthetic-pin"),
          issuedAt: Temporal.Now.instant(),
        })
      );
      return { accessCode, grant };
    };

    test("keeps an issued grant when a concurrent request ensures the same target", async () => {
      const reservationId = await insertReservation();
      const { accessCode, grant } = await issueGrant(reservationId);

      // A request that read the grant before issuance completed must not
      // wipe the freshly issued PIN and provision a second credential.
      const ensured = await run((repository) =>
        repository.ensure({ reservationId, ...target })
      );

      expect(ensured.id).toBe(grant.id);
      expect(ensured.state).toBe("issued");
      expect(
        await run((repository) =>
          repository.loadIssuedCode({ id: grant.id, reservationId })
        )
      ).toBe(accessCode);
    });

    test("resets an issued grant when the reservation moves to a new interval", async () => {
      const reservationId = await insertReservation();
      await issueGrant(reservationId);
      const moved = {
        ...target,
        scheduledAccessStartsAt: Temporal.Instant.from("2030-03-05T08:00:00Z"),
        accessStartsAt: Temporal.Instant.from("2030-03-05T08:00:00Z"),
        accessEndsAt: Temporal.Instant.from("2030-03-05T17:00:00Z"),
      };

      const ensured = await run((repository) =>
        repository.ensure({ reservationId, ...moved })
      );

      expect(ensured.state).toBe("pending");
      expect(
        ensured.scheduledAccessStartsAt.equals(moved.scheduledAccessStartsAt)
      ).toBe(true);
    });
  }
);
