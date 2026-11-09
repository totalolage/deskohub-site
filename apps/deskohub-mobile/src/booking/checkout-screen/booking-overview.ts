import type { CustomerBookingSelection } from "@deskohub/workspace-customer-api";
import { Data, Option } from "effect";
import {
  type PragueDate,
  pragueDateTimeAt,
  pragueInstant,
} from "../selection/prague-date";

/** A meeting room's booked time: the whole day, or Prague HH:mm start to end. */
export type MeetingRoomTime = Data.TaggedEnum<{
  WholeDay: Record<never, never>;
  Hours: {
    readonly start: string;
    readonly end: string;
    /** The end's date when it falls after the booked date. */
    readonly endDate: Option.Option<PragueDate>;
  };
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

const millisecondsPerHour = 60 * 60 * 1000;
const pad = (value: number) => String(value).padStart(2, "0");

/**
 * An hourly booking's time: it ends its duration of elapsed hours after the
 * Prague start, as the server books it, so across a daylight-saving change
 * the wall clock moves by an hour more or less.
 */
const hoursOf = (
  date: PragueDate,
  startTime: string,
  hours: number
): MeetingRoomTime => {
  const [hour = 0, minute = 0] = startTime.split(":").map(Number);
  const start = pragueInstant({ date, hour, minute });
  const end = pragueDateTimeAt(
    new Date(start.getTime() + hours * millisecondsPerHour)
  );
  return MeetingRoomTime.Hours({
    start: startTime,
    end: `${pad(end.hour)}:${pad(end.minute)}`,
    endDate: end.date === date ? Option.none() : Option.some(end.date),
  });
};

const meetingRoomTime = (
  selection: CustomerBookingSelection
): Option.Option<MeetingRoomTime> => {
  const { date, duration, startTime } = selection;
  if (duration === "day:1") return Option.some(MeetingRoomTime.WholeDay());
  if (startTime === undefined) return Option.none();
  return Option.some(hoursOf(date, startTime, duration === "hour:4" ? 4 : 1));
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
