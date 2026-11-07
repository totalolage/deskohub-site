import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { toCoworkSelection } from "../selection/cowork-selection";
import { toMeetingRoomSelection } from "../selection/meeting-room-selection";
import { toOfficeSelection } from "../selection/office-selection";
import {
  BookingOverview,
  bookingOverviewOf,
  MeetingRoomTime,
} from "./booking-overview";

const meetingRoom = (
  duration: "hour:1" | "hour:4" | "day:1",
  startTime: Option.Option<string>
) => {
  const selection = toMeetingRoomSelection({
    date: "2026-11-20",
    duration,
    startTime,
    earlySetup: false,
  });
  if (selection._tag === "Failure") throw new Error("incomplete selection");
  return selection.success;
};

describe("bookingOverviewOf", () => {
  test("cowork names the booked date", () => {
    const selection = toCoworkSelection({
      tier: "reserved-desk",
      date: "2026-11-20",
      coffee: false,
      workstation: Option.none(),
    });
    expect(bookingOverviewOf(selection, false)).toEqual(
      BookingOverview.Cowork({ date: "2026-11-20" })
    );
  });

  test("an hourly meeting room ends its duration after the start", () => {
    expect(
      bookingOverviewOf(meetingRoom("hour:4", Option.some("09:00")), false)
    ).toEqual(
      BookingOverview.MeetingRoom({
        date: "2026-11-20",
        time: Option.some(
          MeetingRoomTime.Hours({
            start: "09:00",
            end: "13:00",
            endDate: Option.none(),
          })
        ),
        earlySetup: false,
      })
    );
    expect(
      bookingOverviewOf(meetingRoom("hour:1", Option.some("17:00")), false)
    ).toMatchObject({
      time: Option.some(
        MeetingRoomTime.Hours({
          start: "17:00",
          end: "18:00",
          endDate: Option.none(),
        })
      ),
    });
  });

  test("an hourly meeting room ends after its elapsed hours across DST", () => {
    const at = (
      date: string,
      startTime: string,
      duration: "hour:1" | "hour:4"
    ) =>
      bookingOverviewOf(
        { family: "meeting-room", date, duration, startTime },
        false
      );
    // Spring: 01:00 plus one hour is 03:00, as 02:00 is skipped.
    expect(at("2027-03-28", "01:00", "hour:1")).toMatchObject({
      time: Option.some({ start: "01:00", end: "03:00" }),
    });
    // Autumn: 01:00 plus four hours is 04:00, as 02:00 to 03:00 repeats.
    expect(at("2026-10-25", "01:00", "hour:4")).toMatchObject({
      time: Option.some({ start: "01:00", end: "04:00" }),
    });
  });

  test("a meeting room ending after midnight names the end's date", () => {
    expect(
      bookingOverviewOf(
        {
          family: "meeting-room",
          date: "2026-11-20",
          duration: "hour:4",
          startTime: "22:00",
        },
        false
      )
    ).toMatchObject({
      time: Option.some({ end: "02:00", endDate: Option.some("2026-11-21") }),
    });
  });

  test("a whole-day meeting room with early setup keeps both", () => {
    expect(
      bookingOverviewOf(meetingRoom("day:1", Option.none()), true)
    ).toEqual(
      BookingOverview.MeetingRoom({
        date: "2026-11-20",
        time: Option.some(MeetingRoomTime.WholeDay()),
        earlySetup: true,
      })
    );
  });

  test("an office spans its inclusive dates with its seats", () => {
    expect(
      bookingOverviewOf(
        toOfficeSelection({ date: "2026-11-30", dayCount: 3, seats: 2 }),
        false
      )
    ).toEqual(
      BookingOverview.Office({
        firstDate: "2026-11-30",
        lastDate: "2026-12-02",
        seats: 2,
      })
    );
  });

  test("a one-day office starts and ends on its date", () => {
    expect(
      bookingOverviewOf(
        toOfficeSelection({ date: "2026-11-30", dayCount: 1, seats: 1 }),
        false
      )
    ).toMatchObject({ firstDate: "2026-11-30", lastDate: "2026-11-30" });
  });
});
