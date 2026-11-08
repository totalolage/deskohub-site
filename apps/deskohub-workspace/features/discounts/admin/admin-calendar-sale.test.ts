import { describe, expect, test } from "bun:test";
import {
  GoogleCalendarEventIdSchema,
  GoogleCalendarICalUidSchema,
} from "@deskohub/google-calendar";
import type { StoredDiscountId } from "../persistence-contracts";
import { toAdminCalendarSale } from "./admin-calendar-sale";
import { untitledCalendarEventTitle } from "./calendar-sale-title";
import type { AdminDiscount } from "./discount-administration.service";

const calendarUrl = "https://calendar.google.com/";
const discountId = "019c91dd-c560-7e55-b9d8-c95065efd51d" as StoredDiscountId;
const otherDiscountId =
  "019c91dd-c560-7e55-b9d8-c95065efd52d" as StoredDiscountId;
const discounts = [
  {
    id: discountId,
    labels: { "cs-CZ": "Letní sleva", "en-US": "Summer discount" },
  },
] as readonly AdminDiscount[];

const association = (description: string | undefined) =>
  toAdminCalendarSale({ calendarUrl, discounts, event: { description } })
    .association;

describe("toAdminCalendarSale", () => {
  test("lists an event's reference, title, dates, status, and link", () => {
    expect(
      toAdminCalendarSale({
        calendarUrl,
        discounts,
        event: {
          id: GoogleCalendarEventIdSchema.make("sale-event"),
          iCalUID: GoogleCalendarICalUidSchema.make("sale-ical"),
          htmlLink: "https://calendar.google.com/event?eid=sale",
          summary: "  Summer sale  ",
          description: ` ${discountId.toUpperCase()} `,
          status: "confirmed",
          start: { date: "2026-08-01", dateTime: "2026-08-01T08:00:00Z" },
          end: { date: "2026-08-03" },
        },
      })
    ).toEqual({
      eventReference: "sale-event",
      title: "Summer sale",
      description: discountId.toUpperCase(),
      start: "2026-08-01",
      end: "2026-08-03",
      status: "confirmed",
      eventUrl: "https://calendar.google.com/event?eid=sale",
      association: {
        kind: "associated",
        discountId,
        discountLabel: "Summer discount",
      },
    });
  });

  test("falls back for an event missing its fields", () => {
    const sale = toAdminCalendarSale({
      calendarUrl,
      discounts,
      event: { summary: "   " },
    });

    expect(sale).toMatchObject({
      title: untitledCalendarEventTitle,
      description: "",
      status: "unknown",
      eventUrl: calendarUrl,
    });
    expect(sale.eventReference).toBeUndefined();
    expect(sale.start).not.toBe(sale.end);
  });

  test("references an event by its iCal UID and dates timed events by their date-time", () => {
    expect(
      toAdminCalendarSale({
        calendarUrl,
        discounts,
        event: {
          iCalUID: GoogleCalendarICalUidSchema.make("sale-ical"),
          start: { dateTime: "2026-08-01T08:00:00Z" },
          end: { dateTime: "2026-08-01T16:00:00Z" },
        },
      })
    ).toMatchObject({
      eventReference: "sale-ical",
      start: "2026-08-01T08:00:00Z",
      end: "2026-08-01T16:00:00Z",
    });
  });

  test("tells a missing, invalid, and unknown discount reference apart", () => {
    expect(association(undefined)).toEqual({ kind: "missing-description" });
    expect(association("  ")).toEqual({ kind: "missing-description" });
    expect(association("Summer sale")).toEqual({
      kind: "invalid-description",
    });
    expect(association(`${discountId} extra`)).toEqual({
      kind: "invalid-description",
    });
    expect(association(otherDiscountId)).toEqual({
      kind: "missing-discount",
      discountId: otherDiscountId,
    });
  });
});
