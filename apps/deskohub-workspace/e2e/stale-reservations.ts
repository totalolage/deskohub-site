import type { Customer, Reservation } from "@deskohub/dotypos/generated";
import { Effect, Exit } from "effect";

export type WorkspaceE2EStaleReservationReport = {
  readonly activeCandidateCount: number;
  readonly cancellationAttemptCount: number;
  readonly cancellationConverged: boolean | null;
  readonly cancellationFailureCount: number;
  readonly detailReadFailureCount: number;
  readonly identifiedStaleE2ECount: number;
};

interface StaleReservationDependencies<E, R> {
  readonly cancelReservation: (
    reservationId: string
  ) => Effect.Effect<void, E, R>;
  readonly listActiveReservations: (
    interval: StaleReservationInterval
  ) => Effect.Effect<readonly Reservation[], E, R>;
  readonly loadReservation: (
    reservationId: string
  ) => Effect.Effect<
    { readonly customer: Customer; readonly reservation: Reservation },
    E,
    R
  >;
  readonly waitForCancellationConvergence: (
    reservationIds: readonly string[]
  ) => Effect.Effect<void, E, R>;
}

interface StaleReservationInterval {
  readonly endDate: Date;
  readonly startDate: Date;
}

const providerConcurrency = 5;

export const reconcileStaleWorkspaceE2EReservations = <E, R>(
  interval: StaleReservationInterval,
  apply: boolean,
  dependencies: StaleReservationDependencies<E, R>
): Effect.Effect<WorkspaceE2EStaleReservationReport, E, R> =>
  Effect.gen(function* () {
    const reservations = yield* dependencies.listActiveReservations(interval);
    const detailResults = yield* Effect.all(
      reservations.map((reservation) => {
        const reservationId = reservation.id?.trim();
        if (!reservationId) {
          return Effect.succeed({ _tag: "MissingId" as const });
        }

        return Effect.exit(dependencies.loadReservation(reservationId)).pipe(
          Effect.map((exit) => ({
            _tag: "Read" as const,
            exit,
            reservationId,
          }))
        );
      }),
      { concurrency: providerConcurrency }
    );
    const detailReadFailureCount = detailResults.filter(
      (result) =>
        result._tag === "MissingId" || Exit.isFailure(result.exit)
    ).length;
    const reservationIds = [
      ...new Set(
        detailResults.flatMap((result) =>
          result._tag === "Read" &&
          Exit.isSuccess(result.exit) &&
          isWorkspaceE2ETestCustomer(result.exit.value.customer)
            ? [result.reservationId]
            : []
        )
      ),
    ];
    const baseReport = {
      activeCandidateCount: reservations.length,
      cancellationAttemptCount: 0,
      cancellationConverged: null,
      cancellationFailureCount: 0,
      detailReadFailureCount,
      identifiedStaleE2ECount: reservationIds.length,
    } satisfies WorkspaceE2EStaleReservationReport;

    if (!apply || detailReadFailureCount > 0) return baseReport;
    if (reservationIds.length === 0) {
      return { ...baseReport, cancellationConverged: true };
    }

    const cancellationExits = yield* Effect.all(
      reservationIds.map((reservationId) =>
        Effect.exit(dependencies.cancelReservation(reservationId))
      ),
      { concurrency: providerConcurrency }
    );
    const cancellationFailureCount = cancellationExits.filter(
      Exit.isFailure
    ).length;

    if (cancellationFailureCount > 0) {
      return {
        ...baseReport,
        cancellationAttemptCount: reservationIds.length,
        cancellationConverged: false,
        cancellationFailureCount,
      };
    }

    const convergenceExit = yield* Effect.exit(
      dependencies.waitForCancellationConvergence(reservationIds)
    );

    return {
      ...baseReport,
      cancellationAttemptCount: reservationIds.length,
      cancellationConverged: Exit.isSuccess(convergenceExit),
    };
  });

export const isWorkspaceE2ETestCustomer = (customer: Customer) => {
  const name = [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  const email = customer.email?.trim().toLowerCase();

  return (
    name.startsWith("Workspace E2E ") &&
    email?.startsWith("delivered+") === true &&
    email.endsWith("@resend.dev")
  );
};
