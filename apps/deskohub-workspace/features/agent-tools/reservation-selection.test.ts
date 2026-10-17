import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import {
  getMeetingRoomReservationDefaultValuesFromSearchParams,
  getMeetingRoomReservationSearchParams,
} from "@/features/reservation/meeting-room-reservation-checkout-query";
import type { MeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { resolveMeetingRoomSelection } from "./reservation-selection";

const { timeZone } = workspaceSiteConstants.location;

// 15:20 in Prague, so hourly bookings that began earlier today may still be open.
const now = Temporal.PlainDateTime.from("2099-07-30T15:20")
  .toZonedDateTime(timeZone)
  .toInstant();
const today = "2099-07-30";
const latest = "2100-01-30";

type MeetingRoomArguments = {
  readonly date: string;
  readonly startTime?: string;
  readonly duration?: MeetingRoomReservationDurationKey;
};

const resolveSelection = (selection: MeetingRoomArguments) =>
  Effect.runPromise(resolveMeetingRoomSelection({ ...selection, now }));

const rejectSelection = (selection: MeetingRoomArguments) =>
  Effect.runPromise(
    resolveMeetingRoomSelection({ ...selection, now }).pipe(
      Effect.flip,
      Effect.map((error) => error.details)
    )
  );

/** The form values the reservation page shows for the tool's link. */
const openReservationLink = (selection: {
  readonly durationKey: MeetingRoomReservationDurationKey;
  readonly startDateTime: string;
}) =>
  Effect.runPromise(
    getShareableReservationUrl(
      "meeting-room",
      getMeetingRoomReservationSearchParams({
        duration: selection.durationKey,
        startDateTime: selection.startDateTime,
      })
    )
  ).then((url) =>
    getMeetingRoomReservationDefaultValuesFromSearchParams(
      new URL(url).searchParams,
      now
    )
  );

describe("resolveMeetingRoomSelection", () => {
  const accepted = [
    {
      name: "a four-hour booking that began at 14:00",
      selection: { date: today, startTime: "14:00", duration: "hour:4" },
      startDateTime: `${today}T14:00`,
    },
    {
      name: "the earliest four-hour start still open",
      selection: { date: today, startTime: "12:00", duration: "hour:4" },
      startDateTime: `${today}T12:00`,
    },
    {
      name: "a one-hour booking that began at 15:00",
      selection: { date: today, startTime: "15:00", duration: "hour:1" },
      startDateTime: `${today}T15:00`,
    },
    {
      name: "the next whole hour",
      selection: { date: today, startTime: "16:00", duration: "hour:1" },
      startDateTime: `${today}T16:00`,
    },
    {
      name: "the rest of today",
      selection: { date: today, duration: "day:1" },
      startDateTime: `${today}T00:00`,
    },
    {
      name: "a future hourly booking",
      selection: { date: "2099-08-12", startTime: "09:00", duration: "hour:1" },
      startDateTime: "2099-08-12T09:00",
    },
  ] as const;

  for (const { name, selection, startDateTime } of accepted) {
    test(`links ${name} to the same form selection`, async () => {
      const resolved = await resolveSelection(selection);

      expect(resolved).toMatchObject({
        durationKey: selection.duration,
        startDateTime,
      });
      expect(await openReservationLink(resolved)).toMatchObject({
        duration: selection.duration,
        startDateTime,
      });
    });
  }

  const ended = [
    {
      name: "a four-hour booking that ended at 15:00",
      selection: { date: today, startTime: "11:00", duration: "hour:4" },
      pageStartDateTime: `${today}T12:00`,
    },
    {
      name: "a one-hour booking that ended at 15:00",
      selection: { date: today, startTime: "14:00", duration: "hour:1" },
      pageStartDateTime: `${today}T15:00`,
    },
    {
      name: "yesterday's whole day",
      selection: { date: "2099-07-29", duration: "day:1" },
      pageStartDateTime: `${today}T00:00`,
    },
  ] as const;

  for (const { name, selection, pageStartDateTime } of ended) {
    test(`rejects ${name}, which the page replaces too`, async () => {
      expect(await rejectSelection(selection)).toEqual({
        code: "date_out_of_range",
        earliest: today,
        latest,
      });
      expect(
        await openReservationLink({
          durationKey: selection.duration,
          startDateTime: `${selection.date}T${"startTime" in selection ? selection.startTime : "00:00"}`,
        })
      ).toMatchObject({
        duration: selection.duration,
        startDateTime: pageStartDateTime,
      });
    });
  }

  test("rejects a start past the booking horizon", async () => {
    expect(
      await rejectSelection({
        date: "2100-01-31",
        startTime: "09:00",
        duration: "hour:1",
      })
    ).toEqual({ code: "date_out_of_range", earliest: today, latest });
  });

  test("rejects a missing duration", async () => {
    expect(await rejectSelection({ date: today, startTime: "16:00" })).toEqual({
      code: "invalid_input",
      field: "duration",
    });
  });

  test("rejects an hourly booking without a whole-hour start", async () => {
    for (const startTime of [undefined, "16:30"]) {
      expect(
        await rejectSelection({
          date: today,
          duration: "hour:1",
          ...(startTime !== undefined && { startTime }),
        })
      ).toEqual({ code: "invalid_input", field: "start_time" });
    }
  });

  test("rejects an ambiguous start on the autumn DST change", async () => {
    // Prague falls back from 03:00 to 02:00 on the last Sunday of October.
    const octoberLastDay = Temporal.PlainDate.from("2099-10-31");
    const fallBack = octoberLastDay.subtract({
      days: octoberLastDay.dayOfWeek % 7,
    });

    expect(
      await rejectSelection({
        date: fallBack.toString(),
        startTime: "02:00",
        duration: "hour:1",
      })
    ).toEqual({ code: "invalid_input", field: "start_time" });
  });
});
