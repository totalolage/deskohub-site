import {
  type CreateDotyposReservationInput,
  type DotyposCustomerId,
  type DotyposReservationStatus,
  DotyposService,
  type DotyposTableId,
  type DotyposWriteFailure,
  type Reservation,
} from "@deskohub/dotypos";
import { Effect, Match } from "effect";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import { getMeetingRoomSetupStart } from "@/features/reservation/meeting-room-early-setup";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { getReservationDate } from "@/features/reservation/reservation-interval";
import type { ReservationIntervalValidationError } from "@/features/reservation/reservation-interval-domain";
import { staffLocale } from "@/shared/backend/staff-locale";
import { formatMoney, moneyWithValue } from "@/shared/money/money";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import {
  getWorkspaceReservationInterval,
  type TableAssignmentUnavailableError,
  type TableAssignmentUnconfigured,
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";
import { workspaceBookingSeatCount } from "./workspace-table-occupancy";
import type { InvalidDotyposTableSeats } from "./workspace-table-selection";

export interface CreateWorkspaceDotyposReservationInput {
  readonly paymentOrderId: WorkspaceReservationId;
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly checkoutDetails: CheckoutDetails;
  readonly reservation: WorkspaceTableAssignmentReservation;
  readonly status: DotyposReservationStatus;
}

export const createWorkspaceDotyposReservation: (
  input: CreateWorkspaceDotyposReservationInput
) => Effect.Effect<
  Reservation,
  | DotyposWriteFailure
  | InvalidDotyposTableSeats
  | ReservationIntervalValidationError
  | TableAssignmentUnavailableError
  | TableAssignmentUnconfigured,
  DotyposService | WorkspaceTableAssignmentService
> = Effect.fn("createWorkspaceDotyposReservation")(
  function* (input) {
    yield* Effect.logInfo(
      "Workspace Dotypos reservation creation input received"
    );

    const dotypos = yield* DotyposService;
    const tableAssignments = yield* WorkspaceTableAssignmentService;
    const { startsAt, endsAt } = yield* getWorkspaceReservationInterval(
      input.reservation
    );
    const tableId: DotyposTableId = yield* tableAssignments.assignTableId(
      input.reservation
    );
    const seats = Match.value(input.reservation).pipe(
      Match.discriminatorsExhaustive("kind")({
        cowork: () => workspaceBookingSeatCount,
        "meeting-room": () => workspaceBookingSeatCount,
        office: ({ seats }) => seats,
      })
    );

    const reservationInput: CreateDotyposReservationInput = {
      customerId: input.dotyposCustomerId,
      startDate: temporalInstantToDate(Temporal.Instant.from(startsAt)),
      endDate: temporalInstantToDate(Temporal.Instant.from(endsAt)),
      seats,
      tableId,
      status: input.status,
      note: formatWorkspaceReservationNote(input),
    };
    // Not the input itself: its note holds checkout details.
    yield* Effect.annotateLogsScoped({
      dotyposCustomerId: reservationInput.customerId,
      tableId: reservationInput.tableId,
      seats: reservationInput.seats,
      startsAt,
      endsAt,
    });
    yield* Effect.logInfo("Workspace Dotypos reservation input built");

    yield* Effect.logInfo("Workspace Dotypos reservation creation started");
    const reservation = yield* dotypos.createReservation(reservationInput);
    yield* Effect.annotateLogsScoped({
      dotyposReservationId: reservation.id,
      dotyposReservationStatus: reservation.status,
    });
    yield* Effect.logInfo("Workspace Dotypos reservation creation completed");

    return reservation;
  },
  (effect, input) =>
    effect.pipe(
      Effect.scoped,
      Effect.tapError((cause) =>
        Effect.logError("Workspace Dotypos reservation creation failed", {
          cause,
        })
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

/**
 * The note line naming the payment order. Late-payment recovery finds the
 * Dotypos reservations a payment order created by it.
 */
const formatPaymentOrderLine = (paymentOrderId: WorkspaceReservationId) =>
  `Platební objednávka: ${paymentOrderId}`;

/** Notes written before staff notes were Czech name the order in English. */
const formatLegacyPaymentOrderLine = (paymentOrderId: WorkspaceReservationId) =>
  `Payment order: ${paymentOrderId}`;

/** Whether a Dotypos reservation note names the given payment order. */
export const noteNamesPaymentOrder = (
  note: string | null | undefined,
  paymentOrderId: WorkspaceReservationId
) => {
  const lines = note?.split("\n") ?? [];

  return (
    lines.includes(formatPaymentOrderLine(paymentOrderId)) ||
    lines.includes(formatLegacyPaymentOrderLine(paymentOrderId))
  );
};

/**
 * The note staff read on the Dotypos reservation. It is written in the staff
 * locale whatever the checkout locale; the checkout locale stays on the
 * reservation's checkout details.
 */
export const formatWorkspaceReservationNote = (
  input: Pick<
    CreateWorkspaceDotyposReservationInput,
    "checkoutDetails" | "paymentOrderId" | "reservation"
  >
) => {
  const { checkoutDetails, reservation } = input;
  const { productLabel, reservationRows } = Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (coworkReservation) => ({
        productLabel: getWorkspaceProductTierTitle(
          coworkReservation.entryTier,
          staffLocale
        ),
        reservationRows: [
          `Datum: ${coworkReservation.date}`,
          `Káva: ${coworkReservation.coffee ? "ano" : "ne"}`,
          coworkReservation.monitorOption
            ? `Monitor: ${getWorkspaceProductMonitorTitle(
                coworkReservation.monitorOption,
                staffLocale
              )}`
            : null,
        ],
      }),
      "meeting-room": (meetingRoomReservation) => ({
        productLabel: getWorkspaceMeetingRoomProductTitle(staffLocale),
        reservationRows: [
          `Datum: ${getReservationDate({
            interval: meetingRoomReservation,
            timeZone: workspaceSiteConstants.location.timeZone,
          })}`,
          `Čas: ${meetingRoomReservation.startsAt}-${meetingRoomReservation.endsAt}`,
          `Délka: ${getWorkspaceMeetingRoomDurationLabel(
            meetingRoomReservation.duration,
            staffLocale
          )}`,
          meetingRoomReservation.earlySetup === true
            ? `Příprava od: ${getMeetingRoomSetupStart(
                Temporal.Instant.from(meetingRoomReservation.startsAt)
              )
                .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
                .toPlainTime()
                .toString({ smallestUnit: "minute" })}`
            : null,
        ],
      }),
      office: (officeReservation) => ({
        productLabel: getWorkspaceOfficeProductTitle(staffLocale),
        reservationRows: [
          `Termín: ${officeReservation.startsOn}-${officeReservation.endsOn}`,
          `Počet míst: ${officeReservation.seats}`,
        ],
      }),
    })
  );
  const lines = [
    "Rezervace z Deskohub Workspace po zaplacení",
    formatPaymentOrderLine(input.paymentOrderId),
    `Produkt: ${productLabel}`,
    ...reservationRows,
    `Cena: ${formatMoney(checkoutDetails.payment.expectedPrice, staffLocale)}`,
    ...checkoutDetails.payment.discounts.map(
      ({ amount, discount }) =>
        `Sleva: ${discount.staffLabel ?? discount.label} (${formatMoney(
          moneyWithValue(-amount.value, amount),
          staffLocale
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
      office: (officeReservation) => ({
        startsOn: officeReservation.startsOn,
        endsOn: officeReservation.endsOn,
        seats: officeReservation.seats,
      }),
    })
  );
