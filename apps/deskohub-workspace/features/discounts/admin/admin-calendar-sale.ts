import type {
  GoogleCalendarEventId,
  GoogleCalendarICalUid,
} from "@deskohub/google-calendar";
import { Option, Schema } from "effect";
import {
  type StoredDiscountId,
  storedDiscountIdSchema,
} from "../persistence-contracts";
import { untitledCalendarEventTitle } from "./calendar-sale-title";
import type {
  AdminCalendarSale,
  AdminDiscount,
} from "./discount-administration.service";

type CalendarEventBoundary = {
  readonly date?: string;
  readonly dateTime?: string;
};

/**
 * A sales Calendar event as the administration lists it, with the discount
 * its description names. Missing event fields fall back to placeholders.
 */
export const toAdminCalendarSale = (input: {
  readonly calendarUrl: string;
  readonly discounts: readonly AdminDiscount[];
  readonly event: {
    readonly id?: GoogleCalendarEventId;
    readonly iCalUID?: GoogleCalendarICalUid;
    readonly htmlLink?: string;
    readonly summary?: string;
    readonly description?: string;
    readonly status?: string;
    readonly start?: CalendarEventBoundary;
    readonly end?: CalendarEventBoundary;
  };
}): AdminCalendarSale => {
  const description = input.event.description?.trim() ?? "";

  return {
    eventReference: input.event.id ?? input.event.iCalUID ?? undefined,
    title: input.event.summary?.trim() || untitledCalendarEventTitle,
    description,
    start: getCalendarEventBoundary(input.event.start, "Unknown start"),
    end: getCalendarEventBoundary(input.event.end, "Unknown end"),
    status: input.event.status ?? "unknown",
    eventUrl: input.event.htmlLink ?? input.calendarUrl,
    association: toCalendarSaleAssociation(description, input.discounts),
  };
};

/** An all-day boundary's date, else a timed one's date-time. */
const getCalendarEventBoundary = (
  boundary: CalendarEventBoundary | undefined,
  unknown: string
) => boundary?.date ?? boundary?.dateTime ?? unknown;

/** The discount a sale's description names: exactly one discount UUID. */
const toCalendarSaleAssociation = (
  description: string,
  discounts: readonly AdminDiscount[]
): AdminCalendarSale["association"] => {
  if (description.length === 0) return { kind: "missing-description" };

  return Option.match(
    Schema.decodeUnknownOption(storedDiscountIdSchema)(
      description.toLowerCase()
    ),
    {
      onNone: () => ({ kind: "invalid-description" }),
      onSome: (discountId) => toDiscountAssociation(discountId, discounts),
    }
  );
};

const toDiscountAssociation = (
  discountId: StoredDiscountId,
  discounts: readonly AdminDiscount[]
): AdminCalendarSale["association"] => {
  const discount = discounts.find(({ id }) => id === discountId);

  return discount
    ? {
        kind: "associated",
        discountId: discount.id,
        discountLabel: discount.labels["en-US"],
      }
    : { kind: "missing-discount", discountId };
};
