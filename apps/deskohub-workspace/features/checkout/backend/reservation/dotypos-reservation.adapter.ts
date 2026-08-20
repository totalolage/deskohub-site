import {
  type CreateDotyposReservationInput,
  type DotyposCustomerId,
  type DotyposReservationStatus,
  DotyposService,
  type DotyposTableId,
  type ExternalAPIError,
  type NetworkError,
  type Reservation,
  ValidationError,
} from "@deskohub/dotypos";
import { Effect, Match } from "effect";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceMeetingRoomProductTitle,
  getWorkspaceOfficeProductTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { CheckoutDetails } from "@/features/checkout/schemas/checkout-details";
import {
  formatWorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { getReservationDate } from "@/features/reservation/reservation-interval";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import {
  getWorkspaceReservationInterval,
  type WorkspaceTableAssignmentReservation,
  WorkspaceTableAssignmentService,
} from "./workspace-table-assignment.service";
import { workspaceBookingSeatCount } from "./workspace-table-occupancy";

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
    const { startsAt, endsAt } = yield* getWorkspaceReservationInterval(
      input.reservation
    ).pipe(
      Effect.mapError(
        (cause) => new ValidationError({ message: cause.message, cause })
      )
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
          `Duration: ${getWorkspaceMeetingRoomDurationLabel(
            meetingRoomReservation.duration,
            checkoutDetails.locale
          )}`,
        ],
      }),
      office: (officeReservation) => ({
        productLabel: getWorkspaceOfficeProductTitle(checkoutDetails.locale),
        reservationRows: [
          `Dates: ${officeReservation.startsOn}-${officeReservation.endsOn}`,
          `Seats: ${officeReservation.seats}`,
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
      office: (officeReservation) => ({
        startsOn: officeReservation.startsOn,
        endsOn: officeReservation.endsOn,
        seats: officeReservation.seats,
      }),
    })
  );
