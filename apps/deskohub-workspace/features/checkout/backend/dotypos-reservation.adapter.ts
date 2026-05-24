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
import {
  formatWorkspaceMoney,
  getWorkspaceProductByTier,
} from "@/features/checkout/product-catalog";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import { WORKSPACE_DOTYPOS_TABLE_ID } from "./constants";

const allDayReservationSeats = 1;
const workspaceDotyposTableIdPlaceholder =
  "TODO_REPLACE_WITH_WORKSPACE_DOTYPOS_TABLE_ID_BEFORE_PRODUCTION";

export interface CreateWorkspaceDotyposReservationInput {
  readonly paymentOrderId: string;
  readonly dotyposCustomerId: string;
  readonly checkoutDetails: CheckoutDetailsJson;
  readonly status: DotyposReservationStatus;
}

export const createWorkspaceDotyposReservation = (
  input: CreateWorkspaceDotyposReservationInput
): Effect.Effect<
  Reservation,
  ExternalAPIError | NetworkError | ValidationError,
  DotyposService
> =>
  Effect.gen(function* () {
    if (
      WORKSPACE_DOTYPOS_TABLE_ID.trim() === workspaceDotyposTableIdPlaceholder
    ) {
      return yield* Effect.fail(
        new ValidationError({
          message: "Workspace Dotypos table ID is not configured",
        })
      );
    }

    const dotypos = yield* DotyposService;
    const { startDate, endDate } = yield* getPragueAllDayRange(
      input.checkoutDetails.reservation.date
    );

    const reservationInput: CreateDotyposReservationInput = {
      customerId: input.dotyposCustomerId,
      startDate,
      endDate,
      seats: allDayReservationSeats,
      tableId: WORKSPACE_DOTYPOS_TABLE_ID,
      status: input.status,
      note: formatWorkspaceReservationNote(input),
    };

    return yield* dotypos.createReservation(reservationInput);
  });

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
    `Expected price: ${formatWorkspaceMoney(
      checkoutDetails.payment.expectedPrice,
      checkoutDetails.locale
    )}`,
    reservation.message ? `Customer note: ${reservation.message}` : null,
  ];

  return lines.filter((line) => line !== null).join("\n");
};
