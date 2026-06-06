import {
  type CreateDotyposReservationInput,
  type DotyposReservationStatus,
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  type Reservation,
  ValidationError,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { workspaceBookingGuestCount } from "@/features/checkout/backend/workspace-table-occupancy";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { WorkspaceTableAssignmentService } from "./workspace-table-assignment.service";

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
    const { startDate, endDate } = yield* getPragueAllDayRange(
      input.checkoutDetails.reservation.date
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
        date: input.checkoutDetails.reservation.date,
        reservationStatus: input.status,
      })
    )
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
    plainDate.toZonedDateTime({ timeZone: "Europe/Prague" }).toInstant()
      .epochMilliseconds
  );

const formatWorkspaceReservationNote = (
  input: CreateWorkspaceDotyposReservationInput
) => {
  const { checkoutDetails } = input;
  const { reservation } = checkoutDetails;
  const product = getWorkspaceProductByTier(reservation.tier);
  const lines = [
    "Deskohub workspace post-payment reservation",
    `Payment order: ${input.paymentOrderId}`,
    `Product: ${product.label}`,
    `Date: ${reservation.date}`,
    `Coffee: ${reservation.coffee ? "yes" : "no"}`,
    reservation.monitorOption ? `Monitor: ${reservation.monitorOption}` : null,
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
