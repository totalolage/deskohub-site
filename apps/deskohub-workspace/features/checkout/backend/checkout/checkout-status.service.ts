import { DotyposService } from "@deskohub/dotypos";
import type { Customer } from "@deskohub/dotypos/generated";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer, Match, Option, Schema } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database-live.server";
import type { FulfillmentState, PaymentState } from "@/db/schema";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  getWorkspaceTableMap,
  type WorkspaceTableMap,
} from "@/features/checkout/workspace-table-map";
import { SeatingMapFeatureFlagService } from "@/features/feature-flags/backend";
import { WorkspaceFeatureFlagServiceLive } from "@/features/feature-flags/backend/workspace-feature-flag.server";
import {
  type WorkspaceReservation,
  type WorkspaceReservationDetailsMalformedError,
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getDotyposReservationTiming } from "@/features/reservation/backend/workspace-reservation.service";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import type { StoredMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import type { StoredOfficeReservationDetails } from "@/features/reservation/office-reservation";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { dotyposReservationSeatsSchema } from "@/features/reservation/reservation-seats";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import {
  ProviderPaymentFinalizationService,
  ProviderPaymentFinalizationServiceLiveWithDependencies,
} from "../payment/provider-payment-finalization.service";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "../repositories/payment-attempt.repository";
import type { PaymentLifecycleRepositoryError } from "../repositories/payment-lifecycle.repository";

export type CheckoutStatusReturnOutcome = "success" | "cancelled" | "unknown";

export type CheckoutStatusKind =
  | "not_found"
  | "created"
  | "pending"
  | "paid_waiting_fulfillment"
  | "fulfilled"
  | "fulfillment_failed"
  | "payment_failed"
  | "cancelled"
  | "expired";

type CheckoutReservationStatusKind = Exclude<CheckoutStatusKind, "not_found">;

type CheckoutStatusSummaryBase = {
  readonly price: WorkspaceMoney;
  readonly reservedFrom: Temporal.Instant;
  readonly reservedUntil: Temporal.Instant;
};

export type CheckoutCoworkStatusSummary = CheckoutStatusSummaryBase &
  StoredCoworkReservationDetails;

export type CheckoutMeetingRoomStatusSummary = CheckoutStatusSummaryBase &
  StoredMeetingRoomReservationDetails;

export type CheckoutOfficeStatusSummary = CheckoutStatusSummaryBase &
  StoredOfficeReservationDetails & { readonly seats: number };

export type CheckoutStatusSummary =
  | CheckoutCoworkStatusSummary
  | CheckoutMeetingRoomStatusSummary
  | CheckoutOfficeStatusSummary;

export type CheckoutStatusContactPrefill = {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
};

export type CheckoutStatusTableMap = WorkspaceTableMap;

type CheckoutStatusViewModelBase = {
  readonly orderId: WorkspaceReservationId;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
};

type CheckoutReservationStatusViewModelBase = CheckoutStatusViewModelBase & {
  readonly status: CheckoutReservationStatusKind;
  readonly paymentStatus: PaymentState;
  readonly fulfillmentStatus: FulfillmentState;
  readonly tableMap?: CheckoutStatusTableMap;
  readonly supportContactPrefill?: CheckoutStatusContactPrefill;
};

type CheckoutCoworkStatusViewModel = CheckoutReservationStatusViewModelBase & {
  readonly kind: "cowork";
  readonly summary?: CheckoutCoworkStatusSummary;
};

type CheckoutMeetingRoomStatusViewModel =
  CheckoutReservationStatusViewModelBase & {
    readonly kind: "meeting-room";
    readonly summary?: CheckoutMeetingRoomStatusSummary;
  };

type CheckoutOfficeStatusViewModel = CheckoutReservationStatusViewModelBase & {
  readonly kind: "office";
  readonly summary?: CheckoutOfficeStatusSummary;
};

type CheckoutStatusNotFoundViewModel = CheckoutStatusViewModelBase & {
  readonly status: "not_found";
  readonly summary?: undefined;
};

type CheckoutReservationStatusViewModel =
  | CheckoutCoworkStatusViewModel
  | CheckoutMeetingRoomStatusViewModel
  | CheckoutOfficeStatusViewModel;

export type CheckoutStatusViewModel =
  | CheckoutReservationStatusViewModel
  | CheckoutStatusNotFoundViewModel;

type CheckoutStatusReservationReconstruction =
  | {
      readonly kind: "cowork";
      readonly summary?: CheckoutCoworkStatusSummary;
    }
  | {
      readonly kind: "meeting-room";
      readonly summary?: CheckoutMeetingRoomStatusSummary;
    }
  | {
      readonly kind: "office";
      readonly summary?: CheckoutOfficeStatusSummary;
    };

type CheckoutStatusReconstruction = {
  readonly reservation: CheckoutStatusReservationReconstruction;
  readonly tableMap?: CheckoutStatusTableMap;
  readonly supportContactPrefill?: CheckoutStatusContactPrefill;
};

type CheckoutStatusError =
  | EffectDrizzleQueryError
  | PaymentLifecycleRepositoryError
  | WorkspaceReservationDetailsMalformedError;

export interface ICheckoutStatusService {
  readonly getStatus: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<CheckoutStatusViewModel, CheckoutStatusError>;
  readonly refreshStatus: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<CheckoutStatusViewModel, CheckoutStatusError>;
}

const toCheckoutStatusKind = (
  paymentState: PaymentState,
  fulfillmentState: FulfillmentState
): CheckoutReservationStatusKind => {
  if (paymentState === "paid") {
    switch (fulfillmentState) {
      case "fulfilled":
        return "fulfilled";
      case "failed":
        return "fulfillment_failed";
      case "processing":
      case "not_started":
        return "paid_waiting_fulfillment";
    }
  }

  switch (paymentState) {
    case "not_started":
      return "created";
    case "pending":
      return "pending";
    case "failed":
      return "payment_failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
  }
};

const canUseAttemptForSummary = (
  attempt: PaymentAttempt,
  reservation: WorkspaceReservation
) => {
  if (
    attempt.id === reservation.activePaymentAttemptId &&
    ["created", "pending", "paid"].includes(attempt.state)
  ) {
    return true;
  }

  return reservation.paymentState === "paid" && attempt.state === "paid";
};

const toOptionalString = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const getCustomerContactName = (customer: Customer) =>
  [customer.firstName, customer.lastName]
    .map(toOptionalString)
    .filter((part): part is string => Boolean(part))
    .join(" ") || toOptionalString(customer.companyName);

const getSupportContactPrefill = (
  customer: Customer
): CheckoutStatusContactPrefill | undefined => {
  const prefill: CheckoutStatusContactPrefill = {
    name: getCustomerContactName(customer),
    email: toOptionalString(customer.email),
    phone: toOptionalString(customer.phone),
  };

  return prefill.name || prefill.email || prefill.phone ? prefill : undefined;
};

const getEmptyCheckoutStatusReservation = (
  details: WorkspaceReservation["reservationDetails"]
): CheckoutStatusReservationReconstruction =>
  Match.value(details).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: () => ({ kind: "cowork" as const }),
      "meeting-room": () => ({ kind: "meeting-room" as const }),
      office: () => ({ kind: "office" as const }),
    })
  );

