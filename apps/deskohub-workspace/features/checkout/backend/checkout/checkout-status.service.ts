import {
  type DotyposReservationId,
  DotyposService,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import type { Customer, Reservation } from "@deskohub/dotypos/generated";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import {
  Clock,
  Context,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Schema,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type {
  FulfillmentState,
  LatePaymentRecovery,
  PaymentState,
} from "@/db/schema";
import { shouldOfferReservationRetry } from "@/features/checkout/checkout-status-policy";
import { getProviderOrderAbandonmentCutoff } from "@/features/checkout/provider-order-abandonment";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  getWorkspaceTableMap,
  type WorkspaceTableMap,
} from "@/features/checkout/workspace-table-map";
import {
  SeatingMapFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "@/features/feature-flags/backend";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { ReservationRecords } from "@/features/reservation/backend/reservation-records";
import {
  type CustomerReservationTable,
  getCustomerReservationTable,
  getOpenSpaceTableNames,
  getReservationTableName,
} from "@/features/reservation/backend/reservation-table";
import {
  type WorkspaceReservation,
  type WorkspaceReservationDetailsMalformedError,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { getDotyposReservationTiming } from "@/features/reservation/backend/workspace-reservation.service";
import { getStoredCoworkReservationSelectionSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import type { StoredMeetingRoomReservationDetails } from "@/features/reservation/meeting-room-reservation";
import { getStoredMeetingRoomReservationSelectionSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import type { StoredOfficeReservationDetails } from "@/features/reservation/office-reservation";
import { getStoredOfficeReservationSelectionSearchParams } from "@/features/reservation/office-reservation-checkout-query";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { ReservationSelectionSearchParams } from "@/features/reservation/reservation-checkout-query";
import { dotyposReservationSeatsSchema } from "@/features/reservation/reservation-seats";
import { ReviewSandbox } from "@/features/review-accounts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { nexiRequestTimeout } from "@/shared/backend/config/nexi.config";
import { currentInstant } from "@/shared/utils/temporal";
import { LatePaymentVerificationService } from "../payment/late-payment-verification.service";
import { ProviderPaymentFinalizationService } from "../payment/provider-payment-finalization.service";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import {
  type PaymentAttempt,
  PaymentAttemptRepository,
} from "../repositories/payment-attempt.repository";
import type { PaymentLifecycleRepositoryError } from "../repositories/payment-lifecycle.repository";

export type CheckoutStatusReturnOutcome = "success" | "cancelled" | "unknown";

export type CheckoutStatusKind =
  | "not_found"
  | "created"
  | "pending"
  | "payment_pending_delayed"
  | "paid_waiting_fulfillment"
  | "paid_fulfillment_delayed"
  | "paid_awaiting_delivery"
  | "paid_delivery_delayed"
  | "fulfilled"
  | "fulfillment_failed"
  | "payment_failed"
  | "cancelled"
  | "expired"
  | "late_payment_checking"
  | "late_payment_refund"
  | "late_payment_review";

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

type CheckoutStatusContactPrefill = {
  readonly name?: string;
  readonly email?: string;
  readonly phone?: string;
};

type CheckoutStatusTableMap = WorkspaceTableMap;

type CheckoutStatusViewModelBase = {
  readonly orderId: WorkspaceReservationId;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
};

type CheckoutReservationStatusViewModelBase = CheckoutStatusViewModelBase & {
  readonly status: CheckoutReservationStatusKind;
  readonly paymentStatus: PaymentState;
  readonly fulfillmentStatus: FulfillmentState;
  readonly table?: CustomerReservationTable;
  readonly tableMap?: CheckoutStatusTableMap;
  readonly supportContactPrefill?: CheckoutStatusContactPrefill;
  /** The booked selection a retry status reopens on the reservation page. */
  readonly retrySearchParams?: ReservationSelectionSearchParams;
  /**
   * Marks a review account's sample or simulated hold, which nothing was
   * reserved or charged for and which has no access code.
   */
  readonly reviewSandbox?: true;
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
  readonly table?: CustomerReservationTable;
  readonly tableMap?: CheckoutStatusTableMap;
};

type CheckoutStatusError =
  | EffectDrizzleQueryError
  | PaymentLifecycleRepositoryError
  | WorkspaceReservationDetailsMalformedError;

type CheckoutStatusLookup = {
  readonly orderId: WorkspaceReservationId;
  readonly returnOutcome: CheckoutStatusReturnOutcome;
  /**
   * Whether to read the customer's contact details from Dotypos for the
   * statuses that show them. Defaults to true; a caller that never shows them
   * passes false to skip the read.
   */
  readonly includeSupportContact?: boolean;
};

export interface ICheckoutStatusService {
  readonly getStatus: (
    input: CheckoutStatusLookup
  ) => Effect.Effect<CheckoutStatusViewModel, CheckoutStatusError>;
  readonly refreshStatus: (input: {
    readonly orderId: WorkspaceReservationId;
    readonly returnOutcome: CheckoutStatusReturnOutcome;
  }) => Effect.Effect<CheckoutStatusViewModel, CheckoutStatusError>;
}

/**
 * Fulfillment and delivery normally finish within seconds. After this long
 * the status page stops promising automatic completion and offers support
 * instead, because the work may have stalled or the email may never arrive.
 */
const paidFulfillmentGracePeriod = { minutes: 10 };

const toCheckoutStatusKind = (
  reservation: Pick<
    WorkspaceReservation,
    "fulfillmentState" | "paidAt" | "paymentState" | "reservationState"
  >,
  now: Temporal.Instant
): CheckoutReservationStatusKind => {
  const { paymentState } = reservation;
  if (paymentState === "paid") {
    const isOverdue =
      !!reservation.paidAt &&
      Temporal.Instant.compare(
        now,
        reservation.paidAt.add(paidFulfillmentGracePeriod)
      ) >= 0;
    switch (reservation.fulfillmentState) {
      case "fulfilled":
        return "fulfilled";
      case "failed":
        return "fulfillment_failed";
      case "awaiting_delivery":
        if (reservation.reservationState === "confirmed") {
          return isOverdue ? "paid_delivery_delayed" : "paid_awaiting_delivery";
        }
        return isOverdue
          ? "paid_fulfillment_delayed"
          : "paid_waiting_fulfillment";
      case "processing":
      case "not_started":
        return isOverdue
          ? "paid_fulfillment_delayed"
          : "paid_waiting_fulfillment";
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

const latePaymentStatusKinds = {
  pending: "late_payment_checking",
  processing: "late_payment_checking",
  refund_required: "late_payment_refund",
  review_required: "late_payment_review",
} as const satisfies Record<
  Exclude<LatePaymentRecovery["state"], "recovered">,
  CheckoutReservationStatusKind
>;

/**
 * A late payment takes over the customer status until recovery confirms the
 * reservation. A refund for an older attempt does not hide a reservation that
 * its active attempt has paid.
 */
const getLatePaymentStatusKind = (
  reservation: Pick<
    WorkspaceReservation,
    "activePaymentAttemptId" | "paymentState"
  >,
  recovery: LatePaymentRecovery | null
): CheckoutReservationStatusKind | undefined => {
  if (!recovery || recovery.state === "recovered") return undefined;
  if (
    recovery.paymentAttemptId !== reservation.activePaymentAttemptId &&
    reservation.paymentState === "paid"
  ) {
    return undefined;
  }
  return latePaymentStatusKinds[recovery.state];
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

/** Payment states that ended without settling, which the customer may retry. */
const isRetryablePaymentState = (paymentState: PaymentState) =>
  paymentState === "failed" ||
  paymentState === "cancelled" ||
  paymentState === "expired";

/** The Dotypos reservation a retry reopens, for a payment that ended unpaid. */
const getRetryDotyposReservationId = (reservation: WorkspaceReservation) =>
  Option.fromNullishOr(reservation.dotyposReservationId).pipe(
    Option.filter(() => isRetryablePaymentState(reservation.paymentState))
  );

/** Projects the booked selection onto the family's reservation-page link. */
const getRetrySelectionSearchParams = ({
  reservation,
  dotyposReservation,
  timing,
}: {
  readonly reservation: WorkspaceReservation;
  readonly dotyposReservation: Pick<Reservation, "seats">;
  readonly timing: Effect.Success<
    ReturnType<typeof getDotyposReservationTiming>
  >;
}) =>
  Match.value(reservation.reservationDetails).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (details) =>
        getStoredCoworkReservationSelectionSearchParams({
          ...details,
          ...timing,
        }),
      "meeting-room": (details) =>
        getStoredMeetingRoomReservationSelectionSearchParams({
          ...details,
          ...timing,
        }),
      office: (details) => {
        const seats =
          Option.getOrUndefined(
            Schema.decodeUnknownOption(dotyposReservationSeatsSchema)(
              dotyposReservation.seats
            )
          ) ?? details.seats;

        return seats === undefined
          ? undefined
          : getStoredOfficeReservationSelectionSearchParams({
              ...details,
              ...timing,
              seats,
            });
      },
    })
  );

/**
 * Payment states whose displayable attempt is normally usable, so the Dotypos
 * reservation can load alongside the attempt instead of after it.
 */
const isSummaryLikelyDisplayable = (reservation: WorkspaceReservation) =>
  reservation.paymentState === "not_started" ||
  reservation.paymentState === "pending" ||
  reservation.paymentState === "paid";

const toOptionalString = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const getSupportContactPrefill = (
  customer: Customer
): CheckoutStatusContactPrefill | undefined => {
  const prefill: CheckoutStatusContactPrefill = {
    name: getCustomerDisplayName(customer),
    email: toOptionalString(customer.email),
    phone: toOptionalString(customer.phone),
  };

  return prefill.name || prefill.email || prefill.phone ? prefill : undefined;
};

/**
 * Statuses that show the customer's contact details: the address an
 * undelivered confirmation went to, and the support request prefill.
 */
const showsCustomerContact = (statusKind: CheckoutReservationStatusKind) =>
  statusKind === "fulfillment_failed" ||
  statusKind === "late_payment_review" ||
  statusKind === "payment_pending_delayed" ||
  statusKind === "paid_fulfillment_delayed" ||
  statusKind === "paid_awaiting_delivery" ||
  statusKind === "paid_delivery_delayed";

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

const summaryTimeout = "8 seconds";

/**
 * Bounds all Nexi payment verification in one status refresh, retries
 * included. It fits one full sandbox-length Nexi request and leaves time, with
 * the 8-second summary cap, to render the stored status within the status
 * page's 60-second `maxDuration`. Production lookups (5 seconds each) keep
 * their usual retries.
 */
const refreshVerificationBudget = Duration.seconds(40);

const implementation = Effect.gen(function* () {
  const reservations = yield* WorkspaceReservationRepository;
  const reviewSandbox = yield* ReviewSandbox;
  const latePaymentRecoveries = yield* LatePaymentRecoveryRepository;
  const latePaymentVerification = yield* LatePaymentVerificationService;
  const paymentAttempts = yield* PaymentAttemptRepository;
  const dotypos = yield* DotyposService;
  const records = yield* ReservationRecords;
  const inventory = yield* AdvisoryAvailabilityInventory;
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

      const dotyposReservationId = reservation.dotyposReservationId;
      const loadDotyposReservation = Effect.suspend(() =>
        records.get(dotyposReservationId)
      ).pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Checkout status summary reservation load failed", {
            cause,
          })
        ),
        Effect.orElseSucceed(() => undefined)
      );
      const prefetchDotyposReservation =
        isSummaryLikelyDisplayable(reservation);

      const [attempt, prefetchedDotyposReservation, tables, seatingMapEnabled] =
        yield* Effect.all(
          [
            paymentAttempts.findDisplayableForReservation({
              workspaceReservationId: reservation.id,
              activePaymentAttemptId:
                reservation.activePaymentAttemptId ?? undefined,
              paymentState: reservation.paymentState,
            }),
            prefetchDotyposReservation ? loadDotyposReservation : Effect.void,
            inventory.tables.pipe(
              Effect.tapError((cause) =>
                Effect.logWarning("Checkout status tables load failed", {
                  cause,
                })
              ),
              Effect.orElseSucceed(() => [])
            ),
            seatingMapFeatureFlag.isEnabled,
          ],
          { concurrency: "inherit" }
        );
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

      const dotyposReservation = prefetchDotyposReservation
        ? prefetchedDotyposReservation
        : yield* loadDotyposReservation;

      if (!dotyposReservation) {
        yield* Effect.logWarning(
          "Checkout status summary missing Dotypos reservation"
        );
        return emptyReconstruction;
      }
      yield* Effect.logDebug(
        "Checkout status summary Dotypos reservation loaded"
      );

      const openSpaceTableNames =
        reservation.reservationDetails.kind === "cowork" &&
        reservation.reservationDetails.entryTier === "open-space"
          ? yield* getOpenSpaceTableNames(tables)
          : undefined;
      const table = getCustomerReservationTable({
        reservationDetails: reservation.reservationDetails,
        tableName: getReservationTableName(dotyposReservation, tables),
        openSpaceTableNames,
      });
      const tableMap = seatingMapEnabled
        ? getWorkspaceTableMap(dotyposReservation, tables)
        : undefined;

      const timing = yield* getDotyposReservationTiming({
        reservationId: reservation.id,
        reservation: dotyposReservation,
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
          table,
          tableMap,
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
                dotyposReservation.seats
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
        table,
        tableMap,
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

  /**
   * Loads the support contact prefill for statuses that show it. Best
   * effort: the status renders without a prefill when Dotypos is slow.
   */
  const loadSupportContactPrefill = Effect.fn(
    "CheckoutStatusService.loadSupportContactPrefill"
  )(function* (
    reservation: WorkspaceReservation,
    statusKind: CheckoutReservationStatusKind
  ) {
    if (!showsCustomerContact(statusKind)) return undefined;

    return yield* dotypos.getCustomer(reservation.dotyposCustomerId).pipe(
      Effect.map(getSupportContactPrefill),
      Effect.timeoutOrElse({
        duration: summaryTimeout,
        orElse: () => Effect.undefined,
      }),
      Effect.tapError((cause) =>
        Effect.logWarning("Checkout status support contact load failed", {
          cause,
        })
      ),
      Effect.orElseSucceed(() => undefined)
    );
  });

  /**
   * The booked selection of a payment that ended without settling, as the
   * reservation-page link parameters a retry reopens. The interval comes from
   * the Dotypos reservation, which stays readable after hold cleanup cancels
   * it. Best effort: without it the page starts a plain new reservation.
   */
  const loadRetrySelection = Effect.fn(
    "CheckoutStatusService.loadRetrySelection"
  )(
    (input: {
      readonly reservation: WorkspaceReservation;
      readonly dotyposReservationId: DotyposReservationId;
    }) =>
      Effect.succeed(input).pipe(
        Effect.bind("dotyposReservation", ({ dotyposReservationId }) =>
          records.get(dotyposReservationId)
        ),
        Effect.bind("timing", ({ reservation, dotyposReservation }) =>
          getDotyposReservationTiming({
            reservationId: reservation.id,
            reservation: dotyposReservation,
          })
        ),
        Effect.map(getRetrySelectionSearchParams),
        Effect.timeoutOrElse({
          duration: summaryTimeout,
          orElse: () =>
            Effect.logWarning(
              "Checkout status retry selection load timed out"
            ).pipe(Effect.as(undefined)),
        }),
        Effect.tapError((cause) =>
          Effect.logWarning("Checkout status retry selection load failed", {
            cause,
          })
        ),
        Effect.orElseSucceed(() => undefined)
      ),
    (effect, { reservation }) =>
      effect.pipe(
        Effect.annotateLogs({
          reservationId: reservation.id,
          dotyposReservationId: reservation.dotyposReservationId,
          reservationKind: reservation.reservationDetails.kind,
        })
      )
  );

  /** Loads the retry selection only for a payment the customer may retry. */
  const loadRetrySearchParams = (reservation: WorkspaceReservation) =>
    Option.match(getRetryDotyposReservationId(reservation), {
      onNone: () => Effect.undefined,
      onSome: (dotyposReservationId) =>
        loadRetrySelection({ reservation, dotyposReservationId }),
    });

  /**
   * A provider payment unsettled past the abandonment cutoff may never settle,
   * so the page stops promising confirmation and offers support. Hold
   * cleanup later expires an empty order, which then allows a new booking.
   */
  const isPendingPaymentOverdue = Effect.fn(
    "CheckoutStatusService.isPendingPaymentOverdue"
  )(function* (reservation: WorkspaceReservation, now: Temporal.Instant) {
    if (!reservation.activePaymentAttemptId) return false;

    const attempt = yield* paymentAttempts.findById(
      reservation.activePaymentAttemptId
    );
    if (!attempt) return false;

    return (
      Temporal.Instant.compare(
        now,
        getProviderOrderAbandonmentCutoff(
          attempt.providerOrderCreatedAt ?? attempt.createdAt
        )
      ) >= 0
    );
  });

  /** Derives the customer status and its support contact prefill. */
  const resolveStatusKind = Effect.fn(
    "CheckoutStatusService.resolveStatusKind"
  )(function* (
    reservation: WorkspaceReservation,
    includeSupportContact: boolean
  ) {
    const latePaymentRecovery =
      yield* latePaymentRecoveries.findLatestByWorkspaceReservationId(
        reservation.id
      );
    const latePaymentStatusKind = getLatePaymentStatusKind(
      reservation,
      latePaymentRecovery
    );
    const now = yield* currentInstant;
    const reservationStatusKind = toCheckoutStatusKind(reservation, now);
    const statusKind =
      latePaymentStatusKind ??
      (reservationStatusKind === "pending" &&
      (yield* isPendingPaymentOverdue(reservation, now))
        ? "payment_pending_delayed"
        : reservationStatusKind);
    const supportContactPrefill = includeSupportContact
      ? yield* loadSupportContactPrefill(reservation, statusKind)
      : undefined;

    return { latePaymentStatusKind, statusKind, supportContactPrefill };
  });

  const getStatus = Effect.fn("CheckoutStatusService.getStatus")(
    function* (input: CheckoutStatusLookup) {
      yield* Effect.logInfo("Checkout status lookup started");

      const reservation = yield* reservations.findById(input.orderId);
      yield* Effect.logDebug("Checkout status reservation lookup completed");

      if (!reservation) {
        const result: CheckoutStatusViewModel = Option.getOrElse(
          yield* reviewSandbox.status(input),
          () => ({
            orderId: input.orderId,
            returnOutcome: input.returnOutcome,
            status: "not_found",
          })
        );

        yield* Effect.annotateLogsScoped({ status: result.status });
        yield* Effect.logInfo("Checkout status lookup completed");

        return result;
      }

      const timeoutReconstruction: CheckoutStatusReconstruction = {
        reservation: getEmptyCheckoutStatusReservation(
          reservation.reservationDetails
        ),
      };
      const [
        { latePaymentStatusKind, statusKind, supportContactPrefill },
        reconstruction,
        retrySearchParams,
      ] = yield* Effect.all(
        [
          resolveStatusKind(reservation, input.includeSupportContact ?? true),
          reconstructSummary(reservation).pipe(
            Effect.timeoutOrElse({
              duration: summaryTimeout,
              orElse: () =>
                Effect.logWarning(
                  "Checkout status summary reconstruction timed out",
                  { reservationId: reservation.id }
                ).pipe(Effect.as(timeoutReconstruction)),
            })
          ),
          loadRetrySearchParams(reservation),
        ],
        { concurrency: "inherit" }
      );

      const resultBase: CheckoutReservationStatusViewModelBase = {
        orderId: reservation.id,
        returnOutcome: input.returnOutcome,
        status: statusKind,
        paymentStatus: reservation.paymentState,
        fulfillmentStatus: reservation.fulfillmentState,
        // A late payment has no booked place to show until recovery confirms
        // a reservation; the original hold's table may belong to someone else.
        ...(!latePaymentStatusKind && {
          table: reconstruction.table,
          tableMap: reconstruction.tableMap,
        }),
        supportContactPrefill,
        // A late payment that settled takes over the status, and with it the
        // retry of the payment it replaced.
        ...(shouldOfferReservationRetry(statusKind) &&
          retrySearchParams && { retrySearchParams }),
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
        const verificationStartedAt = yield* Clock.currentTimeMillis;
        const remainingVerificationBudget = Clock.currentTimeMillis.pipe(
          Effect.map((now) =>
            Duration.max(
              Duration.subtract(
                refreshVerificationBudget,
                Duration.millis(now - verificationStartedAt)
              ),
              Duration.zero
            )
          )
        );

        // Finalization loads the reservation and resolves its active attempt;
        // an order without one returns not_found and renders as stored.
        const result = yield* finalization.finalizePendingProviderPayment({
          orderId: input.orderId,
          verificationDeadline: refreshVerificationBudget,
        });
        yield* Effect.annotateLogsScoped({ result });
        yield* Effect.logInfo("Checkout status refresh finalization completed");

        if (result === "not_pending") {
          // A slow finalization lookup can lose a race with a concurrent
          // terminal transition. Start the late-payment lookup only when one
          // full Nexi request still fits the shared budget; otherwise the
          // success notification or a later refresh verifies it.
          const remaining = yield* remainingVerificationBudget;
          if (Duration.isLessThan(remaining, nexiRequestTimeout)) {
            yield* Effect.logWarning(
              "Checkout status refresh deferred late-payment verification",
              { remainingMilliseconds: Duration.toMillis(remaining) }
            );
          } else {
            const latePayment =
              yield* latePaymentVerification.startRecoveryIfSettled({
                orderId: input.orderId,
                verificationDeadline: remaining,
              });
            yield* Effect.annotateLogsScoped({ latePayment });
          }
        }

        if (result !== "terminal") {
          const level =
            result === "not_verifiable" || result === "verification_mismatch"
              ? "Warn"
              : "Info";
          yield* Effect.logWithLevel(level)(
            "Checkout status refresh finalization returned non-terminal",
            { result }
          );
        }

        const status = yield* getStatus(input);
        yield* Effect.annotateLogsScoped(
          Match.value(status).pipe(
            Match.when({ status: "not_found" }, ({ status }) => ({ status })),
            Match.orElse(({ kind, status }) => ({
              status,
              reservationKind: kind,
            }))
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
  static Default = Layer.effect(this, implementation);

  /**
   * The status service wired to read reservation details from `records`:
   * live for the status page, shared snapshots for customers' AI agents.
   */
  static withRecords = <E>(records: Layer.Layer<ReservationRecords, E>) =>
    this.Default.pipe(
      Layer.provide(records),
      Layer.provide(ProviderPaymentFinalizationService.Live),
      Layer.provide(LatePaymentVerificationService.Live),
      Layer.provide(LatePaymentRecoveryRepository.Default),
      Layer.provide(PaymentAttemptRepository.Default),
      Layer.provide(WorkspaceReservationRepository.Default),
      Layer.provide(ReviewSandbox.Default),
      Layer.provide(WorkspaceDatabase.Default),
      Layer.provide(WorkspaceDotyposLayer),
      Layer.provide(SharedAvailabilityInventoryLive),
      Layer.provide(
        SeatingMapFeatureFlagService.Default.pipe(
          Layer.provide(WorkspaceFeatureFlagService.Default)
        )
      )
    );

  static Live = this.withRecords(ReservationRecords.Live);
}
