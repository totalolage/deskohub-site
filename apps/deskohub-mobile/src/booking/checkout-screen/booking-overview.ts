import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import { Data, Option } from "effect";
import type { PragueDate } from "../selection/prague-date";

/** A meeting room's booked time: the whole day, or Prague HH:mm start to end. */
export type MeetingRoomTime = Data.TaggedEnum<{
  WholeDay: Record<never, never>;
  Hours: { readonly start: string; readonly end: string };
}>;
export const MeetingRoomTime = Data.taggedEnum<MeetingRoomTime>();

/**
 * When the booking is for, as the review states it above the price: a cowork
 * date, a meeting room's date and time with early setup, or an office's
 * inclusive dates and seats.
 */
export type BookingOverview = Data.TaggedEnum<{
  Cowork: { readonly date: PragueDate };
  MeetingRoom: {
    readonly date: PragueDate;
    /** None for an hourly booking without a start, which checkout refuses. */
    readonly time: Option.Option<MeetingRoomTime>;
    readonly earlySetup: boolean;
  };
  Office: {
    readonly firstDate: PragueDate;
    /** The last booked day, inclusive; the first for a one-day booking. */
    readonly lastDate: PragueDate;
    readonly seats: number;
  };
}>;
export const BookingOverview = Data.taggedEnum<BookingOverview>();

const minutesPerDay = 24 * 60;
const pad = (value: number) => String(value).padStart(2, "0");

/** HH:mm `hours` after `time`, on a 24-hour clock. */
const addHours = (time: string, hours: number) => {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const minutes = (hour * 60 + minute + hours * 60) % minutesPerDay;
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
};

const meetingRoomTime = (
  selection: CustomerBookingSelection
): Option.Option<MeetingRoomTime> => {
  const { duration, startTime } = selection;
  if (duration === "day:1") return Option.some(MeetingRoomTime.WholeDay());
  if (startTime === undefined) return Option.none();
  const hours = duration === "hour:4" ? 4 : 1;
  return Option.some(
    MeetingRoomTime.Hours({ start: startTime, end: addHours(startTime, hours) })
  );
};

/** The booked selection's dates, times and seats; early setup is checkout's. */
export const bookingOverviewOf = (
  selection: CustomerBookingSelection,
  earlySetup: boolean
): BookingOverview => {
  switch (selection.family) {
    case "cowork":
      return BookingOverview.Cowork({ date: selection.date });
    case "meeting-room":
      return BookingOverview.MeetingRoom({
        date: selection.date,
        time: meetingRoomTime(selection),
        earlySetup,
      });
    case "office":
      return BookingOverview.Office({
        firstDate: selection.date,
        lastDate: selection.endDate ?? selection.date,
        seats: selection.seats ?? 1,
      });
  }
};