const implementation = Effect.gen(function* () {
  const reservations = yield* WorkspaceReservationRepository;
  const paymentAttempts = yield* PaymentAttemptRepository;
  const dotypos = yield* DotyposService;
  const finalization = yield* ProviderPaymentFinalizationService;
  const seatingMapFeatureFlag = yield* SeatingMapFeatureFlagService;

  const reconstructSummary = Effect.fn(
    "CheckoutStatusService.reconstructSummary"
  )(
    function* (reservation: WorkspaceReservation) {
      yield* Effect.logDebug("Checkout status summary reconstruction started");
      const emptyReconstruction: CheckoutStatusReconstruction = {
        reservation: getEmptyCheckoutStatusReservation(
          reservation.reservationDetails
        ),
      };

      if (!reservation.dotyposReservationId) {
        yield* Effect.logWarning(
          "Checkout status summary missing Dotypos reservation id"
        );
        return emptyReconstruction;
      }

      const attempt = yield* paymentAttempts.findDisplayableForReservation({
        workspaceReservationId: reservation.id,
        activePaymentAttemptId: reservation.activePaymentAttemptId ?? undefined,
        paymentState: reservation.paymentState,
      });
      yield* Effect.logDebug(
        "Checkout status summary attempt lookup completed"
      );

      if (!attempt) {
        yield* Effect.logWarning(
          "Checkout status summary missing payment attempt"
        );
        return emptyReconstruction;
      }
      yield* Effect.annotateLogsScoped({
        paymentAttemptId: attempt.id,
        paymentAttemptState: attempt.state,
      });

      if (!canUseAttemptForSummary(attempt, reservation)) {
        yield* Effect.logWarning(
          "Checkout status summary unusable payment attempt"
        );
        return emptyReconstruction;
      }

      const dotyposReservation = yield* dotypos
        .getReservation(reservation.dotyposReservationId)
        .pipe(
          Effect.tapError((cause) =>
            Effect.logWarning(
              "Checkout status summary reservation load failed",
              { cause }
            )
          ),
          Effect.orElseSucceed(() => undefined)
        );

      if (!dotyposReservation) {
        yield* Effect.logWarning(
          "Checkout status summary missing Dotypos reservation"
        );
        return emptyReconstruction;
      }
      yield* Effect.logDebug(
        "Checkout status summary Dotypos reservation loaded"
      );

      const tableMap = yield* Effect.suspend(() => dotypos.getTables()).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Checkout status table map load failed", {
            cause,
          })
        ),
        Effect.option,
        Effect.when(seatingMapFeatureFlag.isEnabled),
        Effect.map(Option.flatten),
        Effect.map(
          Option.map((tables) =>
            getWorkspaceTableMap(dotyposReservation.reservation, tables)
          )
        ),
        Effect.map(Option.getOrUndefined)
      );

      const timing = yield* getDotyposReservationTiming({
        reservationId: reservation.id,
        reservation: dotyposReservation.reservation,
      }).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning(
            "Checkout status summary reservation timing invalid",
            { cause }
          )
        ),
        Effect.orElseSucceed(() => undefined)
      );

      if (!timing) {
        const reconstruction: CheckoutStatusReconstruction = {
          reservation: emptyReconstruction.reservation,
          tableMap,
          supportContactPrefill: getSupportContactPrefill(
            dotyposReservation.customer
          ),
        };

        return reconstruction;
      }

      const statusReservation = Match.value(
        reservation.reservationDetails
      ).pipe(
        Match.discriminatorsExhaustive("kind")({
          cowork: (details) => ({
            kind: "cowork" as const,
            summary: {
              ...details,
              ...timing,
              price: attempt.amount,
            },
          }),
          "meeting-room": (details) => ({
            kind: "meeting-room" as const,
            summary: {
              ...details,
              ...timing,
              price: attempt.amount,
            },
          }),
          office: (details) => {
            const seats = Option.getOrUndefined(
              Schema.decodeUnknownOption(dotyposReservationSeatsSchema)(
                dotyposReservation.reservation.seats
              )
            );
            if (!seats) return { kind: "office" as const };

            return {
              kind: "office" as const,
              summary: {
                ...details,
                ...timing,
                price: attempt.amount,
                seats,
              },
            };
          },
        })
      );

      yield* Effect.logDebug("Checkout status summary reconstructed");

      const reconstruction: CheckoutStatusReconstruction = {
        reservation: statusReservation,
        tableMap,
        supportContactPrefill: getSupportContactPrefill(
          dotyposReservation.customer
        ),
      };

      return reconstruction;
    },
    (effect, reservation) =>
      effect.pipe(
        Effect.scoped,
        Effect.annotateLogs({
          reservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          reservationKind: reservation.reservationDetails.kind,
        })
      )
  );

  const getStatus = Effect.fn("CheckoutStatusService.getStatus")(
    function* (input: {
      readonly orderId: WorkspaceReservationId;
      readonly returnOutcome: CheckoutStatusReturnOutcome;
    }) {
      yield* Effect.logInfo("Checkout status lookup started");

      const reservation = yield* reservations.findById(input.orderId);
      yield* Effect.logDebug("Checkout status reservation lookup completed");

      if (!reservation) {
        const result: CheckoutStatusViewModel = {
          orderId: input.orderId,
          returnOutcome: input.returnOutcome,
          status: "not_found",
        };

        yield* Effect.annotateLogsScoped({ status: result.status });
        yield* Effect.logInfo("Checkout status lookup completed");

        return result;
      }

      const statusKind = toCheckoutStatusKind(
        reservation.paymentState,
        reservation.fulfillmentState
      );
      const timeoutReconstruction: CheckoutStatusReconstruction = {
        reservation: getEmptyCheckoutStatusReservation(
          reservation.reservationDetails
        ),
      };
      const reconstruction: CheckoutStatusReconstruction =
        yield* reconstructSummary(reservation).pipe(
          Effect.timeoutOrElse({
            duration: "8 seconds",
            orElse: () =>
              Effect.logWarning(
                "Checkout status summary reconstruction timed out",
                {
                  reservationId: reservation.id,
                  status: statusKind,
                }
              ).pipe(Effect.as(timeoutReconstruction)),
          })
        );

      const resultBase: CheckoutReservationStatusViewModelBase = {
        orderId: reservation.id,
        returnOutcome: input.returnOutcome,
        status: statusKind,
        paymentStatus: reservation.paymentState,
        fulfillmentStatus: reservation.fulfillmentState,
        tableMap: reconstruction.tableMap,
        supportContactPrefill:
          statusKind === "fulfillment_failed"
            ? reconstruction.supportContactPrefill
            : undefined,
      };
      const result: CheckoutReservationStatusViewModel = {
        ...resultBase,
        ...reconstruction.reservation,
      };

      yield* Effect.annotateLogsScoped({
        status: result.status,
        reservationKind: result.kind,
      });
      yield* Effect.logInfo("Checkout status lookup completed");

      return result;
    },
    (effect, input) =>
      effect.pipe(
        Effect.scoped,
        Effect.tapError((cause) =>
          Effect.logError("Checkout status lookup failed", { cause })
        ),
        Effect.annotateLogs({ ...input })
      )
  );

  return {
    getStatus,
    refreshStatus: Effect.fn("CheckoutStatusService.refreshStatus")(
      function* (input) {
        yield* Effect.logInfo("Checkout status refresh started");

        const reservation = yield* reservations.findById(input.orderId);
        yield* Effect.logDebug(
          "Checkout status refresh reservation lookup completed"
        );

        if (!reservation?.activePaymentAttemptId) {
          yield* Effect.logInfo(
            "Checkout status refresh skipped: no active payment attempt"
          );
          return yield* getStatus(input);
        }

        const result = yield* finalization.finalizePendingProviderPayment({
          orderId: reservation.id,
          paymentAttemptId: reservation.activePaymentAttemptId,
        });
        yield* Effect.annotateLogsScoped({ result });
        yield* Effect.logInfo("Checkout status refresh finalization completed");

        if (result !== "terminal") {
          if (
            result === "not_verifiable" ||
            result === "verification_mismatch"
          ) {
            yield* Effect.logWarning(
              "Checkout status refresh finalization returned non-terminal",
              { result }
            );
          } else {
            yield* Effect.logInfo(
              "Checkout status refresh finalization returned non-terminal",
              { result }
            );
          }
        }

        const status = yield* getStatus(input);
        yield* Effect.annotateLogsScoped(
          Match.value(status).pipe(
            Match.when({ status: "not_found" }, ({ status }) => ({ status })),
            Match.when({ kind: "cowork" }, ({ kind, status }) => ({
              status,
              reservationKind: kind,
            })),
            Match.when({ kind: "meeting-room" }, ({ kind, status }) => ({
              status,
              reservationKind: kind,
            })),
            Match.when({ kind: "office" }, ({ kind, status }) => ({
              status,
              reservationKind: kind,
            })),
            Match.exhaustive
          )
        );
        yield* Effect.logInfo("Checkout status refresh completed");

        return status;
      },
      (effect, input) =>
        effect.pipe(
          Effect.scoped,
          Effect.tapError((cause) =>
            Effect.logError("Checkout status refresh failed", { cause })
          ),
          Effect.annotateLogs({ ...input })
        )
    ),
  };
});

export class CheckoutStatusService extends Context.Service<
  CheckoutStatusService,
  ICheckoutStatusService
>()("@deskohub-workspace/checkout/CheckoutStatusService") {
  static Live = Layer.effect(this, implementation);

  static LiveWithDependencies = this.Live.pipe(
    Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(DotyposServiceLive),
    Layer.provide(
      SeatingMapFeatureFlagService.Live.pipe(
        Layer.provide(WorkspaceFeatureFlagServiceLive)
      )
    )
  );
}
