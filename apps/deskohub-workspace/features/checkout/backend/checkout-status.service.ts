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
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
} from "@/features/checkout/backend/payment-attempt.repository";
import {
  ProviderPaymentFinalizationService,
  ProviderPaymentFinalizationServiceLiveWithDependencies,
} from "@/features/checkout/backend/provider-payment-finalization.service";
import {
  ReservationHoldCleanupService,
  ReservationHoldCleanupServiceLiveWithDependencies,
} from "@/features/checkout/backend/reservation-hold-cleanup.service";
import {
  isWorkspaceProductMonitorOption,
  isWorkspaceProductTier,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
} from "@/features/checkout/product-catalog";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  getWorkspaceTableMap,
  type WorkspaceTableMap,
} from "@/features/checkout/workspace-table-map";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";

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

export type WorkspaceCheckoutStatusSummary = {
  readonly tier: WorkspaceProductTier;
  readonly date: string;
  readonly coffee: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
  readonly price: WorkspaceMoney;
};

export type WorkspaceCheckoutStatusContactPrefill = {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
};

export type WorkspaceCheckoutTableMap = WorkspaceTableMap;

export type CheckoutStatusViewModel = {
  readonly orderId: string;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
  readonly status: CheckoutStatusKind;
  readonly paymentStatus?: PaymentState;
  readonly fulfillmentStatus?: FulfillmentState;
  readonly summary?: WorkspaceCheckoutStatusSummary;
  readonly tableMap?: WorkspaceCheckoutTableMap;
  readonly supportContactPrefill?: WorkspaceCheckoutStatusContactPrefill;
};

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

const toPragueReservationDate = (startDate: string | number) => {
  const date =
    typeof startDate === "number" || /^\d+$/.test(startDate)
      ? new Date(Number(startDate))
      : new Date(startDate);

  if (Number.isNaN(date.getTime())) return undefined;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Prague",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = getPart("year");
  const month = getPart("month");
  const day = getPart("day");

  return year && month && day ? `${year}-${month}-${day}` : undefined;
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

        const monitorOption = reservation.productMonitorOption ?? undefined;

        if (!reservation.dotyposReservationId) {
          yield* Effect.logWarning(
            "Checkout status summary missing Dotypos reservation id"
          );
          return {} satisfies CheckoutStatusReconstruction;
        }

        if (!isWorkspaceProductTier(reservation.productTier)) {
          yield* Effect.logWarning(
            "Checkout status summary invalid product tier"
          );
          return {} satisfies CheckoutStatusReconstruction;
        }

        if (
          monitorOption !== undefined &&
          !isWorkspaceProductMonitorOption(monitorOption)
        ) {
          yield* Effect.logWarning(
            "Checkout status summary invalid monitor option"
          );
          return {} satisfies CheckoutStatusReconstruction;
        }

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

        const date = toPragueReservationDate(
          dotyposReservationValue.reservation.startDate
        );

        if (!date) {
          yield* Effect.logWarning(
            "Checkout status summary invalid reservation date"
          );
          return {
            ...(tableMap ? { tableMap } : {}),
            supportContactPrefill: getSupportContactPrefill(
              dotyposReservationValue.customer
            ),
          } satisfies CheckoutStatusReconstruction;
        }

        const summary = {
          tier: reservation.productTier,
          date,
          coffee: reservation.productCoffee,
          monitorOption,
          price: {
            value: attempt.amountValue,
            exponent: attempt.amountExponent,
            currency: attempt.currency,
          },
        } satisfies WorkspaceCheckoutStatusSummary;

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
            orderId: input.orderId,
            returnOutcome: input.returnOutcome,
            status: "not_found",
          } satisfies CheckoutStatusViewModel;

          yield* Effect.annotateLogsScoped({ result });
          yield* Effect.logInfo("Checkout status lookup completed");

          return result;
        }

        const reconstruction: CheckoutStatusReconstruction =
          yield* reconstructSummary(reservation);
        const statusKind = toCheckoutStatusKind(
          reservation.paymentState,
          reservation.fulfillmentState
        );

        const result = {
          orderId: reservation.id,
          returnOutcome: input.returnOutcome,
          status: statusKind,
          paymentStatus: reservation.paymentState,
          fulfillmentStatus: reservation.fulfillmentState,
          ...(reconstruction.summary
            ? { summary: reconstruction.summary }
            : {}),
          ...(reconstruction.tableMap
            ? { tableMap: reconstruction.tableMap }
            : {}),
          ...(statusKind === "fulfillment_failed" &&
          reconstruction.supportContactPrefill
            ? { supportContactPrefill: reconstruction.supportContactPrefill }
            : {}),
        } satisfies CheckoutStatusViewModel;

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
