import {
  type CreateDotyposReservationInput,
  type DotyposReservationStatus,
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
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
import { getReservationDate } from "@/features/reservation/reservation-interval";
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
  readonly dotyposCustomerId: string;
  readonly checkoutDetails: CheckoutDetailsJson;
  readonly reservation: WorkspaceTableAssignmentReservation;
  readonly status: DotyposReservationStatus;
}

export const createWorkspaceDotyposReservation: (
  input: CreateWorkspaceDotyposReservationInput
) => Effect.Effect<
  Reservation,
  ExternalAPIError | NetworkError | ValidationError,
  DotyposService | WorkspaceTableAssignmentService
> = Effect.fn("createWorkspaceDotyposReservation")(
  function* (input) {
    yield* Effect.annotateLogsScoped({ input });
    yield* Effect.logInfo(
      "Workspace Dotypos reservation creation input received"
    );

    const dotypos = yield* DotyposService;
    const tableAssignments = yield* WorkspaceTableAssignmentService;
    const { startDate, endDate } = yield* getDotyposReservationDateRange(
      input.reservation
    );
    const tableId = yield* tableAssignments.assignTableId(input.reservation);

    const reservationInput: CreateDotyposReservationInput = {
      customerId: input.dotyposCustomerId,
      startDate,
      endDate,
      seats: workspaceBookingGuestCount,
      tableId,
      status: input.status,
      note: formatWorkspaceReservationNote(input),
    };
    yield* Effect.annotateLogsScoped({ reservationInput });
    yield* Effect.logInfo("Workspace Dotypos reservation input built");

    yield* Effect.logInfo("Workspace Dotypos reservation creation started");
    const reservation = yield* dotypos.createReservation(reservationInput);
    yield* Effect.annotateLogsScoped({ reservation });
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

const getDotyposReservationDateRange = (
  reservation: WorkspaceTableAssignmentReservation
) =>
  Match.value(reservation).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: ({ date }) => getPragueAllDayRange(date),
      "meeting-room": ({ endsAt, startsAt }) =>
        Effect.succeed({
          startDate: temporalInstantToDate(Temporal.Instant.from(startsAt)),
          endDate: temporalInstantToDate(Temporal.Instant.from(endsAt)),
        }),
    })
  );

const getPragueAllDayRange = (
  date: string
): Effect.Effect<{ startDate: Date; endDate: Date }, ValidationError> =>
  Effect.try({
    try: () => {
      const reservationDate = Temporal.PlainDate.from(date);
      return {
        startDate: toPragueMidnightDate(reservationDate),
        endDate: toPragueMidnightDate(reservationDate.add({ days: 1 })),
      };
    },
    catch: () =>
      new ValidationError({
        message: `Workspace reservation date must be a valid YYYY-MM-DD date: ${date}`,
      }),
  });

const toPragueMidnightDate = (plainDate: Temporal.PlainDate) =>
  new Date(
    plainDate
      .toZonedDateTime({ timeZone: workspaceSiteConstants.location.timeZone })
      .toInstant().epochMilliseconds
  );

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
