import type { Schema } from "effect";
import type { WorkspaceCoworkCurrentTier } from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import type { MeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import type { CheckAvailabilityResult } from "../check-availability.schema";
import type { AgentOffering } from "../list-offerings.schema";
import type { BookingMode, ShowBookingResult } from "../show-booking.schema";

/** What the booking view opens with, from the `show_booking` call. */
export interface BookingStart {
  readonly locale: Locale;
  readonly mode: BookingMode;
  /** The Prague date the prices are for: the first bookable date. */
  readonly today: string;
  readonly offerings: ReadonlyArray<AgentOffering>;
  readonly selection: ShowBookingResult["selection"];
  /** Whether the host opens site links for the view. */
  readonly opensLinks: boolean;
}

/**
 * The view's language: the agent's `locale` argument, then the host's
 * language, where any Czech locale picks Czech, then English.
 */
export const getBookingLocale = ({
  requested,
  hostLocale,
}: {
  readonly requested?: Locale;
  readonly hostLocale?: string;
}): Locale =>
  requested ?? (hostLocale?.toLowerCase().startsWith("cs") ? "cs-CZ" : "en-US");

/** The customer's choices as the form holds them; numbers stay as typed. */
export interface BookingDraft {
  readonly family: WorkspaceReservationKind;
  readonly tier: WorkspaceCoworkCurrentTier;
  readonly duration: MeetingRoomReservationDurationKey;
  readonly date: string;
  readonly startTime: string;
  readonly dayCount: string;
  readonly seats: string;
}

/** The families the offerings include, in the order they're listed. */
export const getBookingFamilies = (
  offerings: ReadonlyArray<AgentOffering>
): ReadonlyArray<WorkspaceReservationKind> => [
  ...new Set(offerings.map(({ family }) => family)),
];

export const getFamilyOfferings = (
  offerings: ReadonlyArray<AgentOffering>,
  family: WorkspaceReservationKind
) => offerings.filter((offering) => offering.family === family);

const hoursPerDay = 24;

const getOfficeLimits = (offerings: ReadonlyArray<AgentOffering>) => {
  const office = getFamilyOfferings(offerings, "office")[0];
  return {
    maxDays: Math.floor(
      (office?.max_duration_hours ?? hoursPerDay) / hoursPerDay
    ),
    maxSeats: office?.max_seats,
  };
};

/** Days from `from` to `to`, both `YYYY-MM-DD`. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The date `days` after `date`, both `YYYY-MM-DD`. */
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

/** The choices the view opens with: the agent's prefill, else defaults. */
export const getInitialDraft = ({
  offerings,
  selection,
  today,
}: BookingStart): BookingDraft => {
  const families = getBookingFamilies(offerings);
  const family =
    selection.family && families.includes(selection.family)
      ? selection.family
      : (families[0] ?? "cowork");
  const date = selection.date ?? today;

  return {
    family,
    tier:
      selection.tier ??
      getFamilyOfferings(offerings, "cowork")[0]?.tier ??
      "open-space",
    duration:
      selection.duration ??
      getFamilyOfferings(offerings, "meeting-room")[0]?.duration ??
      "hour:1",
    date,
    startTime: selection.start_time ?? "",
    dayCount: String(
      selection.end_date ? daysBetween(date, selection.end_date) + 1 : 1
    ),
    seats: String(selection.seats ?? 1),
  };
};

/** Why a field can't be booked as entered. */
export type BookingFieldError =
  | { readonly field: "date"; readonly reason: "required" | "passed" }
  | {
      readonly field: "startTime";
      readonly reason: "required" | "whole-hour";
    }
  | { readonly field: "dayCount" | "seats"; readonly max: number };

/** The selection as tool arguments shared by availability, quote, and booking. */
export type BookingSelection = Schema.JsonObject & {
  readonly family: WorkspaceReservationKind;
};

export type BookingDraftValidation =
  | { readonly valid: true; readonly selection: BookingSelection }
  | {
      readonly valid: false;
      readonly errors: ReadonlyArray<BookingFieldError>;
    };

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const wholeHourPattern = /^\d{2}:00$/;

const parseCount = (value: string, max: number | undefined) => {
  const count = Number(value);
  return Number.isInteger(count) && count >= 1 && count <= (max ?? count)
    ? count
    : undefined;
};

/**
 * Checks the draft the way the tools would reject it, so the customer fixes
 * a field before anything is sent, and builds the tool arguments.
 */
export const validateBookingDraft = (
  draft: BookingDraft,
  { offerings, today }: Pick<BookingStart, "offerings" | "today">
): BookingDraftValidation => {
  const errors: BookingFieldError[] = [];
  if (!datePattern.test(draft.date)) {
    errors.push({ field: "date", reason: "required" });
  } else if (draft.date < today) {
    errors.push({ field: "date", reason: "passed" });
  }

  switch (draft.family) {
    case "cowork":
      return errors.length > 0
        ? { valid: false, errors }
        : {
            valid: true,
            selection: { family: "cowork", date: draft.date, tier: draft.tier },
          };
    case "meeting-room": {
      const wholeDay = draft.duration === "day:1";
      if (!wholeDay && draft.startTime === "") {
        errors.push({ field: "startTime", reason: "required" });
      } else if (!wholeDay && !wholeHourPattern.test(draft.startTime)) {
        errors.push({ field: "startTime", reason: "whole-hour" });
      }
      return errors.length > 0
        ? { valid: false, errors }
        : {
            valid: true,
            selection: {
              family: "meeting-room",
              date: draft.date,
              duration: draft.duration,
              ...(!wholeDay && { start_time: draft.startTime }),
            },
          };
    }
    case "office": {
      const { maxDays, maxSeats } = getOfficeLimits(offerings);
      const dayCount = parseCount(draft.dayCount, maxDays);
      const seats = parseCount(draft.seats, maxSeats);
      if (dayCount === undefined) {
        errors.push({ field: "dayCount", max: maxDays });
      }
      if (seats === undefined) {
        errors.push({ field: "seats", max: maxSeats ?? 1 });
      }
      return errors.length > 0 || dayCount === undefined || seats === undefined
        ? { valid: false, errors }
        : {
            valid: true,
            selection: {
              family: "office",
              date: draft.date,
              ...(dayCount > 1 && {
                end_date: addDays(draft.date, dayCount - 1),
              }),
              seats,
            },
          };
    }
  }
};

/**
 * The selection to quote and book after an availability check. A Reserved
 * Desk on a date where only workstation desks are left needs a monitor
 * configuration, as the reservation page requires; every configuration
 * costs the same, so the view takes the first.
 */
export const withRequiredWorkstation = (
  selection: BookingSelection,
  availability: CheckAvailabilityResult,
  offerings: ReadonlyArray<AgentOffering>
): BookingSelection => {
  const required = availability.days.some(({ offers }) =>
    offers?.some(
      (offer) => offer.tier === selection.tier && offer.workstation_required
    )
  );
  const monitorOption = offerings
    .find((offering) => offering.tier === selection.tier)
    ?.add_ons.find(({ id }) => id === "workstation")?.options?.[0]?.id;

  return required && monitorOption
    ? { ...selection, monitor_option: monitorOption }
    : selection;
};
