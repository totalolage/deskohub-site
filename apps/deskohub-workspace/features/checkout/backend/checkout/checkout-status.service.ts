import { DotyposService } from "@deskohub/dotypos";
import type { Customer } from "@deskohub/dotypos/generated";
import { Context, Effect, Layer, Match } from "effect";
import {
  type DatabaseError,
  WorkspaceDatabaseLive,
} from "@/db/database.service";
import type {
  FulfillmentState,
  PaymentAttempt,
  PaymentState,
  WorkspaceReservation,
} from "@/db/schema";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  getWorkspaceTableMap,
  type WorkspaceTableMap,
} from "@/features/checkout/workspace-table-map";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type StoredCoworkReservationDetails,
  storedWorkspaceReservationDetailsSchema,
} from "@/features/reservation/schemas/stored-reservation-details";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "../holds/reservation-hold-cleanup.service";
import {
  ProviderPaymentFinalizationService,
  ProviderPaymentFinalizationServiceLiveWithDependencies,
} from "../payment/provider-payment-finalization.service";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "../repositories/payment-attempt.repository";

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

type WorkspaceCheckoutStatusSummaryBase = {
  readonly price: WorkspaceMoney;
  readonly reservedFrom: Date;
  readonly reservedUntil: Date;
};

type CoworkCheckoutStatusSummary = WorkspaceCheckoutStatusSummaryBase &
  StoredCoworkReservationDetails;

type MeetingRoomCheckoutStatusSummary = WorkspaceCheckoutStatusSummaryBase & {
  readonly _tag: "meeting-room";
};

export type WorkspaceCheckoutStatusSummary =
  | CoworkCheckoutStatusSummary
  | MeetingRoomCheckoutStatusSummary;

export type WorkspaceCheckoutStatusContactPrefill = {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
};

export type WorkspaceCheckoutTableMap = WorkspaceTableMap;

type CheckoutStatusViewModelBase = {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
  readonly status: CheckoutStatusKind;
  readonly paymentStatus?: PaymentState;
  readonly fulfillmentStatus?: FulfillmentState;
  readonly tableMap?: WorkspaceCheckoutTableMap;
  readonly supportContactPrefill?: WorkspaceCheckoutStatusContactPrefill;
};

export type CheckoutCoworkStatusViewModel = CheckoutStatusViewModelBase & {
  readonly _tag: "cowork";
  readonly summary?: CoworkCheckoutStatusSummary;
};

export type CheckoutMeetingRoomStatusViewModel = CheckoutStatusViewModelBase & {
  readonly _tag: "meeting-room";
  readonly summary: MeetingRoomCheckoutStatusSummary;
};

export type CheckoutStatusViewModel =
  | CheckoutCoworkStatusViewModel
  | CheckoutMeetingRoomStatusViewModel;

type CheckoutStatusReconstruction = {
  readonly summary?: WorkspaceCheckoutStatusSummary;
  readonly tableMap?: WorkspaceCheckoutTableMap;
  readonly supportContactPrefill?: WorkspaceCheckoutStatusContactPrefill;
};

