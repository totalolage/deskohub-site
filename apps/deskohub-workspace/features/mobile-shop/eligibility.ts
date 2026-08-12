import {
  type DotyposCustomerId,
  type DotyposReservationId,
  type DotyposReservationStatus,
  DotyposService,
} from "@deskohub/dotypos";
import { Context, Effect, Layer, Schema } from "effect";
import { normalizeReservationIntervalFields } from "@/features/reservation/reservation-interval-normalization";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import { MobileShopFailure } from "./errors";

export interface MobileShopReservationCandidate {
  readonly id: DotyposReservationId;
  readonly status: DotyposReservationStatus;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
}

export interface MobileShopDayInterval {
  readonly date: ReturnType<typeof plainDateStringSchema.make>;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
}

export type MobileShopEntitlement =
  | {
      readonly kind: "eligible";
      readonly day: MobileShopDayInterval;
      readonly reservationId: DotyposReservationId;
    }
  | {
      readonly kind: "locked";
      readonly reason: "no_active_reservation";
      readonly day: MobileShopDayInterval;
    };

export const getCurrentMobileShopDay = (
  now: Temporal.Instant
): MobileShopDayInterval => {
  const localDate = now
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate();
  const startsAt = localDate
    .toZonedDateTime({
      timeZone: workspaceSiteConstants.location.timeZone,
      plainTime: Temporal.PlainTime.from("00:00"),
    })
    .toInstant();
  const endsAt = localDate
    .add({ days: 1 })
    .toZonedDateTime({
      timeZone: workspaceSiteConstants.location.timeZone,
      plainTime: Temporal.PlainTime.from("00:00"),
    })
    .toInstant();

  return {
    date: plainDateStringSchema.make(localDate.toString()),
    startsAt,
    endsAt,
  };
};

export const evaluateMobileShopEligibility = (input: {
  readonly now: Temporal.Instant;
  readonly reservations: readonly MobileShopReservationCandidate[];
}): MobileShopEntitlement => {
  const day = getCurrentMobileShopDay(input.now);
  const reservation = input.reservations
    .filter(
      (candidate) =>
        candidate.status === "CONFIRMED" &&
        Temporal.Instant.compare(candidate.startsAt, day.endsAt) < 0 &&
        Temporal.Instant.compare(candidate.endsAt, day.startsAt) > 0
    )
    .sort(
      (left, right) =>
        Temporal.Instant.compare(left.startsAt, right.startsAt) ||
        left.id.localeCompare(right.id)
    )[0];

  return reservation
    ? { kind: "eligible", day, reservationId: reservation.id }
    : { kind: "locked", reason: "no_active_reservation", day };
};

export interface IMobileShopReservationSource {
  readonly listForDay: (input: {
    readonly customerId: DotyposCustomerId;
    readonly day: MobileShopDayInterval;
  }) => Effect.Effect<
    readonly MobileShopReservationCandidate[],
    MobileShopFailure
  >;
}

export class MobileShopReservationSource extends Context.Service<
  MobileShopReservationSource,
  IMobileShopReservationSource
>()("@deskohub-workspace/mobile-shop/MobileShopReservationSource") {
  static Unavailable = Layer.succeed(this, {
    listForDay: Effect.fn("MobileShopReservationSource.unavailable")(() =>
      MobileShopFailure.integrationUnavailable(
        "The customer-aware Dotypos reservation operation has not been installed."
      )
    ),
  });

  static Dotypos = Layer.effect(
    this,
    Effect.gen(function* () {
      const dotypos = yield* DotyposService;
      const decodeProviderInterval = Schema.decodeUnknownEffect(
        Schema.Struct({
          startsAt: instantStringSchema,
          endsAt: instantStringSchema,
        })
      );

      return {
        listForDay: Effect.fn("MobileShopReservationSource.listForDay")(
          function* (input) {
            const providerReservations = yield* dotypos
              .listActiveReservationsOverlapping({
                startDate: new Date(input.day.startsAt.epochMilliseconds),
                endDate: new Date(input.day.endsAt.epochMilliseconds),
              })
              .pipe(Effect.mapError(mapReservationSourceFailure));
            const candidates: MobileShopReservationCandidate[] = [];

            for (const reservation of providerReservations) {
              if (
                !reservation.id ||
                reservation._customerId !== input.customerId
              ) {
                continue;
              }
              const interval = yield* decodeProviderInterval({
                startsAt: reservation.startDate,
                endsAt: reservation.endDate,
              }).pipe(
                Effect.flatMap((decoded) =>
                  normalizeReservationIntervalFields(
                    decoded,
                    workspaceSiteConstants.location.timeZone
                  )
                ),
                Effect.mapError(mapReservationSourceFailure)
              );
              candidates.push({
                id: reservation.id,
                status: reservation.status,
                startsAt: Temporal.Instant.from(interval.startsAt),
                endsAt: Temporal.Instant.from(interval.endsAt),
              });
            }
            return candidates;
          }
        ),
      } satisfies IMobileShopReservationSource;
    })
  );
}

export interface IMobileShopEntitlementService {
  readonly evaluate: (input: {
    readonly customerId: DotyposCustomerId;
    readonly now: Temporal.Instant;
  }) => Effect.Effect<MobileShopEntitlement, MobileShopFailure>;
}

const mapReservationSourceFailure = (cause: unknown) =>
  new MobileShopFailure({ code: "service_unavailable", cause });

export class MobileShopEntitlementService extends Context.Service<
  MobileShopEntitlementService,
  IMobileShopEntitlementService
>()("@deskohub-workspace/mobile-shop/MobileShopEntitlementService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const reservations = yield* MobileShopReservationSource;

      return {
        evaluate: Effect.fn("MobileShopEntitlementService.evaluate")(
          function* (input) {
            const day = getCurrentMobileShopDay(input.now);
            const candidates = yield* reservations.listForDay({
              customerId: input.customerId,
              day,
            });
            return evaluateMobileShopEligibility({
              now: input.now,
              reservations: candidates,
            });
          }
        ),
      } satisfies IMobileShopEntitlementService;
    })
  );
}
