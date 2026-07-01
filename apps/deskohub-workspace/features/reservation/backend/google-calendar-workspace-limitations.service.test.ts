import "@/shared/polyfills/temporal";
import { describe, expect, mock, test } from "bun:test";
import {
  type GoogleCalendarEvent,
  GoogleCalendarService,
} from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import {
  GoogleCalendarWorkspaceLimitationsService,
  WorkspaceCalendarLimitation,
} from "./google-calendar-workspace-limitations.service";

const runWithEvents = async (
  events: readonly GoogleCalendarEvent[],
  query = { from: "2026-06-10", to: "2026-06-11" }
) =>
  Effect.gen(function* () {
    const service = yield* GoogleCalendarWorkspaceLimitationsService;
    return yield* service.listLimitations(query);
  }).pipe(
    Effect.provide(GoogleCalendarWorkspaceLimitationsService.Live),
    Effect.provide(
      Layer.succeed(GoogleCalendarService, {
        listEvents: mock(() => Effect.succeed([...events])),
      })
    ),
    Effect.runPromise
  );

describe("GoogleCalendarWorkspaceLimitationsService", () => {
  test("translates description markers into workspace limitations", async () => {
    const limitations = await runWithEvents([
      {
        id: "partial-event",
        status: "confirmed",
        summary: "Community meetup",
        description: "[workspace:partial]",
        start: {
          dateTime: "2026-06-10T12:00:00+02:00",
          timeZone: "Europe/Prague",
        },
        end: {
          dateTime: "2026-06-10T13:00:00+02:00",
          timeZone: "Europe/Prague",
        },
      },
      {
        id: "full-event",
        status: "confirmed",
        summary: "Closed for maintenance",
        description: "Internal note [workspace:full]",
        start: {
          dateTime: "2026-06-11T12:00:00+02:00",
          timeZone: "Europe/Prague",
        },
        end: {
          dateTime: "2026-06-11T13:00:00+02:00",
          timeZone: "Europe/Prague",
        },
      },
    ]);

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.PartiallyOccupied({
        date: "2026-06-10",
        startsAt: "12:00",
        endsAt: "13:00",
        sourceEventId: "partial-event",
        summary: "Community meetup",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "full-event",
        summary: "Closed for maintenance",
      }),
    ]);
  });

  test("ignores usage markers outside event descriptions", async () => {
    const limitations = await runWithEvents([
      {
        id: "title-only-marker",
        status: "confirmed",
        summary: "[workspace:full]",
        start: { date: "2026-06-11" },
        end: { date: "2026-06-12" },
      },
    ]);

    expect(limitations).toEqual([]);
  });

  test("does not block the following day for full timed events ending at midnight", async () => {
    const limitations = await runWithEvents([
      {
        id: "full-midnight-event",
        status: "confirmed",
        description: "[workspace:full]",
        start: {
          dateTime: "2026-06-10T00:00:00+02:00",
          timeZone: "Europe/Prague",
        },
        end: {
          dateTime: "2026-06-11T00:00:00+02:00",
          timeZone: "Europe/Prague",
        },
      },
    ]);

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "full-midnight-event",
      }),
    ]);
  });

  test("keeps each occupied day before a multi-day timed event ends at midnight", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "multi-day-full-midnight-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: {
            dateTime: "2026-06-10T12:00:00+02:00",
            timeZone: "Europe/Prague",
          },
          end: {
            dateTime: "2026-06-12T00:00:00+02:00",
            timeZone: "Europe/Prague",
          },
        },
      ],
      { from: "2026-06-10", to: "2026-06-12" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "multi-day-full-midnight-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "multi-day-full-midnight-event",
      }),
    ]);
  });

  test("treats midnight in Prague as end-exclusive", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "prague-midnight-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: {
            dateTime: "2026-06-10T10:00:00Z",
          },
          end: {
            dateTime: "2026-06-10T22:00:00Z",
          },
        },
      ],
      { from: "2026-06-10", to: "2026-06-11" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "prague-midnight-event",
      }),
    ]);
  });

  test("keeps the end day for timed events ending after midnight", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "after-midnight-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: {
            dateTime: "2026-06-10T12:00:00+02:00",
            timeZone: "Europe/Prague",
          },
          end: {
            dateTime: "2026-06-12T13:00:00+02:00",
            timeZone: "Europe/Prague",
          },
        },
      ],
      { from: "2026-06-10", to: "2026-06-12" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "after-midnight-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "after-midnight-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-12",
        sourceEventId: "after-midnight-event",
      }),
    ]);
  });

  test("keeps the end day for timed events ending seconds after midnight", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "seconds-after-midnight-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: {
            dateTime: "2026-06-10T12:00:00+02:00",
            timeZone: "Europe/Prague",
          },
          end: {
            dateTime: "2026-06-12T00:00:30+02:00",
            timeZone: "Europe/Prague",
          },
        },
      ],
      { from: "2026-06-10", to: "2026-06-12" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "seconds-after-midnight-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "seconds-after-midnight-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-12",
        sourceEventId: "seconds-after-midnight-event",
      }),
    ]);
  });

  test("keeps all-day events end-exclusive", async () => {
    const limitations = await runWithEvents(
      [
        {
          id: "all-day-full-event",
          status: "confirmed",
          description: "[workspace:full]",
          start: { date: "2026-06-10" },
          end: { date: "2026-06-12" },
        },
      ],
      { from: "2026-06-10", to: "2026-06-12" }
    );

    expect(limitations).toEqual([
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-10",
        sourceEventId: "all-day-full-event",
      }),
      WorkspaceCalendarLimitation.FullyOccupied({
        date: "2026-06-11",
        sourceEventId: "all-day-full-event",
      }),
    ]);
  });
});
