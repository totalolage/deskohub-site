import type {
  CustomerAvailability,
  CustomerBookingSelection,
  CustomerMeetingRoomStartTimes,
} from "@deskohub/workspace-customer-api";
import { Equal, Option, Result } from "effect";
import type { AvailabilityQuery } from "../selection/booking-selection";
import {
  type MeetingRoomDraft,
  type MeetingRoomEnablement,
  meetingRoomAvailabilityQuery,
  meetingRoomEnablement,
  reconcileMeetingRoomDraft,
  toMeetingRoomSelection,
} from "../selection/meeting-room-selection";
import { quotableSelection } from "./booking-family-view";

/** What the meeting-room screen shows for its draft and the reads so far. */
export type MeetingRoomBookingModel = {
  /** The draft fitted to the free starts: earliest start, early setup. */
  readonly draft: MeetingRoomDraft;
  readonly enablement: MeetingRoomEnablement;
  readonly selection: Option.Option<CustomerBookingSelection>;
  readonly quotable: Option.Option<CustomerBookingSelection>;
};

/**
 * The availability query the screen reads: the settled (debounced) draft's,
 * once its free starts have loaded.
 */
export const meetingRoomQueryOf = (
  settled: MeetingRoomDraft,
  startTimes: Option.Option<CustomerMeetingRoomStartTimes>,
  now: Date
): Option.Option<AvailabilityQuery> =>
  meetingRoomAvailabilityQuery(
    reconcileMeetingRoomDraft(settled, startTimes, now),
    startTimes
  );

export const meetingRoomBookingModel = ({
  draft,
  now,
  startTimes,
  availability,
}: {
  /** The draft as the customer last changed it. */
  readonly draft: MeetingRoomDraft;
  readonly now: Date;
  /** The latest free starts read, for any date and duration. */
  readonly startTimes: Option.Option<CustomerMeetingRoomStartTimes>;
  /** The availability read for `query`, with the query it answers. */
  readonly availability: Option.Option<{
    readonly query: AvailabilityQuery;
    readonly value: CustomerAvailability;
  }>;
}): MeetingRoomBookingModel => {
  const fitted = reconcileMeetingRoomDraft(draft, startTimes, now);
  const query = meetingRoomAvailabilityQuery(fitted, startTimes);
  // Availability read for an earlier draft (inside the debounce) doesn't
  // answer this one.
  const current = Option.flatMap(availability, (read) =>
    Option.exists(query, (wanted) => Equal.equals(wanted, read.query))
      ? Option.some(read.value)
      : Option.none()
  );
  const enablement = meetingRoomEnablement(fitted, {
    now,
    startTimes,
    availability: current,
  });
  const selection = Result.getSuccess(toMeetingRoomSelection(fitted));
  return {
    draft: fitted,
    enablement,
    selection,
    quotable: quotableSelection(selection, enablement.blockers),
  };
};
