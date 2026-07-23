import {
  type CreateDotyposReservationInput,
  type DotyposReservationStatus,
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  type PreparedDotyposReservationCreation,
  type Reservation,
  ValidationError,
} from "@deskohub/dotypos";
import { Effect, Match } from "effect";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { getWorkspaceMeetingRoomProductTitle } from "@/features/checkout/product-catalog.i18n";
import type { CheckoutDetailsJson } from "@/features/checkout/schemas/checkout-details";
import {
  formatWorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import { getCoworkReservationIntervalInput } from "@/features/reservation/cowork-reservation";
import {
  getReservationDate,
  getReservationIntervalNormalization,
} from "@/features/reservation/reservation-interval";
import { getDurationMinutes } from "@/features/reservation/reservation-interval-normalization";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import {
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";
import { workspaceBookingGuestCount } from "./workspace-table-occupancy";

export interface CreateWorkspaceDotyposReservationInput {
  readonly paymentOrderId: string;
  readonly providerCreationEpoch: string;
  readonly dotyposCustomerId: string;
  readonly checkoutDetails: CheckoutDetailsJson;
  readonly reservation: WorkspaceTableAssignmentReservation;
  readonly status: DotyposReservationStatus;
}

export interface PreparedWorkspaceDotyposReservation {
  readonly paymentOrderId: string;
  readonly reservationInput: CreateDotyposReservationInput;
  readonly providerRequest: PreparedDotyposReservationCreation;
}

export const prepareWorkspaceDotyposReservation: (
  input: CreateWorkspaceDotyposReservationInput
) => Effect.Effect<
  PreparedWorkspaceDotyposReservation,
  ExternalAPIError | NetworkError | ValidationError,
  DotyposService | WorkspaceTableAssignmentService
> = Effect.fn("prepareWorkspaceDotyposReservation")(
  function* (input) {
    yield* Effect.logInfo(
      "Workspace Dotypos reservation creation input received"
    );

    const tableAssignments = yield* WorkspaceTableAssignmentService;
    const dotypos = yield* DotyposService;
    const reservationIntervalInput = Match.value(input.reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: ({ date }) => getCoworkReservationIntervalInput(date),
        "meeting-room": (meetingRoomReservation) => meetingRoomReservation,
      })
    );
    const { startsAt, endsAt } = yield* getReservationIntervalNormalization(
      reservationIntervalInput
    ).pipe(
      Effect.mapError(
        (cause) => new ValidationError({ message: cause.message, cause })
      )
    );
    const tableId = yield* tableAssignments.assignTableId(input.reservation);

    const reservationInput: CreateDotyposReservationInput = {
      customerId: input.dotyposCustomerId,
      startDate: temporalInstantToDate(Temporal.Instant.from(startsAt)),
      endDate: temporalInstantToDate(Temporal.Instant.from(endsAt)),
      seats: workspaceBookingGuestCount,
      tableId,
      status: input.status,
      note: formatWorkspaceReservationNote(input),
    };
    const providerRequest =
      yield* dotypos.prepareReservationCreation(reservationInput);
    yield* Effect.logInfo("Workspace Dotypos reservation input built");

    return {
      paymentOrderId: input.paymentOrderId,
      providerRequest,
      reservationInput,
    };
  },
  (effect, input) =>
    effect.pipe(
      Effect.scoped,
      Effect.tapError(() =>
        Effect.logError("Workspace Dotypos reservation preparation failed")
      ),
      Effect.annotateLogs({
        paymentOrderId: input.paymentOrderId,
        locale: input.checkoutDetails.locale,
        reservationKind: input.reservation.kind,
        ...getReservationLogAnnotations(input.reservation),
        reservationStatus: input.status,
      })
    )
);

export const createWorkspaceDotyposReservation: (
  input: PreparedWorkspaceDotyposReservation
) => Effect.Effect<
  Reservation,
  ExternalAPIError | NetworkError | ValidationError,
  DotyposService
