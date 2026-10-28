import { decodeStandardSchema } from "@deskohub/standard-schema";
import { Schema } from "effect";
import {
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
  getOfficeReservationSelection,
  type OfficeReservationInput,
  officeReservationDayCountSchema,
  officeReservationDefaultValues,
  officeSeatsSchema,
  type StoredOfficeReservationDetails,
} from "@/features/reservation/office-reservation";
import { getTrimmedSearchParam } from "@/features/reservation/reservation-checkout-query";
import { getWorkspaceDate } from "@/features/reservation/reservation-date";
import type { CustomerLastReservationForKind } from "@/features/reservation/reservation-existing-customer";
import { defineSelectionLink } from "@/features/reservation/selection-link";
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

type OfficeSelection = Partial<
  Pick<OfficeReservationInput, "startsOn" | "dayCount" | "seats">
>;

/**
 * The office reservation page's link. A link without a selection opens the
 * page on today.
 */
export const officeSelectionLink = defineSelectionLink({
  kind: "office",
  params: ["startsOn", "dayCount", "seats"],
  /**
   * A `startsOn` outside the booking window (before today or after its last
   * bookable day) falls back to today; the day count must fit the window from
   * that start, and seats the office capacity.
   */
  read: (
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
  },
  write: (selection: OfficeSelection) => ({
    startsOn: selection.startsOn || undefined,
    dayCount: selection.dayCount?.toString(),
    seats: selection.seats?.toString(),
  }),
  /**
   * The stored start date, day count, and seats. An interval that isn't whole
   * workspace days gives no selection.
   */
  fromStored: (
    reservation: StoredOfficeReservationDetails & {
      readonly reservedFrom: Temporal.Instant;
      readonly reservedUntil: Temporal.Instant;
      readonly seats: number;
    }
  ): OfficeSelection | undefined => {
    const selection = getOfficeReservationSelection({
      startsAt: reservation.reservedFrom,
      endsAt: reservation.reservedUntil,
      seats: reservation.seats,
    });

    if (!selection) return undefined;

    return {
      startsOn: getWorkspaceDate(reservation.reservedFrom).toString(),
      ...selection,
    };
  },
});
