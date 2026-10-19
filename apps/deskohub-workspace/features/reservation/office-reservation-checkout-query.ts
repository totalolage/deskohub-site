import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  getOfficeReservationDefaultValues,
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
  getOfficeReservationSelection,
  type NormalizedOfficeReservationOrder,
  type OfficeReservationInput,
  officeReservationDayCountSchema,
  officeReservationDefaultValues,
  officeSeatsSchema,
  type StoredOfficeReservationDetails,
} from "@/features/reservation/office-reservation";
import {
  getTrimmedSearchParam,
  hasReservationSelectionSearchParams,
  type ReservationSelectionSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import { getWorkspaceDate } from "@/features/reservation/reservation-date";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import type { SupportedSearchParams } from "@/shared/utils";
import { plainDateStringSchema } from "@/shared/utils/temporal";

const queryOfficeStartsOnSchema = Schema.toStandardSchemaV1(
  plainDateStringSchema
);
const queryOfficeDayCountSchema = Schema.toStandardSchemaV1(
  Schema.FiniteFromString.pipe(Schema.decodeTo(officeReservationDayCountSchema))
);
const queryOfficeSeatsSchema = Schema.toStandardSchemaV1(
  Schema.FiniteFromString.pipe(Schema.decodeTo(officeSeatsSchema))
);

/**
 * Office form values from a link. A `startsOn` outside the booking window
 * (before today or after its last bookable day) falls back to today; the day
 * count must fit the window from that start, and seats the office capacity.
 */
export const getOfficeReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams,
  options: {
    readonly lastReservation?: CustomerLastReservationForKind<"office">;
    readonly seatCapacity: number;
    readonly today: string;
  }
): OfficeReservationInput => {
  const maximumEndsOn = getOfficeReservationMaximumEndsOn(
    Temporal.PlainDate.from(options.today)
  );
  const requestedStartsOn = decodeStandardSchema(
    queryOfficeStartsOnSchema,
    getTrimmedSearchParam(searchParams, "startsOn")
  );
  const startsOn =
    requestedStartsOn !== undefined &&
    requestedStartsOn >= options.today &&
    Temporal.PlainDate.compare(requestedStartsOn, maximumEndsOn) <= 0
      ? requestedStartsOn
      : options.today;
  const maximumDayCount = getOfficeReservationMaximumDayCount({
    startsOn,
    maximumEndsOn,
    unavailableDates: [],
  });
  const isAllowedDayCount = (dayCount: number | undefined) =>
    dayCount !== undefined && dayCount <= maximumDayCount;
  const isAllowedSeats = (seats: number | undefined) =>
    seats !== undefined && seats <= options.seatCapacity;
  const dayCount = [
    decodeStandardSchema(
      queryOfficeDayCountSchema,
      getTrimmedSearchParam(searchParams, "dayCount")
    ),
    options.lastReservation?.dayCount,
  ].find(isAllowedDayCount);
  const seats = [
    decodeStandardSchema(
      queryOfficeSeatsSchema,
      getTrimmedSearchParam(searchParams, "seats")
    ),
    options.lastReservation?.seats,
  ].find(isAllowedSeats);

  return {
    ...officeReservationDefaultValues,
    startsOn,
    ...(dayCount !== undefined && { dayCount }),
    ...(seats !== undefined && { seats }),
  };
};

/** The office selection as the link parameters the parser above reads. */
export const getOfficeReservationSelectionSearchParams = (
  selection: Pick<OfficeReservationInput, "startsOn" | "dayCount" | "seats">
): ReservationSelectionSearchParams => ({
  startsOn: selection.startsOn || undefined,
  dayCount: String(selection.dayCount),
  seats: String(selection.seats),
});

/**
 * A stored office reservation's selection as link parameters, so a retried
 * checkout reopens the form on the same start date, day count, and seats. An
 * interval that isn't whole workspace days gives no selection.
 */
export const getStoredOfficeReservationSelectionSearchParams = (
  reservation: StoredOfficeReservationDetails & {
    readonly reservedFrom: Temporal.Instant;
    readonly reservedUntil: Temporal.Instant;
    readonly seats: number;
  }
): ReservationSelectionSearchParams | undefined => {
  const selection = getOfficeReservationSelection({
    startsAt: reservation.reservedFrom,
    endsAt: reservation.reservedUntil,
    seats: reservation.seats,
  });

  if (!selection) return undefined;

  return getOfficeReservationSelectionSearchParams({
    startsOn: getWorkspaceDate(reservation.reservedFrom).toString(),
    ...selection,
  });
};

/**
 * The form values for a signed office restoration, with the selection the
 * customer edited into the URL after returning from Pay.
 */
export const getOfficeRestoredReservationValues = (
  reservation: NormalizedOfficeReservationOrder,
  searchParams: SupportedSearchParams,
  options: { readonly seatCapacity: number; readonly today: string }
): OfficeReservationInput => {
  const restoredValues = getOfficeReservationDefaultValues(reservation);
  if (
    !hasReservationSelectionSearchParams(searchParams, [
      "startsOn",
      "dayCount",
      "seats",
    ])
  ) {
    return restoredValues;
  }

  const { startsOn, dayCount, seats } =
    getOfficeReservationDefaultValuesFromSearchParams(searchParams, options);
  return { ...restoredValues, startsOn, dayCount, seats };
};
