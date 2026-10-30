import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect, type Schema } from "effect";
import { m } from "@/features/i18n";
import { meetingRoomSelectionLink } from "@/features/reservation/meeting-room-selection-link";
import type { CheckAvailabilityResult } from "./check-availability.schema";

const {
  atInstant,
  makeAgentToolTestServices,
  makeTestOccupancy,
  workspaceDateFromToday,
  workspaceInstantToday,
} = await import("./agent-tools.test-utils");
const { checkAvailabilityTool } = await import("./check-availability.tool");

const checkAvailability = (
  args: Schema.Json,
  services = makeAgentToolTestServices(),
  now?: Temporal.Instant
) =>
  checkAvailabilityTool
    .call(args)
    .pipe(
      Effect.provide(services.layer),
      now === undefined ? (effect) => effect : atInstant(now),
      Effect.runPromise
    ) as Promise<CheckAvailabilityResult>;

const checkAvailabilityFailure = (
  args: Schema.Json,
  services = makeAgentToolTestServices()
) =>
  checkAvailabilityTool
    .call(args)
    .pipe(Effect.flip, Effect.provide(services.layer), Effect.runPromise);

describe("check_availability", () => {
  test("answers cowork days from the advisory snapshot without calling Dotypos", async () => {
    const [first, busy, last] = [1, 2, 3].map(workspaceDateFromToday);
    const services = makeAgentToolTestServices({
      occupancy: [
        makeTestOccupancy({ tableId: "open-1", date: busy! }),
        makeTestOccupancy({ tableId: "desk-1", date: busy! }),
      ],
    });

    const result = await checkAvailability(
      { family: "cowork", date: first, end_date: last },
      services
    );

    expect(result.available).toBe(false);
    expect(result.days.map(({ date, available }) => [date, available])).toEqual(
      [
        [first, true],
        [busy, false],
        [last, true],
      ]
    );
    expect(result.days[0]?.offers?.map(({ tier }) => tier)).toEqual([
      "open-space",
      "reserved-desk",
    ]);
    expect(result).toMatchObject({
      family: "cowork",
      note: m.agentToolAvailabilityAdvisoryNote({}, { locale: "en-US" }),
      reservation_url: `http://deskohub.test/reservation/cowork?entryTier=open-space&date=${first}`,
    });
    expect(Temporal.Instant.from(result.checked_at)).toBeDefined();
    expect(services.snapshotReads).toContain("reservations");
    expect(services.dotyposRequests).toEqual([]);
  });

  test("checks one cowork offer when the request names a tier", async () => {
    const date = workspaceDateFromToday(1);
    const result = await checkAvailability(
      { family: "cowork", date, tier: "reserved-desk" },
      makeAgentToolTestServices({
        occupancy: [makeTestOccupancy({ tableId: "open-1", date })],
      })
    );

    expect(result.available).toBe(true);
    expect(result.days[0]?.offers?.map(({ tier }) => tier)).toEqual([
      "reserved-desk",
    ]);
  });

  test("checks the meeting room for a start time and duration", async () => {
    const free = workspaceDateFromToday(4);
    const busy = workspaceDateFromToday(5);
    const services = makeAgentToolTestServices({
      occupancy: [makeTestOccupancy({ tableId: "room-1", date: busy })],
    });

    const freeResult = await checkAvailability(
      {
        family: "meeting-room",
        date: free,
        start_time: "09:00",
        duration: "hour:4",
      },
      services
    );
    const busyResult = await checkAvailability(
      { family: "meeting-room", date: busy, duration: "day:1" },
      services
    );

    expect(freeResult).toMatchObject({
      available: true,
      days: [{ date: free, available: true }],
      meeting_room: {
        duration: "hour:4",
        starts_at: `${free}T09:00`,
        ends_at: `${free}T13:00`,
        early_setup_available: true,
      },
      reservation_url: `http://deskohub.test/reservation/meeting-room?startDateTime=${free}T09%3A00&duration=hour%3A4`,
    });
    expect(busyResult).toMatchObject({
      available: false,
      meeting_room: {
        starts_at: `${busy}T00:00`,
        early_setup_available: false,
      },
    });
    expect(services.dotyposRequests).toEqual([]);
  });

  test("reports the setup time before a free start as taken when the room is booked until the start", async () => {
    const [booked, next] = [5, 6].map(workspaceDateFromToday);
    const services = makeAgentToolTestServices({
      occupancy: [makeTestOccupancy({ tableId: "room-1", date: booked! })],
    });

    const midnight = await checkAvailability(
      { family: "meeting-room", date: next!, duration: "day:1" },
      services
    );
    const morning = await checkAvailability(
      {
        family: "meeting-room",
        date: next!,
        start_time: "09:00",
        duration: "hour:4",
      },
      services
    );

    expect(midnight).toMatchObject({
      available: true,
      meeting_room: {
        starts_at: `${next}T00:00`,
        early_setup_available: false,
      },
    });
    expect(morning).toMatchObject({
      available: true,
      meeting_room: { early_setup_available: true },
    });
    expect(services.dotyposRequests).toEqual([]);
  });

  test("checks today's whole meeting-room day in the afternoon and links the same selection", async () => {
    const now = workspaceInstantToday("15:20");
    const [today, tomorrow] = [0, 1].map(workspaceDateFromToday);

    const result = await checkAvailability(
      { family: "meeting-room", date: today!, duration: "day:1" },
      makeAgentToolTestServices(),
      now
    );

    expect(result).toMatchObject({
      available: true,
      meeting_room: {
        duration: "day:1",
        starts_at: `${today}T00:00`,
        ends_at: `${tomorrow}T00:00`,
      },
      reservation_url: `http://deskohub.test/reservation/meeting-room?startDateTime=${today}T00%3A00&duration=day%3A1`,
    });
    expect(
      meetingRoomSelectionLink.read(
        new URL(result.reservation_url).searchParams,
        { now }
      )
    ).toMatchObject({ duration: "day:1", startDateTime: `${today}T00:00` });
  });

  test("checks every office date and the seat capacity", async () => {
    const [first, busy, last] = [1, 2, 3].map(workspaceDateFromToday);
    const services = makeAgentToolTestServices({
      occupancy: [makeTestOccupancy({ tableId: "office-1", date: busy! })],
    });

    const busyRange = await checkAvailability(
      { family: "office", date: first, end_date: last, seats: 2 },
      services
    );
    const tooManySeats = await checkAvailability(
      { family: "office", date: first, seats: 7 },
      services
    );

    expect(busyRange).toMatchObject({
      available: false,
      days: [
        { date: first, available: true },
        { date: busy, available: false },
        { date: last, available: true },
      ],
      office: { seats: 2, max_seats: 6 },
      reservation_url: `http://deskohub.test/reservation/office?startsOn=${first}&dayCount=3&seats=2`,
    });
    expect(tooManySeats).toMatchObject({
      available: false,
      days: [{ date: first, available: true }],
      office: { seats: 7, max_seats: 6 },
    });
    expect(services.dotyposRequests).toEqual([]);
  });

  test("links a later office range on its start date with its days and seats", async () => {
    const startsOn = workspaceDateFromToday(2);
    const result = await checkAvailability({
      family: "office",
      date: startsOn,
      end_date: workspaceDateFromToday(3),
    });

    expect(result.reservation_url).toBe(
      `http://deskohub.test/reservation/office?startsOn=${startsOn}&dayCount=2&seats=1`
    );
  });

  test("rejects selections outside the bookable dates", async () => {
    const past = await checkAvailabilityFailure({
      family: "cowork",
      date: workspaceDateFromToday(-1),
    });
    const tooLong = await checkAvailabilityFailure({
      family: "cowork",
      date: workspaceDateFromToday(1),
      end_date: workspaceDateFromToday(40),
    });
    const officeTooFar = await checkAvailabilityFailure({
      family: "office",
      date: workspaceDateFromToday(45),
    });

    expect(past.details).toMatchObject({
      code: "date_out_of_range",
      earliest: workspaceDateFromToday(0),
    });
    expect(tooLong.details).toEqual({
      code: "date_out_of_range",
      earliest: workspaceDateFromToday(1),
      latest: workspaceDateFromToday(31),
    });
    expect(officeTooFar.details).toMatchObject({ code: "date_out_of_range" });
  });

  test("names the argument a family needs but the call lacks", async () => {
    const date = workspaceDateFromToday(2);

    const noDuration = await checkAvailabilityFailure({
      family: "meeting-room",
      date,
      start_time: "09:00",
    });
    const noStart = await checkAvailabilityFailure({
      family: "meeting-room",
      date,
      duration: "hour:1",
    });
    const badDate = await checkAvailabilityFailure({
      family: "cowork",
      date: "next friday",
    });
    const reversed = await checkAvailabilityFailure({
      family: "office",
      date,
      end_date: workspaceDateFromToday(1),
    });

    expect(noDuration.details).toEqual({
      code: "invalid_input",
      field: "duration",
    });
    expect(noStart.details).toEqual({
      code: "invalid_input",
      field: "start_time",
    });
    expect(badDate.details).toEqual({ code: "invalid_input", field: "date" });
    expect(reversed.details).toEqual({
      code: "invalid_input",
      field: "end_date",
    });
  });

  test("reports the office as unsupported while office reservations are closed", async () => {
    const failure = await checkAvailabilityFailure(
      { family: "office", date: workspaceDateFromToday(1) },
      makeAgentToolTestServices({ officeEnabled: false })
    );

    expect(failure.details).toEqual({ code: "unsupported_family" });
  });
});
