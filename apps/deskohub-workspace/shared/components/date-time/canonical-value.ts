import { Option, Predicate, Schema } from "effect";
import {
  localDateTimeSchema,
  localTimeSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";

/**
 * A control bound in the control's canonical format. A function bound is
 * read again at each check, so a bound that moves with the clock holds even
 * when the owning form has not re-rendered.
 */
export type ControlBound = string | (() => string | undefined);

export const resolveBound = (bound: ControlBound | undefined) =>
  Predicate.isFunction(bound) ? bound() : bound;

const decodePlainDate = Schema.decodeUnknownOption(plainDateStringSchema);
const decodeLocalTime = Schema.decodeUnknownOption(localTimeSchema);
const decodeLocalDateTime = Schema.decodeUnknownOption(localDateTimeSchema);

/**
 * The date a canonical `YYYY-MM-DD` value names. A date-time or otherwise
 * non-canonical string names none, rather than being re-shaped into a date.
 */
export const parseCanonicalDate = (value: string | undefined) =>
  decodePlainDate(value).pipe(
    Option.map((date) => Temporal.PlainDate.from(date)),
    Option.getOrUndefined
  );

/** The time a canonical `HH:mm` value names. */
export const parseCanonicalTime = (value: string | undefined) =>
  decodeLocalTime(value).pipe(
    Option.map((time) => Temporal.PlainTime.from(time)),
    Option.getOrUndefined
  );

/**
 * The date-time a canonical `YYYY-MM-DDTHH:mm` value names. The shared schema
 * also admits seconds, which the controls would silently drop, so a value
 * with seconds names none.
 */
export const parseCanonicalDateTime = (value: string | undefined) =>
  decodeLocalDateTime(value).pipe(
    Option.map((dateTime) => Temporal.PlainDateTime.from(dateTime)),
    Option.filter((dateTime) => dateTime.second === 0),
    Option.getOrUndefined
  );

export const formatCanonicalTime = (time: Temporal.PlainTime) =>
  time.toString({ smallestUnit: "minute" });

export const formatCanonicalDateTime = (dateTime: Temporal.PlainDateTime) =>
  dateTime.toString({ smallestUnit: "minute" });

/** The calendar's `Date` for a plain date, at noon so no offset moves the day. */
export const toCalendarDate = (date: Temporal.PlainDate) =>
  new Date(date.year, date.month - 1, date.day, 12);

export const fromCalendarDate = (date: Date) =>
  Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
