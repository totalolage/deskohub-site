import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import {
  type GoogleCalendarEvent,
  GoogleCalendarEventIdSchema,
  GoogleCalendarICalUidSchema,
} from "@deskohub/google-calendar";
import { Effect, Logger, Predicate } from "effect";
import { salesCalendarIdSchema } from "@/shared/backend/config/calendar-resource.config";
import {
  CalendarSaleConfigurationError,
  calendarSaleAppliesToBooking,
  getCalendarSaleBookingDate,
  isCalendarSaleBookableAt,
  normalizeCalendarSales,
} from "./calendar-sale";

const calendarId = salesCalendarIdSchema.make("calendar-sale-test");
const discountId = "019bfe6e-8ef0-7def-8b16-55cfbc82edc1";

const saleEvent = (
  overrides: Partial<GoogleCalendarEvent> = {}
): GoogleCalendarEvent => ({
  id: GoogleCalendarEventIdSchema.make("sale-event"),
  summary: "Synthetic sale",
  description: ` ${discountId.toUpperCase()} `,
  start: { date: "2026-11-10" },
  end: { date: "2026-11-13" },
  ...overrides,
});

const normalize = (
  events: readonly GoogleCalendarEvent[],
  bookingDate = "2026-11-11"
) => {
  const failures: CalendarSaleConfigurationError[] = [];
  const logger = Logger.make((options) => {
    for (const part of options.message as readonly unknown[]) {
      if (
        Predicate.hasProperty(part, "cause") &&
        part.cause instanceof CalendarSaleConfigurationError
      ) {
        failures.push(part.cause);
      }
    }
  });

  return normalizeCalendarSales({ calendarId, events, bookingDate }).pipe(
    Effect.provide(Logger.layer([logger])),
    Effect.map((result) => ({ ...result, failures })),
    Effect.runPromise
  );
};

describe("normalizeCalendarSales", () => {
  test("turns an all-day event into a sale over its booking window", async () => {
    const result = await normalize([saleEvent()]);

    expect(result.hasFailures).toBe(false);
    expect(result.sales).toEqual([
      {
        calendarId,
        eventReference: "sale-event",
        occurrenceReference: `${calendarId}:sale-event`,
        occurrenceDate: "2026-11-10",
        discountId,
        startsAt: "2026-11-09T23:00:00.000Z",
        expiresAt: "2026-11-12T23:00:00.000Z",
        countdownStartsAt: "2026-11-11T23:00:00.000Z",
        lastDay: "2026-11-12",
      },
    ]);
  });

  test("skips cancelled events, events without a discount, and uncovered booking dates", async () => {
    const result = await normalize([
      saleEvent({ status: "cancelled" }),
      saleEvent({ description: undefined }),
      saleEvent({ description: "   " }),
    ]);
    const outsideWindow = await normalize([saleEvent()], "2026-11-13");

    expect(result).toEqual({ sales: [], hasFailures: false, failures: [] });
    expect(outsideWindow.sales).toEqual([]);
    expect(outsideWindow.hasFailures).toBe(false);
  });

  test("keys an event without an ID by its iCal UID and start date", async () => {
    const result = await normalize([
      saleEvent({
        id: undefined,
        iCalUID: GoogleCalendarICalUidSchema.make("sale-ical-uid"),
      }),
    ]);

    expect(result.sales.map((sale) => sale.occurrenceReference)).toEqual([
      `${calendarId}:sale-ical-uid:2026-11-10`,
    ]);
  });

  test("keys a recurring occurrence by its series and original date", async () => {
    const result = await normalize([
      saleEvent({
        recurringEventId: GoogleCalendarEventIdSchema.make("sale-series"),
        originalStartTime: { date: "2026-11-10" },
      }),
    ]);

    expect(
      result.sales.map(({ occurrenceDate, occurrenceReference }) => ({
        occurrenceDate,
        occurrenceReference,
      }))
    ).toEqual([
      {
        occurrenceDate: "2026-11-10",
        occurrenceReference: `${calendarId}:sale-series:2026-11-10`,
      },
    ]);
  });

  test("reports each misconfigured event and keeps the valid sales", async () => {
    const result = await normalize([
      saleEvent({ description: "not-a-discount" }),
      saleEvent({
        id: undefined,
        iCalUID: undefined,
        description: "not-a-discount",
      }),
      saleEvent({ summary: "  " }),
      saleEvent({ summary: undefined, start: undefined, end: undefined }),
      saleEvent({
        start: { dateTime: "2026-11-10T09:00:00+01:00" },
        end: { dateTime: "2026-11-10T17:00:00+01:00" },
      }),
      saleEvent({ end: { date: "2026-11-10" } }),
      saleEvent({
        recurringEventId: GoogleCalendarEventIdSchema.make("sale-series"),
      }),
      saleEvent(),
    ]);

    expect(result.hasFailures).toBe(true);
    expect(result.sales).toHaveLength(1);
    expect(
      result.failures.map(({ reason, eventReference }) => ({
        reason,
        eventReference,
      }))
    ).toEqual([
      { reason: "invalid_discount_reference", eventReference: "sale-event" },
      { reason: "invalid_discount_reference", eventReference: undefined },
      { reason: "invalid_event", eventReference: "sale-event" },
      { reason: "invalid_event", eventReference: "sale-event" },
      { reason: "invalid_event", eventReference: "sale-event" },
      { reason: "invalid_event", eventReference: "sale-event" },
      { reason: "invalid_occurrence_reference", eventReference: "sale-event" },
    ]);
  });
});

describe("calendar sale booking window", () => {
  const sale = {
    startsAt: "2026-11-09T23:00:00.000Z",
    expiresAt: "2026-11-12T23:00:00.000Z",
    lastDay: "2026-11-12",
  };

  test("accepts bookings from the start up to the exclusive expiry", () => {
    expect(
      isCalendarSaleBookableAt(sale, Temporal.Instant.from(sale.startsAt))
    ).toBe(true);
    expect(
      isCalendarSaleBookableAt(sale, Temporal.Instant.from(sale.expiresAt))
    ).toBe(false);
    expect(
      isCalendarSaleBookableAt(
        sale,
        Temporal.Instant.from("2026-11-09T22:59:59.999Z")
      )
    ).toBe(false);
  });

  test("applies only to bookings whose service ends by the sale's last day", () => {
    const bookedAt = Temporal.Instant.from("2026-11-10T08:00:00Z");

    expect(
      calendarSaleAppliesToBooking({
        sale,
        bookedAt,
        lastServiceDate: "2026-11-12",
      })
    ).toBe(true);
    expect(
      calendarSaleAppliesToBooking({
        sale,
        bookedAt,
        lastServiceDate: "2026-11-13",
      })
    ).toBe(false);
    expect(
      calendarSaleAppliesToBooking({
        sale,
        bookedAt: Temporal.Instant.from(sale.expiresAt),
        lastServiceDate: "2026-11-12",
      })
    ).toBe(false);
  });

  test("dates a booking on the Workspace calendar", () => {
    expect(
      getCalendarSaleBookingDate(Temporal.Instant.from("2026-11-09T23:30:00Z"))
    ).toBe("2026-11-10");
  });
});
