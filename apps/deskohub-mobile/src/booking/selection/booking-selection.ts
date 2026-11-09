import type {
  CustomerAvailabilityQuery,
  CustomerBookingSelection,
  CustomerReservationFamily,
} from "@deskohub/workspace-customer-api";
import { Data } from "effect";
import type { ReservationKind } from "../../analytics/events";
import type { PragueDate } from "./prague-date";

/** An availability request, as the booking contract's query takes it. */
export type AvailabilityQuery = typeof CustomerAvailabilityQuery.Type;

/**
 * The dates a selection screen's calendar offers: `earliest` through
 * `latest`, inclusive, without the `unavailable` ones.
 */
export type DateChoice = {
  readonly earliest: PragueDate;
  readonly latest: PragueDate;
  readonly unavailable: ReadonlySet<string>;
};

/** Whether the calendar lets the customer pick `date`. */
export const isDateSelectable = (choice: DateChoice, date: PragueDate) =>
  date >= choice.earliest &&
  date <= choice.latest &&
  !choice.unavailable.has(date);

/** A draft that can't name a booking yet: `missing` lists what it lacks. */
export class SelectionIncomplete extends Data.TaggedClass(
  "SelectionIncomplete"
)<{ readonly missing: ReadonlyArray<keyof CustomerBookingSelection> }> {}

// Every selection field, in the one order the key lists them.
const selectionKeyFields = [
  "date",
  "endDate",
  "startTime",
  "duration",
  "tier",
  "monitorOption",
  "seats",
  "coffee",
] as const satisfies ReadonlyArray<keyof CustomerBookingSelection>;

/**
 * A stable string for one selection, the same for equal selections however
 * their objects were built, so quotes can be cached per selection.
 */
export const selectionKey = (selection: CustomerBookingSelection): string =>
  [
    selection.family,
    ...selectionKeyFields.flatMap((field) => {
      const value = selection[field];
      return value === undefined ? [] : [`${field}=${String(value)}`];
    }),
  ].join("&");

/**
 * The selection without the options it spells out as `undefined`. Equal
 * selections share one quote, and a request can encode an absent option only
 * by leaving it out.
 */
export const withoutAbsentOptions = (
  selection: CustomerBookingSelection
): CustomerBookingSelection =>
  Object.fromEntries(
    Object.entries(selection).filter(([, value]) => value !== undefined)
  ) as CustomerBookingSelection;

const reservationKinds: Record<CustomerReservationFamily, ReservationKind> = {
  cowork: "cowork",
  "meeting-room": "meeting_room",
  office: "office",
};

/** The analytics reservation kind of an API reservation family. */
export const reservationKindOf = (
  family: CustomerReservationFamily
): ReservationKind => reservationKinds[family];
