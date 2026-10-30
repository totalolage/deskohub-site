import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  AlgoPinSchema,
  IgloohomePinIdSchema,
  IgloohomeService,
} from "@deskohub/igloohome";
import { NodeCrypto } from "@effect/platform-node";
import { Deferred, Effect, Fiber, Layer, Option, Result } from "effect";
import { TestClock } from "effect/testing";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { getIgloohomeAccessWindow } from "./igloohome-access-window";
import { ReservationAccessRepository } from "./reservation-access.repository";
import { ReservationAccessService } from "./reservation-access.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

// 08:00–17:00 in Prague, opened again after it started.
const reservation = {
  reservedFrom: Temporal.Instant.from("2030-03-04T07:00:00Z"),
  reservedUntil: Temporal.Instant.from("2030-03-04T16:00:00Z"),
};
const beforeHour = Temporal.Instant.from("2030-03-04T09:59:59Z");
const afterHour = Temporal.Instant.from("2030-03-04T10:00:00Z");

const issuedPin = AlgoPinSchema.make("246813579");

interface ClaimGate {
  readonly reached: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
}

describe.skipIf(!testDatabase)(
  "ReservationAccessService on disposable Postgres",
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

    test.each([
      { first: beforeHour, second: afterHour },
      { first: afterHour, second: beforeHour },
    ])(
      "keeps exact bounds and one issuance when requests at $first and $second straddle an hour",
      async ({ first, second }) => {
        const reservationId = await insertReservation();
        const requestedHours: { startsAt: string; endsAt: string }[] = [];
        const gates: ClaimGate[] = [];

        // Each claim waits for the test, so both requests store their
        // target before either claims it.
        const gatedRepository = Layer.effect(
          ReservationAccessRepository,
          Effect.gen(function* () {
            const repository = yield* ReservationAccessRepository;
            let claims = 0;
            return ReservationAccessRepository.of({
              ...repository,
              claim: (input) =>
                Effect.gen(function* () {
                  const gate = gates[claims++];
                  if (gate) {
                    yield* Deferred.succeed(gate.reached, undefined);
                    yield* Deferred.await(gate.release);
                  }
                  return yield* repository.claim(input);
                }),
            });
          })
        ).pipe(Layer.provide(ReservationAccessRepository.Default));
        const igloohome = Layer.mock(IgloohomeService, {
          issueHourlyAlgoPin: ({ startsAt, endsAt }) =>
            Effect.sync(() => {
              requestedHours.push({ startsAt, endsAt });
              return {
                pin: issuedPin,
                pinId: IgloohomePinIdSchema.make("synthetic-straddle-pin"),
              };
            }),
        });

        await Effect.gen(function* () {
          const service = yield* ReservationAccessService;
          const issueAt = (now: Temporal.Instant) =>
            TestClock.setTime(now.epochMilliseconds).pipe(
              Effect.andThen(
                service.issueForReservation({ reservationId, ...reservation })
              ),
              Effect.provide(TestClock.layer()),
              Effect.result
            );
          // Fails at once rather than at the test timeout when a request
          // ends before it claims.
          const awaitClaim = <A>(gate: ClaimGate, request: Fiber.Fiber<A>) =>
            Effect.raceFirst(
              Deferred.await(gate.reached),
              Fiber.await(request).pipe(
                Effect.andThen(Effect.die("Request ended before claiming."))
              )
            );
          const gateFor = Effect.gen(function* () {
            const gate = {
              reached: yield* Deferred.make<void>(),
              release: yield* Deferred.make<void>(),
            };
            gates.push(gate);
            return gate;
          });

          const firstGate = yield* gateFor;
          const secondGate = yield* gateFor;
          const firstRequest = yield* Effect.forkChild(issueAt(first));
          yield* awaitClaim(firstGate, firstRequest);
          const secondRequest = yield* Effect.forkChild(issueAt(second));
          yield* awaitClaim(secondGate, secondRequest);

          yield* Deferred.succeed(firstGate.release, undefined);
          const firstResult = yield* Fiber.join(firstRequest);
          yield* Deferred.succeed(secondGate.release, undefined);
          const secondResult = yield* Fiber.join(secondRequest);

          const grant = yield* service.loadGrant(reservationId);
          expect(grant?.state).toBe("issued");
          if (!grant) return;
          expect(requestedHours).toHaveLength(1);
          const [requested] = requestedHours;
          if (!requested) return;
          expect(
            grant.scheduledAccessStartsAt.equals(reservation.reservedFrom)
          ).toBe(true);
          expect(grant.accessStartsAt.equals(reservation.reservedFrom)).toBe(
            true
          );
          expect(grant.accessEndsAt.equals(reservation.reservedUntil)).toBe(
            true
          );
          // The first claimant owns issuance; provider hours are adapter data,
          // independent of the exact reservation bounds both requests share.
          expect(requested).toEqual(
            Option.getOrNull(
              getIgloohomeAccessWindow({
                startsAt: reservation.reservedFrom,
                endsAt: reservation.reservedUntil,
                now: first,
              })
            )
          );

          const results = [firstResult, secondResult];
          const issued = results.filter(Result.isSuccess);
          expect(issued).toHaveLength(1);
          expect(
            issued[0]?.success.accessStartsAt.equals(grant.accessStartsAt)
          ).toBe(true);
          const [lost] = results.filter(Result.isFailure);
          expect(lost?.failure.outcome).toBe("uncertain");

          // The losing request's retry discloses the exact stored bounds and PIN
          // without programming the lock again.
          const retried = yield* issueAt(afterHour.add({ seconds: 5 }));
          expect(Result.isSuccess(retried)).toBe(true);
          if (Result.isSuccess(retried)) {
            expect(
              retried.success.accessStartsAt.equals(grant.accessStartsAt)
            ).toBe(true);
            expect(retried.success.accessCode === issuedPin).toBe(true);
          }
          expect(requestedHours).toHaveLength(1);
        }).pipe(
          Effect.provide(
            ReservationAccessService.Default.pipe(
              Layer.provide(Layer.mergeAll(gatedRepository, igloohome)),
              Layer.provide(NodeCrypto.layer),
              Layer.provide(testDatabase.layer)
            )
          ),
          Effect.runPromise
        );
      }
    );
  }
);
