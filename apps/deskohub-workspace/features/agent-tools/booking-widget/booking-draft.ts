import {
  baseLocale,
  matchSupportedLocale,
} from "@deskohub/i18n/locale-registry";
import { Schema, SchemaGetter } from "effect";
import {
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { type Locale, m } from "@/features/i18n";
import { meetingRoomReservationDurationKeySchema } from "@/features/reservation/meeting-room-reservation-duration";
import {
  type WorkspaceReservationKind,
  workspaceReservationKindSchema,
} from "@/features/reservation/reservation-kind";
import { isPlainDateString } from "@/shared/utils/temporal";
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
 * language (from its context, else ChatGPT's bridge), matched by its language
 * subtag, then English.
 */
export const getBookingLocale = ({
  requested,
  hostLocale,
}: {
  readonly requested?: Locale;
  readonly hostLocale?: string;
}): Locale => requested ?? matchSupportedLocale(hostLocale ?? "") ?? baseLocale;

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

/** Days from `from` to `to`, both `YYYY-MM-DD`. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

/** The date `days` after `date`, both `YYYY-MM-DD`. */
const addDays = (date: string, days: number) =>
  new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);

type BookingPrefill = ShowBookingResult["selection"];

/** The prefilled family when the offerings include it, else the first listed. */
const getInitialFamily = (
  offerings: ReadonlyArray<AgentOffering>,
  requested: BookingPrefill["family"]
): WorkspaceReservationKind => {
  const families = getBookingFamilies(offerings);
  return requested && families.includes(requested)
    ? requested
    : (families[0] ?? "cowork");
};

const getInitialTier = (
  offerings: ReadonlyArray<AgentOffering>,
  requested: BookingPrefill["tier"]
) =>
  requested ?? getFamilyOfferings(offerings, "cowork")[0]?.tier ?? "open-space";

const getInitialDuration = (
  offerings: ReadonlyArray<AgentOffering>,
  requested: BookingPrefill["duration"]
) =>
  requested ??
  getFamilyOfferings(offerings, "meeting-room")[0]?.duration ??
  "hour:1";

/** The office days from `date` through the prefilled end date, else one. */
const getInitialDayCount = (
  date: string,
  endDate: BookingPrefill["end_date"]
) => String(endDate ? daysBetween(date, endDate) + 1 : 1);

/** The choices the view opens with: the agent's prefill, else defaults. */
export const getInitialDraft = ({
  offerings,
  selection,
  today,
}: BookingStart): BookingDraft => {
  const date = selection.date ?? today;

  return {
    family: getInitialFamily(offerings, selection.family),
    tier: getInitialTier(offerings, selection.tier),
    duration: getInitialDuration(offerings, selection.duration),
    date,
    startTime: selection.start_time ?? "",
    dayCount: getInitialDayCount(date, selection.end_date),
    seats: String(selection.seats ?? 1),
  };
};

/** The selection as tool arguments shared by availability, quote, and booking. */
const bookingSelectionSchema = Schema.Union([
  Schema.Struct({
    family: Schema.Literal("cowork"),
    date: Schema.String,
    tier: Schema.Literals(workspaceCoworkCurrentTiers),
    monitor_option: Schema.optionalKey(
      Schema.Literals(workspaceProductMonitorOptions)
    ),
  }),
  Schema.Struct({
    family: Schema.Literal("meeting-room"),
    date: Schema.String,
    duration: meetingRoomReservationDurationKeySchema,
    start_time: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    family: Schema.Literal("office"),
    date: Schema.String,
    end_date: Schema.optionalKey(Schema.String),
    seats: Schema.Int,
  }),
]);

export type BookingSelection = typeof bookingSelectionSchema.Type;

/** The customer's choices as the form holds them; numbers stay as typed. */
const bookingDraftSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  tier: Schema.Literals(workspaceCoworkCurrentTiers),
  duration: meetingRoomReservationDurationKeySchema,
  date: Schema.String,
  startTime: Schema.String,
  dayCount: Schema.String,
  seats: Schema.String,
});

