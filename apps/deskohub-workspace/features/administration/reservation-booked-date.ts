import {
  type DotyposReservation,
  type DotyposReservationId,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import { decodeBookedStart } from "@/features/reservation/backend/booked-reservation";
import {
  getMeetingRoomBookedStart,
  getMeetingRoomSetupStart,
} from "@/features/reservation/meeting-room-early-setup";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { workspaceSiteConstants } from "@/shared/utils";
import { temporalInstantToIsoString } from "@/shared/utils/temporal";
import {
  type AdministrationReservationDateRange,
  getAdministrationReservationDateRangeBounds,
} from "./reservation-date-range";

type BookedFacts = Pick<DotyposReservation, "startDate" | "endDate" | "seats">;

const decodeDotyposReservationId = Schema.decodeUnknownOption(
  DotyposReservationIdSchema
);

/** The stored details that move bookings' starts, by Dotypos booking ID. */
export type EarlySetupDetailsById = ReadonlyMap<
  DotyposReservationId,
  StoredWorkspaceReservationDetails
>;

/** The booking's stored details when they move its start. */
export const getEarlySetupDetails = (
  reservation: { readonly id?: string | undefined },
  detailsById: EarlySetupDetailsById
) =>
  Option.getOrUndefined(
    Option.flatMapNullishOr(decodeDotyposReservationId(reservation.id), (id) =>
      detailsById.get(id)
    )
  );

/**
 * The reservation's booked start, read with its stored details when the
 * caller has them. The Dotypos contract only returns readable starts, so an
 * unreadable one is a defect.
 */
export const getBookedStart = (
  reservation: BookedFacts,
  details?: StoredWorkspaceReservationDetails
) =>
  Option.getOrThrowWith(
    decodeBookedStart(reservation, details),
    () => new Error("Dotypos reservation start is unreadable.")
  );

/**
 * The booked start to show for the reservation. Only an early-setup meeting
 * room's booked start differs from the start Dotypos holds; other bookings
 * keep the provider's value as is, and a derived start uses the provider's
 * millisecond ISO format.
 */
export const getBookedStartsAt = (
  reservation: BookedFacts,
  details?: StoredWorkspaceReservationDetails
) => {
  const start = decodeBookedStart(reservation, details);
  const heldStart = decodeBookedStart(reservation);
  return Option.isSome(start) &&
    Option.isSome(heldStart) &&
    !start.value.equals(heldStart.value)
    ? temporalInstantToIsoString(start.value)
    : reservation.startDate;
};

const toWorkspaceDate = (instant: Temporal.Instant) =>
  instant
    .toZonedDateTimeISO(workspaceSiteConstants.location.timeZone)
    .toPlainDate()
    .toString();

/** The Workspace calendar date of the reservation's booked start. */
export const getReservationDate = (
  reservation: BookedFacts,
  details?: StoredWorkspaceReservationDetails
) => toWorkspaceDate(getBookedStart(reservation, details));

/**
 * Whether early setup would hold the reservation from the date before its
 * booked start, as for a meeting room booked from midnight. Only then do its
 * stored details decide its date.
 */
export const isHeldFromPreviousDateWithEarlySetup = (
  reservation: BookedFacts
) => {
  const heldStart = getBookedStart(reservation);
  return (
    toWorkspaceDate(heldStart) !==
    toWorkspaceDate(getMeetingRoomBookedStart(heldStart))
  );
};

/**
 * The bookings, given in Dotypos start order, whose stored details could
 * change that order: both bookings of each neighbouring pair that start
 * within a setup lead of each other, since early setup holds a meeting room
 * only that much before its booked start.
 */
export const getEarlySetupOrderCandidates = <Booking extends BookedFacts>(
  bookings: readonly Booking[]
) => {
  // Exports list tens of thousands of bookings, so each start decodes once.
  const heldStarts = bookings.map((booking) => getBookedStart(booking));
  const nextStartsWithinLead = (index: number) => {
    const heldStart = heldStarts[index];
    const nextHeldStart = heldStarts[index + 1];
    return (
      heldStart !== undefined &&
      nextHeldStart !== undefined &&
      Temporal.Instant.compare(
        nextHeldStart,
        getMeetingRoomBookedStart(heldStart)
      ) <= 0
    );
  };
  return bookings.filter(
    (_, index) => nextStartsWithinLead(index) || nextStartsWithinLead(index - 1)
  );
};

/**
 * The bookings in booked-start order, earliest first; bookings that start
 * together keep their order. Early setup holds a meeting room from before its
 * booked start, so Dotypos start order can put it ahead of a booking that
 * starts in between.
 */
export const sortByBookedStart = <
  Booking extends BookedFacts & { readonly id?: string | undefined },
>(
  bookings: readonly Booking[],
  detailsById: EarlySetupDetailsById
) =>
  bookings
    .map((booking) => ({
      booking,
      startsAt: getBookedStart(
        booking,
        getEarlySetupDetails(booking, detailsById)
      ),
    }))
    .toSorted((left, right) =>
      Temporal.Instant.compare(left.startsAt, right.startsAt)
    )
    .map(({ booking }) => booking);

export const isAdministrationDateInRange = (
  date: string,
  range: AdministrationReservationDateRange
) => (!range.from || date >= range.from) && (!range.to || date <= range.to);

/**
 * Dotypos start bounds that hold every booking booked in the range. Dotypos
 * holds an early-setup meeting room from before its booked start, so the
 * bounds start that much earlier; callers drop what isn't booked in range.
 */
export const getAdministrationReservationHeldRangeBounds = (
  range: AdministrationReservationDateRange
) => {
  const bounds = getAdministrationReservationDateRangeBounds(range);
  return {
    ...bounds,
    ...(bounds.startsAtOrAfter && {
      startsAtOrAfter: getMeetingRoomSetupStart(
        Temporal.Instant.from(bounds.startsAtOrAfter)
      ).toString(),
    }),
  };
};
