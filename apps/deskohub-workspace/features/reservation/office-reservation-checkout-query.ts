import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
  type OfficeReservationInput,
  officeReservationDayCountSchema,
  officeReservationDefaultValues,
  officeSeatsSchema,
} from "@/features/reservation/office-reservation";
import { getTrimmedSearchParam } from "@/features/reservation/reservation-checkout-query";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import type { SupportedSearchParams } from "@/shared/utils";

const queryOfficeDayCountSchema = Schema.toStandardSchemaV1(
  Schema.FiniteFromString.pipe(Schema.decodeTo(officeReservationDayCountSchema))
);
const queryOfficeSeatsSchema = Schema.toStandardSchemaV1(
  Schema.FiniteFromString.pipe(Schema.decodeTo(officeSeatsSchema))
);

/**
 * The query of a link that opens the office form on a selection, which
 * `getOfficeReservationDefaultValuesFromSearchParams` reads back. The form
 * always starts on the current date.
 */
export const getOfficeReservationSearchParams = (selection: {
  readonly dayCount?: number;
  readonly seats?: number;
}) =>
  new URLSearchParams({
    ...(selection.dayCount !== undefined && {
      dayCount: String(selection.dayCount),
    }),
    ...(selection.seats !== undefined && { seats: String(selection.seats) }),
  });

export const getOfficeReservationDefaultValuesFromSearchParams = (
  searchParams: SupportedSearchParams,
  options: {
    readonly lastReservation?: CustomerLastReservationForKind<"office">;
    readonly seatCapacity: number;
    readonly startsOn: string;
  }
): OfficeReservationInput => {
  const maximumDayCount = getOfficeReservationMaximumDayCount({
    startsOn: options.startsOn,
    maximumEndsOn: getOfficeReservationMaximumEndsOn(
      Temporal.PlainDate.from(options.startsOn)
    ),
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
    startsOn: options.startsOn,
    ...(dayCount !== undefined && { dayCount }),
    ...(seats !== undefined && { seats }),
  };
};
