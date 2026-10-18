import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import {
  getMeetingRoomReservationDefaultValuesFromSearchParams,
  getMeetingRoomReservationSelectionSearchParams,
} from "@/features/reservation/meeting-room-reservation-checkout-query";
import type { MeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { resolveMeetingRoomSelection } from "./reservation-selection";

const pragueInstant = (local: string) =>
  Temporal.PlainDateTime.from(local)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

// 15:20 in Prague, so some hourly bookings that began earlier today are
// still open; checkout and reservation links keep a selection until it ends.
const now = pragueInstant("2099-07-30T15:20");
const today = "2099-07-30";
const latest = "2100-01-30";

type MeetingRoomArguments = {
  readonly date: string;
  readonly startTime?: string;
  readonly duration?: MeetingRoomReservationDurationKey;
};

const resolveSelection = (selection: MeetingRoomArguments, at = now) =>
  Effect.runPromise(resolveMeetingRoomSelection({ ...selection, now: at }));

const rejectSelection = (selection: MeetingRoomArguments) =>
  Effect.runPromise(
    resolveMeetingRoomSelection({ ...selection, now }).pipe(
      Effect.flip,
      Effect.map((error) => error.details)
    )
  );

/** The form values the reservation page shows for the tool's link. */
const openReservationLink = (
  selection: {
    readonly durationKey: MeetingRoomReservationDurationKey;
    readonly startDateTime: string;
  },
  at = now
) =>
  Effect.runPromise(
    getShareableReservationUrl(
      "meeting-room",
      getMeetingRoomReservationSelectionSearchParams({
        duration: selection.durationKey,
        startDateTime: selection.startDateTime,
      })
    )
  ).then((url) =>
    getMeetingRoomReservationDefaultValuesFromSearchParams(
      new URL(url).searchParams,
      at
    )
  );

describe("resolveMeetingRoomSelection", () => {
  const accepted = [
    {
      name: "a one-hour booking at the next whole hour",
      selection: { date: today, startTime: "16:00", duration: "hour:1" },
      startDateTime: `${today}T16:00`,
    },
    {
      name: "a four-hour booking at the next whole hour",
      selection: { date: today, startTime: "16:00", duration: "hour:4" },
      startDateTime: `${today}T16:00`,
    },
    {
      name: "a four-hour booking that began at 14:00",
      selection: { date: today, startTime: "14:00", duration: "hour:4" },
      startDateTime: `${today}T14:00`,
    },
    {
      name: "a four-hour booking that began at 12:00",
      selection: { date: today, startTime: "12:00", duration: "hour:4" },
      startDateTime: `${today}T12:00`,
    },
    {
      name: "a one-hour booking that began at 15:00",
      selection: { date: today, startTime: "15:00", duration: "hour:1" },
      startDateTime: `${today}T15:00`,
    },
    {
      name: "a future hourly booking",
      selection: { date: "2099-08-12", startTime: "09:00", duration: "hour:1" },
      startDateTime: "2099-08-12T09:00",
    },
    {
      name: "a future whole day",
      selection: { date: "2099-08-12", duration: "day:1" },
      startDateTime: "2099-08-12T00:00",
    },
    {
      name: "today's whole day",
      selection: { date: today, duration: "day:1" },
      startDateTime: `${today}T00:00`,
    },
    {
      name: "a whole day named with a start time",
      selection: { date: today, startTime: "09:00", duration: "day:1" },
      startDateTime: `${today}T00:00`,
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

  test("links today's whole day to the same form selection just before it ends", async () => {
    const lastMinute = pragueInstant("2099-07-30T23:59");
    const resolved = await resolveSelection(
      { date: today, duration: "day:1" },
      lastMinute
    );

    expect(await openReservationLink(resolved, lastMinute)).toMatchObject({
      duration: "day:1",
      startDateTime: `${today}T00:00`,
    });
  });

  test("links a start exactly at now to the same form selection", async () => {
    const atStart = pragueInstant("2099-07-30T16:00");
    const resolved = await resolveSelection(
      { date: today, startTime: "16:00", duration: "hour:1" },
      atStart
    );

    expect(await openReservationLink(resolved, atStart)).toMatchObject({
      duration: "hour:1",
      startDateTime: `${today}T16:00`,
    });
  });

  const ended = [
    {
      name: "a four-hour booking that ended at 15:00",
      selection: { date: today, startTime: "11:00", duration: "hour:4" },
      earliest: today,
    },
    {
      name: "a one-hour booking that ended at 15:00",
      selection: { date: today, startTime: "14:00", duration: "hour:1" },
      earliest: today,
    },
    {
      name: "yesterday's whole day",
      selection: { date: "2099-07-29", duration: "day:1" },
      earliest: today,
    },
  ] as const;

  for (const { name, selection, earliest } of ended) {
    test(`rejects ${name}`, async () => {
      expect(await rejectSelection(selection)).toEqual({
        code: "date_out_of_range",
        earliest,
        latest,
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