export interface CheckoutStatusService {
  readonly getStatus: (input: {
    readonly orderId: string;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<CheckoutStatusViewModel, DatabaseError>;
  readonly refreshStatus: (input: {
    readonly orderId: string;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<CheckoutStatusViewModel, DatabaseError>;
}

export const CheckoutStatusService = Context.Service<CheckoutStatusService>(
  "CheckoutStatusService"
);

const toCheckoutStatusKind = (
  paymentState: PaymentState,
  fulfillmentState: FulfillmentState
): CheckoutStatusKind => {
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
): WorkspaceCheckoutStatusContactPrefill | undefined => {
  const prefill = {
    name: getCustomerContactName(customer),
    email: toOptionalString(customer.email),
    phone: toOptionalString(customer.phone),
  } satisfies WorkspaceCheckoutStatusContactPrefill;

  return prefill.name || prefill.email || prefill.phone ? prefill : undefined;
};

export const CheckoutStatusServiceLive = Layer.effect(
  CheckoutStatusService,
  Effect.gen(function* () {
    const reservations = yield* WorkspaceReservationRepository;
    const paymentAttempts = yield* PaymentAttemptRepository;
    const dotypos = yield* DotyposService;
    const holdCleanup = yield* ReservationHoldCleanupService;
    const finalization = yield* ProviderPaymentFinalizationService;

    const reconstructSummary = Effect.fn("checkoutStatus.reconstructSummary")(
      function* (reservation: WorkspaceReservation) {
        yield* Effect.annotateLogsScoped({ reservation });
        yield* Effect.logDebug(
          "Checkout status summary reconstruction started"
        );

        if (!reservation.dotyposReservationId) {
          yield* Effect.logWarning(
            "Checkout status summary missing Dotypos reservation id"
          );
          return {} satisfies CheckoutStatusReconstruction;
        }

        const parsedReservationDetails =
          storedWorkspaceReservationDetailsSchema.safeParse(
            reservation.reservationDetails
          );

        if (!parsedReservationDetails.success) {
          yield* Effect.logWarning(
            "Checkout status summary invalid reservation details"
          );
          return {} satisfies CheckoutStatusReconstruction;
        }
        const reservationDetails = parsedReservationDetails.data;

        const attempt = yield* paymentAttempts.findDisplayableForReservation({
          workspaceReservationId: reservation.id,
          activePaymentAttemptId:
            reservation.activePaymentAttemptId ?? undefined,
          paymentState: reservation.paymentState,
        });
        yield* Effect.annotateLogsScoped({ attempt });
        yield* Effect.logDebug(
          "Checkout status summary attempt lookup completed"
        );

        if (!attempt) {
          yield* Effect.logWarning(
            "Checkout status summary missing payment attempt"
          );
          return {} satisfies CheckoutStatusReconstruction;
        }

        if (!canUseAttemptForSummary(attempt, reservation)) {
          yield* Effect.logWarning(
            "Checkout status summary unusable payment attempt"
          );
          return {} satisfies CheckoutStatusReconstruction;
        }

        const dotyposReservation = yield* dotypos
          .getReservation(reservation.dotyposReservationId)
          .pipe(
            Effect.tapError((cause) =>
              Effect.logWarning(
                "Checkout status summary reservation load failed",
                {
                  reservationId: reservation.id,
                  dotyposReservationId: reservation.dotyposReservationId,
                  cause,
                }
              )
            ),
            Effect.option
          );

        const dotyposReservationValue = yield* Match.value(
          dotyposReservation
        ).pipe(
          Match.tag("None", () =>
            Effect.gen(function* () {
              yield* Effect.logWarning(
                "Checkout status summary missing Dotypos reservation"
              );
              return undefined;
            })
          ),
          Match.tag("Some", ({ value }) => Effect.succeed(value)),
          Match.exhaustive
        );

        if (!dotyposReservationValue) {
          return {} satisfies CheckoutStatusReconstruction;
        }
        yield* Effect.annotateLogsScoped({ dotyposReservation });
        yield* Effect.logDebug(
          "Checkout status summary Dotypos reservation loaded"
        );

        const tables = yield* dotypos.getTables().pipe(
          Effect.tapError((cause) =>
            Effect.logWarning("Checkout status table map load failed", {
              reservationId: reservation.id,
              dotyposReservationId: reservation.dotyposReservationId,
              cause,
            })
          ),
          Effect.option
        );
        const tableMap = Match.value(tables).pipe(
          Match.tag("Some", ({ value }) =>
            getWorkspaceTableMap(dotyposReservationValue.reservation, value)
          ),
          Match.tag("None", () => undefined),
          Match.exhaustive
        );

        const reservedFrom = new Date(
          dotyposReservationValue.reservation.startDate
        );
        const reservedUntil = new Date(
          dotyposReservationValue.reservation.endDate
        );
        const price: WorkspaceMoney = {
          value: attempt.amountValue,
          exponent: attempt.amountExponent,
          currency: attempt.currency,
        };

        const summary: WorkspaceCheckoutStatusSummary = Match.value(
          reservationDetails
        ).pipe(
          Match.tag("meeting-room", () => ({
            _tag: "meeting-room" as const,
            reservedFrom,
            reservedUntil,
            price,
          })),
          Match.tag("cowork", (coworkDetails) => ({
            ...coworkDetails,
            reservedFrom,
            reservedUntil,
            price,
          })),
          Match.exhaustive
        );

        yield* Effect.annotateLogsScoped({ summary });
        yield* Effect.logDebug("Checkout status summary reconstructed");

        return {
          summary,
          ...(tableMap ? { tableMap } : {}),
          supportContactPrefill: getSupportContactPrefill(
            dotyposReservationValue.customer
          ),
        } satisfies CheckoutStatusReconstruction;
      },
      (effect, reservation) =>
        effect.pipe(
          Effect.scoped,
          Effect.annotateLogs({ reservationId: reservation.id })
        )
    );

    const getStatus = Effect.fn("checkoutStatus.getStatus")(
      function* (input: {
        readonly orderId: string;
        readonly returnOutcome: CheckoutStatusReturnOutcome;
      }) {
        yield* Effect.annotateLogsScoped({ input });
        yield* Effect.logInfo("Checkout status lookup started");

        const reservation = yield* reservations.findById(input.orderId);
        yield* Effect.annotateLogsScoped({ reservation });
        yield* Effect.logDebug("Checkout status reservation lookup completed");

        if (!reservation) {
          const result = {
            _tag: "cowork",
            orderId: input.orderId,
            returnOutcome: input.returnOutcome,
            status: "not_found",
          } satisfies CheckoutStatusViewModel;

          yield* Effect.annotateLogsScoped({ result });
          yield* Effect.logInfo("Checkout status lookup completed");

          return result;
        }

        const statusKind = toCheckoutStatusKind(
          reservation.paymentState,
          reservation.fulfillmentState
        );
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
                ).pipe(Effect.as({} satisfies CheckoutStatusReconstruction)),
            })
          );

        const result = Match.value(reconstruction.summary).pipe(
          Match.tag("meeting-room", (summary) => ({
            _tag: "meeting-room" as const,
            orderId: reservation.id,
            returnOutcome: input.returnOutcome,
            status: statusKind,
            paymentStatus: reservation.paymentState,
            fulfillmentStatus: reservation.fulfillmentState,
            summary,
            ...(reconstruction.tableMap
              ? { tableMap: reconstruction.tableMap }
              : {}),
            ...(statusKind === "fulfillment_failed" &&
            reconstruction.supportContactPrefill
              ? { supportContactPrefill: reconstruction.supportContactPrefill }
              : {}),
          })),
          Match.orElse((summary) => ({
            _tag: "cowork" as const,
            orderId: reservation.id,
            returnOutcome: input.returnOutcome,
            status: statusKind,
            paymentStatus: reservation.paymentState,
            fulfillmentStatus: reservation.fulfillmentState,
            ...(summary ? { summary } : {}),
            ...(reconstruction.tableMap
              ? { tableMap: reconstruction.tableMap }
              : {}),
            ...(statusKind === "fulfillment_failed" &&
            reconstruction.supportContactPrefill
              ? { supportContactPrefill: reconstruction.supportContactPrefill }
              : {}),
          })),
          (value) => value satisfies CheckoutStatusViewModel
        );

        yield* Effect.annotateLogsScoped({ result });
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

    return CheckoutStatusService.of({
      getStatus,
      refreshStatus: Effect.fn("checkoutStatus.refreshStatus")(
        function* (input) {
          yield* Effect.annotateLogsScoped({ input });
          yield* Effect.logInfo("Checkout status refresh started");

          const reservation = yield* reservations.findById(input.orderId);
          yield* Effect.annotateLogsScoped({ reservation });
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
          yield* Effect.logInfo(
            "Checkout status refresh finalization completed"
          );

          if (result === "terminal") {
            yield* Effect.logInfo(
              "Checkout status refresh terminal hold cleanup invoked"
            );
            yield* holdCleanup
              .cancelOrderHold({ orderId: reservation.id })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logWarning(
                    "Checkout status terminal hold cleanup failed",
                    {
                      orderId: reservation.id,
                      cause,
                    }
                  )
                ),
                Effect.ignore
              );
            yield* Effect.logInfo(
              "Checkout status refresh terminal hold cleanup completed"
            );
          } else {
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
          yield* Effect.annotateLogsScoped({ status });
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
    });
  })
);

export const CheckoutStatusServiceLiveWithDependencies =
  CheckoutStatusServiceLive.pipe(
    Layer.provide(ReservationHoldCleanupServiceLiveWithDependencies),
    Layer.provide(ProviderPaymentFinalizationServiceLiveWithDependencies),
    Layer.provide(PaymentAttemptRepositoryLive),
    Layer.provide(WorkspaceReservationRepositoryLive),
    Layer.provide(WorkspaceDatabaseLive),
    Layer.provide(DotyposServiceLive)
  );
