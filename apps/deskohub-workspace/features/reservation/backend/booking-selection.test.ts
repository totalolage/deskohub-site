import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { type DotyposTable, DotyposTableSchema } from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import type { MeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import { meetingRoomSelectionLink } from "@/features/reservation/meeting-room-selection-link";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { PlainDate } from "@/shared/utils/temporal";
import { AdvisoryAvailabilityInventory } from "./availability-inventory";
import {
  type BookingSelectionInput,
  BookingSelectionRejected,
  resolveBookingQuoteSelection,
  resolveMeetingRoomSelection,
} from "./booking-selection";

const pragueInstant = (local: string) =>
  Temporal.PlainDateTime.from(local)
    .toZonedDateTime(workspaceSiteConstants.location.timeZone)
    .toInstant();

// 15:20 in Prague, so some hourly bookings that began earlier today are
// still open; checkout and reservation links keep a selection until it ends.
const now = pragueInstant("2099-07-30T15:20");
const today = "2099-07-30" as PlainDate;
const tomorrow = "2099-07-31" as PlainDate;
const latest = "2100-01-30";

const sixSeatOffice = Schema.decodeSync(DotyposTableSchema)({
  _cloudId: "cloud",
  display: true,
  enabled: true,
  name: "office-1",
  seats: "6",
  id: "office-1",
  tags: ["reservation:office"],
});

const makeServices = ({
  officeOpen = true,
  tables = [sixSeatOffice],
}: {
  readonly officeOpen?: boolean;
  readonly tables?: readonly DotyposTable[];
} = {}) =>
  Layer.mergeAll(
    OfficeReleaseGate.fromDecision(officeOpen),
    Layer.succeed(AdvisoryAvailabilityInventory, {
      tables: Effect.succeed(tables),
      listActiveReservationsOverlapping: () => Effect.succeed([]),
      listLimitations: () => Effect.succeed([]),
    })
  );

const quote = (selection: BookingSelectionInput, services = makeServices()) =>
  Effect.runPromise(
    resolveBookingQuoteSelection({ selection, locale: "en-US", now }).pipe(
      Effect.provide(services)
    )
  );

/** The rejection reason, or the lookup failure that is no rejection. */
const rejectQuote = (
  selection: BookingSelectionInput,
  services = makeServices()
) =>
  Effect.runPromise(
    resolveBookingQuoteSelection({ selection, locale: "en-US", now }).pipe(
      Effect.flip,
      Effect.map((error) =>
        error instanceof BookingSelectionRejected ? error.reason : error
      ),
      Effect.provide(services)
    )
  );

describe("resolveBookingQuoteSelection", () => {
  test("resolves a cowork tier and date to the order the website books", async () => {
    const selection = await quote({
      family: "cowork",
      date: tomorrow,
      tier: "open-space",
      coffee: true,
    });

    expect(selection.reservationSelection).toEqual({
      kind: "cowork",
      entryTier: "open-space",
      date: tomorrow,
      coffee: true,
    });
    expect(selection.reservation).toEqual({
      kind: "cowork",
      entryTier: "open-space",
      date: tomorrow,
      coffee: true,
    });
    expect(selection.request.locale).toBe("en-US");
  });

  test("includes coffee and keeps the monitor of a Reserved Desk", async () => {
    const selection = await quote({
      family: "cowork",
      date: tomorrow,
      tier: "reserved-desk",
      monitorOption: "monitor",
    });

    expect(selection.reservation).toEqual({
      kind: "cowork",
      entryTier: "reserved-desk",
      date: tomorrow,
      coffee: true,
      monitorOption: "monitor",
    });
  });

  test("resolves a meeting-room start and duration to its Prague interval", async () => {
    const selection = await quote({
      family: "meeting-room",
      date: today,
      startTime: "16:00",
      duration: "hour:1",
    });

    expect(selection.reservationSelection).toEqual({
      kind: "meeting-room",
      duration: "hour:1",
      startDateTime: `${today}T16:00`,
    });
    expect(selection.reservation).toMatchObject({
      kind: "meeting-room",
      reservationDate: today,
      startsAt: pragueInstant(`${today}T16:00`).toString(),
      endsAt: pragueInstant(`${today}T17:00`).toString(),
    });
  });

  test("resolves office days with one seat by default", async () => {
    const selection = await quote({
      family: "office",
      date: tomorrow,
      endDate: "2099-08-01" as PlainDate,
    });

    expect(selection.reservationSelection).toEqual({
      kind: "office",
      startsOn: tomorrow,
      dayCount: 2,
      seats: 1,
    });
    expect(selection.reservation).toEqual({
      kind: "office",
      startsOn: tomorrow,
      endsOn: "2099-08-01",
      seats: 1,
    });
  });

  const invalidFields = [
    {
      name: "a cowork selection without a tier",
      selection: { family: "cowork", date: tomorrow },
      field: "tier",
    },
    {
      name: "a cowork date range",
      selection: {
        family: "cowork",
        date: tomorrow,
        endDate: "2099-08-01" as PlainDate,
        tier: "open-space",
      },
      field: "endDate",
    },
    {
      name: "coffee on a Reserved Desk, which always includes it",
      selection: {
        family: "cowork",
        date: tomorrow,
        tier: "reserved-desk",
        coffee: true,
      },
      field: "coffee",
    },
    {
      name: "a monitor on an Open Space desk",
      selection: {
        family: "cowork",
        date: tomorrow,
        tier: "open-space",
        monitorOption: "monitor",
      },
      field: "monitorOption",
    },
    {
      name: "a meeting room without a duration",
      selection: { family: "meeting-room", date: today, startTime: "16:00" },
      field: "duration",
    },
    {
      name: "an hourly meeting room without a start time",
      selection: { family: "meeting-room", date: today, duration: "hour:1" },
      field: "startTime",
    },
    {
      name: "an office range that ends before it starts",
      selection: {
        family: "office",
        date: "2099-08-01" as PlainDate,
        endDate: tomorrow,
      },
      field: "endDate",
    },
    {
      name: "more office seats than the office has",
      selection: { family: "office", date: tomorrow, seats: 7 },
      field: "seats",
    },
  ] satisfies ReadonlyArray<{
    readonly name: string;
    readonly selection: BookingSelectionInput;
    readonly field: string;
  }>;

  for (const { name, selection, field } of invalidFields) {
    test(`rejects ${name} as an invalid ${field}`, async () => {
      expect(await rejectQuote(selection)).toEqual({
        kind: "invalid-field",
        field,
      });
    });
  }

  test("rejects a cowork date past the booking horizon with the open range", async () => {
    expect(
      await rejectQuote({
        family: "cowork",
        date: "2100-01-31" as PlainDate,
        tier: "open-space",
      })
    ).toEqual({ kind: "date-out-of-range", earliest: today, latest });
  });

  test("rejects an office start in the past with the office horizon", async () => {
    const rejection = await rejectQuote({
      family: "office",
      date: "2099-07-29" as PlainDate,
    });

    expect(rejection).toMatchObject({
      kind: "date-out-of-range",
      earliest: today,
    });
  });

  test("rejects an office selection while office reservations are closed", async () => {
    expect(
      await rejectQuote(
        { family: "office", date: tomorrow },
        makeServices({ officeOpen: false })
      )
    ).toEqual({ kind: "office-closed" });
  });

  test("keeps a failed office capacity lookup apart from a rejected selection", async () => {
    const failure = await rejectQuote(
      { family: "office", date: tomorrow },
      makeServices({ tables: [] })
    );

    expect(failure).toMatchObject({ _tag: "OfficeTableUnconfigured" });
  });
});

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
      Effect.map((error) => error.reason)
    )
  );

/** The form values the reservation page shows for the selection's link. */
const openReservationLink = (
  selection: {
    readonly durationKey: MeetingRoomReservationDurationKey;
    readonly startDateTime: string;
  },
  at = now
) =>
  Effect.runPromise(
    getShareableReservationUrl({
      kind: "meeting-room",
      duration: selection.durationKey,
      startDateTime: selection.startDateTime,
    })
  ).then((url) =>
    meetingRoomSelectionLink.read(new URL(url).searchParams, {
      locale: "cs-CZ",
      now: at,
    })
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
        kind: "date-out-of-range",
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
    ).toEqual({ kind: "date-out-of-range", earliest: today, latest });
  });

  test("rejects a missing duration", async () => {
    expect(await rejectSelection({ date: today, startTime: "16:00" })).toEqual({
      kind: "invalid-field",
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
      ).toEqual({ kind: "invalid-field", field: "startTime" });
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
    ).toEqual({ kind: "invalid-field", field: "startTime" });
  });
});