export type BookingDraft = typeof bookingDraftSchema.Type;

const wholeMeetingRoomDay = "day:1";

const wholeHourPattern = /^\d{2}:00$/;

// The view only reads the form; nothing turns tool arguments back into it.
const formOnly = <T, E>() =>
  SchemaGetter.forbidden<T, E>(
    () => "The booking view doesn't encode a selection into its form."
  );

/** A whole count from a number field, from 1 to `max`. */
const countFromInput = (max: number | undefined, message: string) =>
  Schema.FiniteFromString.check(
    Schema.isInt({ message }),
    max === undefined
      ? Schema.isGreaterThanOrEqualTo(1, { message })
      : Schema.isBetween({ minimum: 1, maximum: max }, { message })
  );

/**
 * Validates the draft the way the tools would reject it, in the view's
 * language, so the customer fixes a field before anything is sent. Only the
 * chosen family's fields count; the draft keeps the others for when the
 * customer switches back. Decodes to the tool arguments.
 */
export const makeBookingDraftSchema = ({
  locale,
  offerings,
  today,
}: Pick<BookingStart, "locale" | "offerings" | "today">) => {
  const date = Schema.String.check(
    isPlainDateString({ message: m.bookingWidgetDateRequired({}, { locale }) }),
    Schema.makeFilter((value: string) => value >= today, {
      message: m.bookingWidgetDatePassed({}, { locale }),
    })
  );
  const office = getFamilyOfferings(offerings, "office")[0];
  const maxDays = Math.floor(
    (office?.max_duration_hours ?? hoursPerDay) / hoursPerDay
  );
  const maxSeats = office?.max_seats;

  return Schema.Union([
    Schema.Struct({
      ...bookingDraftSchema.fields,
      family: Schema.Literal("cowork"),
      date,
    }).pipe(
      Schema.decodeTo(bookingSelectionSchema.members[0], {
        decode: SchemaGetter.transform(({ family, date, tier }) => ({
          family,
          date,
          tier,
        })),
        encode: formOnly(),
      })
    ),
    Schema.Struct({
      ...bookingDraftSchema.fields,
      family: Schema.Literal("meeting-room"),
      date,
    })
      .check(
        Schema.makeFilter(({ duration, startTime }) => {
          if (duration === wholeMeetingRoomDay) return undefined;
          if (startTime === "") {
            return {
              path: ["startTime"],
              issue: m.bookingWidgetStartTimeRequired({}, { locale }),
            };
          }
          return (
            wholeHourPattern.test(startTime) || {
              path: ["startTime"],
              issue: m.reservationValidationMeetingRoomStartWholeHour(
                {},
                { locale }
              ),
            }
          );
        })
      )
      .pipe(
        Schema.decodeTo(bookingSelectionSchema.members[1], {
          decode: SchemaGetter.transform(
            ({ family, date, duration, startTime }) => ({
              family,
              date,
              duration,
              ...(duration !== wholeMeetingRoomDay && {
                start_time: startTime,
              }),
            })
          ),
          encode: formOnly(),
        })
      ),
    Schema.Struct({
      ...bookingDraftSchema.fields,
      family: Schema.Literal("office"),
      date,
      dayCount: countFromInput(
        maxDays,
        m.bookingWidgetDayCountRange({ max: maxDays }, { locale })
      ),
      seats: countFromInput(
        maxSeats,
        m.bookingWidgetSeatCountRange({ max: maxSeats ?? 1 }, { locale })
      ),
    }).pipe(
      Schema.decodeTo(bookingSelectionSchema.members[2], {
        decode: SchemaGetter.transform(({ family, date, dayCount, seats }) => ({
          family,
          date,
          ...(dayCount > 1 && { end_date: addDays(date, dayCount - 1) }),
          seats,
        })),
        encode: formOnly(),
      })
    ),
  ]);
};

export type BookingDraftSchema = ReturnType<typeof makeBookingDraftSchema>;

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
  if (selection.family !== "cowork") return selection;
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