> = Effect.fn("createWorkspaceDotyposReservation")(
  function* (input) {
    const dotypos = yield* DotyposService;

    yield* Effect.logInfo("Workspace Dotypos reservation creation started");
    const reservation = yield* dotypos.createPreparedReservation(
      input.providerRequest
    );
    yield* Effect.logInfo("Workspace Dotypos reservation creation completed");

    return reservation;
  },
  (effect, input) =>
    effect.pipe(
      Effect.tapError(() =>
        Effect.logError("Workspace Dotypos reservation creation failed")
      ),
      Effect.annotateLogs({
        paymentOrderId: input.paymentOrderId,
        reservationStatus: input.reservationInput.status,
      })
    )
);

export const findWorkspaceDotyposReservationsByPaymentOrderId = Effect.fn(
  "findWorkspaceDotyposReservationsByPaymentOrderId"
)(function* (input: {
  readonly paymentOrderId: string;
  readonly providerCreationEpoch: string;
}) {
  const dotypos = yield* DotyposService;
  const paymentOrderLine = `Payment order: ${input.paymentOrderId}`;
  const providerEpochLine = `Provider creation epoch: ${input.providerCreationEpoch}`;
  const reservations = yield* dotypos.listReservations();

  return reservations.filter((reservation) => {
    const lines = reservation.note?.split(/\r?\n/u);
    return (
      lines?.includes(paymentOrderLine) && lines.includes(providerEpochLine)
    );
  });
});

export const formatWorkspaceReservationNote = (
  input: Pick<
    CreateWorkspaceDotyposReservationInput,
    "checkoutDetails" | "paymentOrderId" | "reservation"
  > &
    Partial<
      Pick<CreateWorkspaceDotyposReservationInput, "providerCreationEpoch">
    >
) => {
  const { checkoutDetails, reservation } = input;
  const { productLabel, reservationRows } = Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (coworkReservation) => ({
        productLabel: getWorkspaceProductByTier(coworkReservation.entryTier)
          .label,
        reservationRows: [
          `Date: ${coworkReservation.date}`,
          `Coffee: ${coworkReservation.coffee ? "yes" : "no"}`,
          coworkReservation.monitorOption
            ? `Monitor: ${coworkReservation.monitorOption}`
            : null,
        ],
      }),
      "meeting-room": (meetingRoomReservation) => ({
        productLabel: getWorkspaceMeetingRoomProductTitle(
          checkoutDetails.locale
        ),
        reservationRows: [
          `Date: ${getReservationDate({
            interval: meetingRoomReservation,
            timeZone: workspaceSiteConstants.location.timeZone,
          })}`,
          `Time: ${meetingRoomReservation.startsAt}-${meetingRoomReservation.endsAt}`,
          `Duration: ${getDurationMinutes(meetingRoomReservation)} minutes`,
        ],
      }),
    })
  );
  const lines = [
    "Deskohub workspace post-payment reservation",
    `Payment order: ${input.paymentOrderId}`,
    input.providerCreationEpoch
      ? `Provider creation epoch: ${input.providerCreationEpoch}`
      : null,
    `Product: ${productLabel}`,
    ...reservationRows,
    `Price: ${formatWorkspaceMoney(
      checkoutDetails.payment.expectedPrice,
      checkoutDetails.locale
    )}`,
    ...checkoutDetails.payment.discounts.map(
      ({ amount, discount }) =>
        `Discount: ${discount.label} (${formatWorkspaceMoney(
          workspaceMoneyWithValue(-amount.value, amount),
          checkoutDetails.locale
        )})`
    ),
  ];

  return lines.filter((line) => line !== null).join("\n");
};

const getReservationLogAnnotations = (
  reservation: WorkspaceTableAssignmentReservation
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ date, entryTier }) => ({ entryTier, date }),
      "meeting-room": (meetingRoomReservation) => ({
        date: getReservationDate({
          interval: meetingRoomReservation,
          timeZone: workspaceSiteConstants.location.timeZone,
        }),
      }),
    })
  );
