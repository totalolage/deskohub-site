import {
  type DotyposReservation,
  type DotyposReservationId,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Option, Schema } from "effect";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import {
  getMeetingRoomBookedStart,
  getMeetingRoomSetupStart,
} from "@/features/reservation/meeting-room-early-setup";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { workspaceSiteConstants } from "@/shared/utils";
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
  reservation: Pick<DotyposReservation, "id">,
  detailsById: EarlySetupDetailsById
) =>
  Option.getOrUndefined(
    Option.flatMapNullishOr(
      decodeDotyposReservationId(reservation.id),
      (id) => detailsById.get(id)
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
    decodeBookedReservation(reservation, details).start,
    () => new Error("Dotypos reservation start is unreadable.")
  );

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
 * change that order: those the next booking starts within a setup lead of,
 * since early setup holds a meeting room only that much before its booked
 * start.
 */
export const getEarlySetupOrderCandidates = <Booking extends BookedFacts>(
  bookings: readonly Booking[]
) =>
  bookings.filter((booking, index) => {
    const next = bookings[index + 1];
    return (
      next !== undefined &&
      Temporal.Instant.compare(
        getBookedStart(next),
        getMeetingRoomBookedStart(getBookedStart(booking))
      ) <= 0
    );
  });

/**
 * The bookings in booked-start order, earliest first; bookings that start
 * together keep their order. Early setup holds a meeting room from before its
 * booked start, so Dotypos start order can put it ahead of a booking that
 * starts in between.
 */
export const sortByBookedStart = <
  Booking extends BookedFacts & Pick<DotyposReservation, "id">,
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
