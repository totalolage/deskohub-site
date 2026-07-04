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
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import {
  getReservationDurationMinutes,
  getReservationPragueDate,
  getReservationPragueDateRange,
} from "@/features/reservation/schemas/reservation-interval";
import { WorkspaceTableAssignmentService } from "./workspace-table-assignment.service";
import { workspaceBookingGuestCount } from "./workspace-table-occupancy";

export interface CreateWorkspaceDotyposReservationInput {
  readonly paymentOrderId: string;
  readonly dotyposCustomerId: string;
  readonly checkoutDetails: CheckoutDetailsJson;
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
    const { startDate, endDate } = yield* getReservationDateRange(
      input.checkoutDetails.reservation
    );
    const tableId = yield* tableAssignments.assignTableId(
      input.checkoutDetails.reservation
    );

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
        entryTier: input.checkoutDetails.reservation.tier,
        date: getReservationPragueDate(input.checkoutDetails.reservation),
        reservationStatus: input.status,
      })
    )
);

const getReservationDateRange = (
  reservation: CheckoutDetailsJson["reservation"]
): Effect.Effect<{ startDate: Date; endDate: Date }, ValidationError> =>
  getReservationPragueDateRange(reservation).pipe(
    Effect.mapError(
      (cause) =>
        new ValidationError({
          message:
            "Workspace reservation interval must be valid for Dotypos reservation creation.",
          cause,
        })
    )
  );

const formatWorkspaceReservationNote = (
  input: CreateWorkspaceDotyposReservationInput
) => {
  const { checkoutDetails } = input;
  const { reservation } = checkoutDetails;
  const product = getWorkspaceProductByTier(reservation.tier);
  const coworkRows = Match.value(reservation).pipe(
    Match.when({ tier: "meeting-room" }, () => []),
    Match.orElse((coworkReservation) => [
      `Coffee: ${coworkReservation.coffee ? "yes" : "no"}`,
      ...(coworkReservation.monitorOption
        ? [`Monitor: ${coworkReservation.monitorOption}`]
        : []),
    ])
  );
  const lines = [
    "Deskohub workspace post-payment reservation",
    `Payment order: ${input.paymentOrderId}`,
    `Product: ${product.label}`,
    `Date: ${getReservationPragueDate(reservation)}`,
    `Time: ${reservation.startsAt}-${reservation.endsAt}`,
    `Duration: ${getReservationDurationMinutes(reservation)} minutes`,
    ...coworkRows,
    `Price: ${formatWorkspaceMoney(
      checkoutDetails.payment.expectedPrice,
      checkoutDetails.locale
    )}`,
    checkoutDetails.payment.customerDiscount
      ? `Customer discount: ${checkoutDetails.payment.customerDiscount.percent}% (${formatWorkspaceMoney(
          checkoutDetails.payment.customerDiscount.amount,
          checkoutDetails.locale
        )})`
      : null,
  ];

  return lines.filter((line) => line !== null).join("\n");
};
