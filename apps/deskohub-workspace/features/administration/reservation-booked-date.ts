import type { DotyposReservation } from "@deskohub/dotypos";
import { Option } from "effect";
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
