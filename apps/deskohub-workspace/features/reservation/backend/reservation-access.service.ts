import { DotyposService } from "@deskohub/dotypos";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceCheckoutAccessCodeService } from "@/features/checkout/backend/reservation/access-code.service";
import type { Locale } from "@/features/i18n";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import { ReservationAuthorizationService } from "@/features/reservation/backend/reservation-authorization.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { getDotyposReservationAccessTiming } from "@/features/reservation/backend/workspace-reservation.service";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationAccessToken } from "@/features/reservation/reservation-access-token";
import { ReservationAccessIssuanceError } from "@/features/reservation-access";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

export type ReservationAccessViewModel =
  | {
      readonly state: "available";
      readonly code: string;
      readonly accessStartsAt: Temporal.Instant;
      readonly accessEndsAt: Temporal.Instant;
    }
  | { readonly state: "invalid_link" }
  | {
      readonly state: "unavailable";
      readonly reason: ReservationAccessUnavailableReason;
    };

/**
 * Why a code can't be shown: the reservation's state doesn't grant one (not
 * paid or confirmed, or issuance refuses it, such as once it ended), or a
 * lookup it needs failed and a later try may succeed.
 */
type ReservationAccessUnavailableReason = "reservation-state" | "lookup-failed";

export interface IReservationAccessService {
  readonly getAccess: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly locale: Locale;
    readonly accessCookie?: string;
    readonly accessToken?: ReservationAccessToken;
  }) => Effect.Effect<ReservationAccessViewModel>;
}

const invalidLinkAccess: ReservationAccessViewModel = { state: "invalid_link" };
const unavailableAccess = (
  reason: ReservationAccessUnavailableReason
): ReservationAccessViewModel => ({ state: "unavailable", reason });

/**
 * Bounds the live Dotypos lookup, including its retries, well inside the
 * access route's 30-second `maxDuration`, so a slow Dotypos still lets the
 * page render its unavailable state. Matches the status page's cap.
 */
const providerLookupDeadline = "8 seconds";

const implementation = Effect.gen(function* () {
  const reservations = yield* WorkspaceReservationRepository;
  const authorization = yield* ReservationAuthorizationService;
  const dotypos = yield* DotyposService;
  const accessCodes = yield* WorkspaceCheckoutAccessCodeService;

  const getAccess = Effect.fn("ReservationAccessService.getAccess")(
    function* (input: {
      readonly orderId: WorkspaceReservationId;
      readonly locale: Locale;
      readonly accessCookie?: string;
      readonly accessToken?: ReservationAccessToken;
    }) {
      const authorized = yield* authorization.isAuthorized({
        ...input,
        permission: "view-access-code",
      });
      if (!authorized) return invalidLinkAccess;

      const reservation = yield* reservations.findById(input.orderId).pipe(
        Effect.map((found) => found ?? "missing"),
        Effect.tapError(() =>
          Effect.logWarning("Reservation access lookup failed")
        ),
        Effect.orElseSucceed(() => "failed" as const)
      );
      if (reservation === "failed") return unavailableAccess("lookup-failed");
      if (
        reservation === "missing" ||
        reservation.paymentState !== "paid" ||
        reservation.reservationState !== "confirmed" ||
        !reservation.dotyposReservationId
      ) {
        return unavailableAccess("reservation-state");
      }

      const providerReservation = yield* dotypos
        .getReservation(reservation.dotyposReservationId)
        .pipe(
          Effect.map(Option.getOrUndefined),
          Effect.timeoutOrElse({
            duration: providerLookupDeadline,
            orElse: () =>
              Effect.logWarning(
                "Reservation access provider lookup timed out"
              ).pipe(Effect.as("failed" as const)),
          }),
          Effect.tapError(() =>
            Effect.logWarning("Reservation access provider lookup failed")
          ),
          Effect.orElseSucceed(() => "failed" as const)
        );
      if (providerReservation === "failed") {
        return unavailableAccess("lookup-failed");
      }
      if (providerReservation?.reservation.status !== "CONFIRMED") {
        return unavailableAccess("reservation-state");
      }

      const timing = yield* getDotyposReservationAccessTiming({
        reservationId: reservation.id,
        reservation: decodeBookedReservation(
          providerReservation.reservation,
          reservation.reservationDetails
        ),
      }).pipe(
        Effect.tapError(() =>
          Effect.logWarning("Reservation access timing is invalid")
        ),
        Effect.orElseSucceed(() => undefined)
      );
      if (!timing) return unavailableAccess("lookup-failed");

      return yield* accessCodes
        .resolveCustomerAccessCode({
          reservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          ...timing,
        })
        .pipe(
          Effect.flatMap((access) =>
            Schema.decodeUnknownEffect(Schema.NonEmptyString)(access.code).pipe(
              Effect.map(
                (code): ReservationAccessViewModel => ({
                  state: "available",
                  code,
                  accessStartsAt: access.accessStartsAt,
                  accessEndsAt: access.accessEndsAt,
                })
              )
            )
          ),
          Effect.tapError(() =>
            Effect.logError("Reservation access code resolution failed")
          ),
          Effect.catch((failure) =>
            Effect.succeed(
              unavailableAccess(
                failure instanceof ReservationAccessIssuanceError &&
                  failure.refusal
                  ? "reservation-state"
                  : "lookup-failed"
              )
            )
          )
        );
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs({
          orderId: input.orderId,
          locale: input.locale,
          hasAccessCookie: input.accessCookie !== undefined,
          hasAccessToken: input.accessToken !== undefined,
        })
      )
  );

  return { getAccess };
});

export class ReservationAccessService extends Context.Service<
  ReservationAccessService,
  IReservationAccessService
>()("@deskohub-workspace/reservation/ReservationAccessService") {
  static Default = Layer.effect(this, implementation);

  /**
   * The service deciding who may see a code through `authorization`, such as
   * one reading the customer API's session.
   */
  static withAuthorization = <E, R>(
    authorization: Layer.Layer<ReservationAuthorizationService, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(WorkspaceReservationRepository.Default),
      Layer.provide(authorization),
      Layer.provide(WorkspaceDatabase.Default),
      Layer.provide(WorkspaceDotyposLayer),
      Layer.provide(WorkspaceCheckoutAccessCodeService.Live)
    );

  static Live = this.withAuthorization(ReservationAuthorizationService.Live);
}
