import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
} from "@deskohub/igloohome";
import { NodeCrypto } from "@effect/platform-node";
import { Effect, Result } from "effect";
import { reservationAccessGrants } from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
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
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from reservation_access_grants where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const insertReservation = async () => {
      const { id } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "confirmed" },
        })
      );
      reservationIds.push(id);
      return id;
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
          Effect.provide(NodeCrypto.layer),
          Effect.provide(testDatabase.layer)
        )
      );

    const issueGrant = async (
      reservationId: WorkspaceReservationId,
      bounds: typeof target = target
    ) => {
      const accessCode = AlgoPinSchema.make("123456789");
      const grant = await run((repository) =>
        repository.ensure({ reservationId, ...bounds, replacingIssued: null })
      );
      expect(grant.accessName).toBe(`Deskohub ${grant.id}`);
      const startedAt = Temporal.Now.instant();
      expect(
        await run((repository) =>
          repository.claim({
            id: grant.id,
            reservationId,
            scheduledAccessStartsAt: bounds.scheduledAccessStartsAt,
            accessStartsAt: bounds.accessStartsAt,
            accessEndsAt: bounds.accessEndsAt,
            accessName: `Deskohub ${grant.id}`,
            startedAt,
          })
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

    test("keeps a grant created before names were stored unnamed until its next request", async () => {
      const reservationId = await insertReservation();
      // The previous deployment inserts grants without a name.
      await Effect.runPromise(
        testDatabase.db.insert(reservationAccessGrants).values({
          workspaceReservationId: reservationId,
          state: "failed",
          failedAt: Temporal.Now.instant(),
          failureCode: "provider_request_rejected",
          ...target,
        })
      );

      const ensured = await run((repository) =>
        repository.ensure({ reservationId, ...target, replacingIssued: null })
      );
      expect(ensured.state).toBe("pending");
      expect(ensured.accessName).toBeNull();

      await run((repository) =>
        repository.claim({
          id: ensured.id,
          reservationId,
          scheduledAccessStartsAt: target.scheduledAccessStartsAt,
          accessStartsAt: target.accessStartsAt,
          accessEndsAt: target.accessEndsAt,
          accessName: `Deskohub ${ensured.id}`,
          startedAt: Temporal.Now.instant(),
        })
      );
      const claimed = await run((repository) =>
        repository.findByReservationId(reservationId)
      );
      expect(claimed?.accessName).toBe(`Deskohub ${ensured.id}`);
    });

    test("keeps an issued grant when a concurrent request ensures the same target", async () => {
      const reservationId = await insertReservation();
      const { accessCode, grant } = await issueGrant(reservationId);

      // A request that read the grant before issuance completed must not
      // wipe the freshly issued PIN and provision a second credential.
      const ensured = await run((repository) =>
        repository.ensure({ reservationId, ...target, replacingIssued: null })
      );

      expect(ensured.id).toBe(grant.id);
      expect(ensured.state).toBe("issued");
      expect(ensured.accessName).toBe(`Deskohub ${grant.id}`);
      const loadedCode = await run((repository) =>
        repository.loadIssuedCode({
          id: grant.id,
          reservationId,
          scheduledAccessStartsAt: target.scheduledAccessStartsAt,
          accessStartsAt: target.accessStartsAt,
          accessEndsAt: target.accessEndsAt,
        })
      );
      // Compare inside the assertion so a failure never prints the PIN.
      expect(loadedCode === accessCode).toBe(true);
    });

    test("keeps a whole-hour grant an earlier release issued when a request ensures its exact span", async () => {
      const reservationId = await insertReservation();
      // Releases before exact spans store the whole hours the lock is
      // programmed with.
      const { accessCode, grant } = await issueGrant(reservationId);
      const exactSpan = {
        ...target,
        scheduledAccessStartsAt: Temporal.Instant.from("2030-03-04T08:45:00Z"),
        accessStartsAt: Temporal.Instant.from("2030-03-04T08:45:00Z"),
        accessEndsAt: Temporal.Instant.from("2030-03-04T16:30:00Z"),
      };

      // A request that read no issued grant, or one for other hours, before
      // that release issued this one must keep its PIN.
      for (const replacingIssued of [
        null,
        {
          ...target,
          accessEndsAt: Temporal.Instant.from("2030-03-04T19:00:00Z"),
        },
      ]) {
        const ensured = await run((repository) =>
          repository.ensure({ reservationId, ...exactSpan, replacingIssued })
        );
        expect(ensured.id).toBe(grant.id);
        expect(ensured.state).toBe("issued");
      }
      expect(
        await run((repository) =>
          repository.loadIssuedCode({
            id: grant.id,
            reservationId,
            scheduledAccessStartsAt: grant.scheduledAccessStartsAt,
            accessStartsAt: grant.accessStartsAt,
            accessEndsAt: grant.accessEndsAt,
          })
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
        repository.ensure({
          reservationId,
          ...moved,
          replacingIssued: target,
        })
      );

      expect(ensured.state).toBe("pending");
      expect(
        ensured.scheduledAccessStartsAt.equals(moved.scheduledAccessStartsAt)
      ).toBe(true);
      // The replaced credential stays findable in the Igloohome app until the
      // replacement's request records its own name.
      expect(ensured.accessName).toBe(`Deskohub ${ensured.id}`);
    });

    test("records a moved span on an issued grant and keeps its PIN", async () => {
      const reservationId = await insertReservation();
      const { accessCode, grant } = await issueGrant(reservationId);
      const moved = {
        scheduledAccessStartsAt: Temporal.Instant.from("2030-03-04T08:30:00Z"),
        accessStartsAt: Temporal.Instant.from("2030-03-04T08:30:00Z"),
        accessEndsAt: Temporal.Instant.from("2030-03-04T16:45:00Z"),
      };

      const rescheduled = await run((repository) =>
        repository.rescheduleIssued({
          id: grant.id,
          reservationId,
          from: target,
          to: moved,
          rescheduledAt: Temporal.Now.instant(),
        })
      );

      expect(rescheduled?.id).toBe(grant.id);
      expect(rescheduled?.state).toBe("issued");
      const stored = await run((repository) =>
        repository.findByReservationId(reservationId)
      );
      expect(
        stored?.scheduledAccessStartsAt.equals(moved.scheduledAccessStartsAt)
      ).toBe(true);
      expect(stored?.accessStartsAt.equals(moved.accessStartsAt)).toBe(true);
      expect(stored?.accessEndsAt.equals(moved.accessEndsAt)).toBe(true);
      expect(
        await run((repository) =>
          repository.loadIssuedCode({
            id: grant.id,
            reservationId,
            ...moved,
          })
        )
      ).toBe(accessCode);
    });

    test("leaves a grant that changed since it was read", async () => {
      const reservationId = await insertReservation();
      const { grant } = await issueGrant(reservationId);
      const staleRead = {
        ...target,
        scheduledAccessStartsAt: Temporal.Instant.from("2030-03-04T08:15:00Z"),
      };

      const rescheduled = await run((repository) =>
        repository.rescheduleIssued({
          id: grant.id,
          reservationId,
          from: staleRead,
          to: {
            ...target,
            scheduledAccessStartsAt: Temporal.Instant.from(
              "2030-03-04T08:30:00Z"
            ),
          },
          rescheduledAt: Temporal.Now.instant(),
        })
      );

      expect(rescheduled).toBeNull();
      const stored = await run((repository) =>
        repository.findByReservationId(reservationId)
      );
      expect(
        stored?.scheduledAccessStartsAt.equals(target.scheduledAccessStartsAt)
      ).toBe(true);
    });

    test("leaves a grant that is no longer issued", async () => {
      const reservationId = await insertReservation();
      const grant = await run((repository) =>
        repository.ensure({ reservationId, ...target, replacingIssued: null })
      );

      const rescheduled = await run((repository) =>
        repository.rescheduleIssued({
          id: grant.id,
          reservationId,
          from: target,
          to: {
            ...target,
            accessEndsAt: Temporal.Instant.from("2030-03-04T16:30:00Z"),
          },
          rescheduledAt: Temporal.Now.instant(),
        })
      );

      expect(rescheduled).toBeNull();
      const stored = await run((repository) =>
        repository.findByReservationId(reservationId)
      );
      expect(stored?.state).toBe("pending");
      expect(stored?.accessEndsAt.equals(target.accessEndsAt)).toBe(true);
    });

    test("keeps an issued grant rescheduled after the request read it", async () => {
      const reservationId = await insertReservation();
      const { accessCode, grant } = await issueGrant(reservationId);
      const rescheduled = {
        ...target,
        scheduledAccessStartsAt: Temporal.Instant.from("2030-03-04T08:30:00Z"),
        accessStartsAt: Temporal.Instant.from("2030-03-04T08:30:00Z"),
      };
      await run((repository) =>
        repository.rescheduleIssued({
          id: grant.id,
          reservationId,
          from: target,
          to: rescheduled,
          rescheduledAt: Temporal.Now.instant(),
        })
      );

      // A request that read the grant before it was rescheduled, or before
      // it was issued, must not reset the live credential.
      for (const replacingIssued of [target, null]) {
        const ensured = await run((repository) =>
          repository.ensure({
            reservationId,
            ...target,
            accessEndsAt: Temporal.Instant.from("2030-03-04T19:00:00Z"),
            replacingIssued,
          })
        );
        expect(ensured.state).toBe("issued");
      }
      expect(
        await run((repository) =>
          repository.loadIssuedCode({
            id: grant.id,
            reservationId,
            ...rescheduled,
          })
        )
      ).toBe(accessCode);
    });

    test("accepts a concurrent request recording the same moved span", async () => {
      const reservationId = await insertReservation();
      const { grant } = await issueGrant(reservationId);
      const moved = {
        ...target,
        scheduledAccessStartsAt: Temporal.Instant.from("2030-03-04T08:30:00Z"),
        accessStartsAt: Temporal.Instant.from("2030-03-04T08:30:00Z"),
      };
      const reschedule = () =>
        run((repository) =>
          repository.rescheduleIssued({
            id: grant.id,
            reservationId,
            from: target,
            to: moved,
            rescheduledAt: Temporal.Now.instant(),
          })
        );

      expect((await reschedule())?.state).toBe("issued");
      expect((await reschedule())?.state).toBe("issued");
    });

    test("lets only a request with the current scheduled bounds claim a grant and load its PIN", async () => {
      const reservationId = await insertReservation();
      const moved = {
        ...target,
        scheduledAccessStartsAt: Temporal.Instant.from("2030-03-04T10:00:00Z"),
        accessStartsAt: Temporal.Instant.from("2030-03-04T10:00:00Z"),
        accessEndsAt: Temporal.Instant.from("2030-03-04T19:00:00Z"),
      };
      // The stale request read the original hours, then an operator moved
      // the booking and a second request reset the grant to the new hours.
      const stale = await run((repository) =>
        repository.ensure({ reservationId, ...target })
      );
      const current = await run((repository) =>
        repository.ensure({ reservationId, ...moved })
      );
      expect(current.id).toBe(stale.id);

      const claimFor = (bounds: typeof target) =>
        run((repository) =>
          repository.claim({
            id: stale.id,
            reservationId,
            scheduledAccessStartsAt: bounds.scheduledAccessStartsAt,
            accessStartsAt: bounds.accessStartsAt,
            accessEndsAt: bounds.accessEndsAt,
            accessName: `Deskohub ${stale.id}`,
            startedAt: Temporal.Now.instant(),
          })
        );
      // Each bound alone decides the claim, whatever order requests run in.
      const staleStart = {
        ...moved,
        scheduledAccessStartsAt: target.scheduledAccessStartsAt,
      };
      const staleEnd = { ...moved, accessEndsAt: target.accessEndsAt };
      // After the reservation starts, a request in the next hour programs a
      // later start for the same scheduled bounds.
      const laterAccessStart = {
        ...moved,
        accessStartsAt: Temporal.Instant.from("2030-03-04T11:00:00Z"),
      };
      expect(await claimFor(staleStart)).toBe(false);
      expect(await claimFor(staleEnd)).toBe(false);
      expect(await claimFor(laterAccessStart)).toBe(false);
      const [staleClaimed, currentClaimed] = await Promise.all([
        claimFor(target),
        claimFor(moved),
      ]);
      expect(staleClaimed).toBe(false);
      expect(currentClaimed).toBe(true);

      const accessCode = AlgoPinSchema.make("987654321");
      await run((repository) =>
        repository.markIssued({
          id: current.id,
          reservationId,
          accessCode,
          pinId: IgloohomePinIdSchema.make("synthetic-moved-pin"),
          issuedAt: Temporal.Now.instant(),
        })
      );

      const loadFor = (bounds: typeof target) =>
        run((repository) =>
          repository
            .loadIssuedCode({
              id: current.id,
              reservationId,
              scheduledAccessStartsAt: bounds.scheduledAccessStartsAt,
              accessStartsAt: bounds.accessStartsAt,
              accessEndsAt: bounds.accessEndsAt,
            })
            .pipe(Effect.result)
        );
      const [
        staleLoad,
        staleStartLoad,
        staleEndLoad,
        laterAccessStartLoad,
        currentLoad,
      ] = await Promise.all([
        loadFor(target),
        loadFor(staleStart),
        loadFor(staleEnd),
        loadFor(laterAccessStart),
        loadFor(moved),
      ]);
      expect(Result.isFailure(staleLoad)).toBe(true);
      expect(Result.isFailure(staleStartLoad)).toBe(true);
      expect(Result.isFailure(staleEndLoad)).toBe(true);
      expect(Result.isFailure(laterAccessStartLoad)).toBe(true);
      expect(Result.isSuccess(currentLoad)).toBe(true);
      if (Result.isSuccess(currentLoad)) {
        expect(currentLoad.success === accessCode).toBe(true);
      }
    });
  }
);
