/**
 * Temporal APIs by namespace: static members, which must be functions, and
 * instance members, which are methods or getters on the namespace's
 * prototype.
 */
export type TemporalApis = Readonly<
  Record<
    string,
    {
      readonly static?: readonly string[];
      readonly prototype?: readonly string[];
    }
  >
>;

/**
 * The Temporal APIs Workspace code uses. The browser gets the polyfill unless
 * every one of them is native. `temporal-runtime.test.ts` keeps this in step
 * with the source.
 */
export const requiredTemporalApis = {
  Duration: { static: ["from"], prototype: ["days"] },
  Instant: {
    static: ["compare", "from", "fromEpochMilliseconds"],
    prototype: [
      "add",
      "epochMilliseconds",
      "epochNanoseconds",
      "equals",
      "round",
      "subtract",
      "toString",
      "toZonedDateTimeISO",
    ],
  },
  Now: { static: ["instant", "plainDateISO", "zonedDateTimeISO"] },
  PlainDate: {
    static: ["compare", "from"],
    prototype: [
      "add",
      "day",
      "dayOfWeek",
      "daysInMonth",
      "equals",
      "month",
      "subtract",
      "toLocaleString",
      "toPlainDateTime",
      "toString",
      "toZonedDateTime",
      "until",
      "weekOfYear",
      "with",
      "year",
      "yearOfWeek",
    ],
  },
  PlainDateTime: {
    static: ["compare", "from"],
    prototype: [
      "add",
      "equals",
      "hour",
      "microsecond",
      "millisecond",
      "minute",
      "nanosecond",
      "second",
      "toPlainDate",
      "toPlainTime",
      "toString",
      "toZonedDateTime",
      "with",
    ],
  },
  PlainTime: {
    static: ["from"],
    prototype: [
      "hour",
      "microsecond",
      "millisecond",
      "minute",
      "nanosecond",
      "second",
      "toString",
    ],
  },
  PlainYearMonth: { static: ["from"], prototype: ["daysInMonth"] },
  ZonedDateTime: {
    static: ["compare"],
    prototype: [
      "add",
      "equals",
      "getTimeZoneTransition",
      "hour",
      "hoursInDay",
      "microsecond",
      "millisecond",
      "minute",
      "month",
      "nanosecond",
      "offset",
      "offsetNanoseconds",
      "second",
      "startOfDay",
      "subtract",
      "toInstant",
      "toPlainDate",
      "toPlainDateTime",
      "toPlainTime",
      "toString",
      "with",
      "withTimeZone",
      "year",
    ],
  },
} as const satisfies TemporalApis;

/**
 * Whether `temporal` has every API in `apis`, and whether the date arithmetic
 * and time zone conversions Workspace code relies on give the right answers
 * in `timeZone` across a daylight saving change. Built into the `<head>`
 * loader, and asserted by the browser entry.
 */
export function isTemporalComplete(
  // biome-ignore lint/plugin: feature-detects the host's Temporal global, which may be missing or partial.
  temporal: unknown,
  apis: TemporalApis,
  timeZone: string
): boolean {
  try {
    // biome-ignore lint/plugin: the namespaces of a host global that may be partial.
    const namespaces = temporal as Record<string, Record<string, unknown>>;
    for (const [name, members] of Object.entries(apis)) {
      const namespace = namespaces[name];
      for (const member of members.static ?? []) {
        // biome-ignore lint/plugin: feature detection of a host API, not parsing of input.
        if (typeof namespace?.[member] !== "function") return false;
      }
      // Reading a getter off the prototype throws, so only check that the
      // prototype defines the member itself rather than inheriting
      // `Object.prototype`'s `toString`.
      const prototype = Object(namespace?.prototype);
      for (const member of members.prototype ?? []) {
        if (!Object.hasOwn(prototype, member)) return false;
      }
    }

    // Central European clocks skip 02:00–03:00 on 2026-03-29.
    const { Instant, PlainDate, PlainDateTime } = temporal as typeof Temporal;
    const afterChange = Instant.from("2026-03-29T01:30:00Z");
    return (
      PlainDate.from("2026-03-28").add({ days: 1 }).toZonedDateTime(timeZone)
        .hoursInDay === 23 &&
      PlainDateTime.from("2026-03-29T03:30")
        .toZonedDateTime(timeZone)
        .toInstant()
        .equals(afterChange) &&
      afterChange.toZonedDateTimeISO(timeZone).toPlainTime().toString() ===
        "03:30:00"
    );
  } catch {
    return false;
  }
}
