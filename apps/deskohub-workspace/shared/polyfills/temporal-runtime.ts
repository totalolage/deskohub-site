/**
 * Temporal APIs by namespace: static functions, and the methods and getters
 * on a class's prototype. A namespace with instance members is a class, so
 * must be a constructor too.
 */
export type TemporalApis = Readonly<
  Record<
    string,
    {
      readonly static?: readonly string[];
      readonly methods?: readonly string[];
      readonly getters?: readonly string[];
    }
  >
>;

/**
 * The Temporal APIs Workspace code uses. The browser gets the polyfill unless
 * every one of them is native. `temporal-runtime.test.ts` keeps this in step
 * with the source.
 */
export const requiredTemporalApis = {
  Duration: {
    static: ["from"],
    methods: ["toJSON", "toLocaleString", "toString"],
    getters: ["days"],
  },
  Instant: {
    static: [
      "compare",
      "from",
      "fromEpochMilliseconds",
      "fromEpochNanoseconds",
    ],
    methods: [
      "add",
      "equals",
      "round",
      "subtract",
      "toJSON",
      "toLocaleString",
      "toString",
      "toZonedDateTimeISO",
    ],
    getters: ["epochMilliseconds", "epochNanoseconds"],
  },
  Now: {
    static: ["instant", "plainDateISO", "zonedDateTimeISO"],
  },
  PlainDate: {
    static: ["compare", "from"],
    methods: [
      "add",
      "equals",
      "subtract",
      "toJSON",
      "toLocaleString",
      "toPlainDateTime",
      "toString",
      "toZonedDateTime",
      "until",
      "with",
    ],
    getters: [
      "day",
      "dayOfWeek",
      "daysInMonth",
      "month",
      "weekOfYear",
      "year",
      "yearOfWeek",
    ],
  },
  PlainDateTime: {
    static: ["compare", "from"],
    methods: [
      "add",
      "equals",
      "toJSON",
      "toLocaleString",
      "toPlainDate",
      "toPlainTime",
      "toString",
      "toZonedDateTime",
      "with",
    ],
    getters: [
      "hour",
      "microsecond",
      "millisecond",
      "minute",
      "nanosecond",
      "second",
    ],
  },
  PlainMonthDay: {
    methods: ["toJSON", "toLocaleString", "toString"],
  },
  PlainTime: {
    static: ["from"],
    methods: ["toJSON", "toLocaleString", "toString"],
    getters: [
      "hour",
      "microsecond",
      "millisecond",
      "minute",
      "nanosecond",
      "second",
    ],
  },
  PlainYearMonth: {
    static: ["from"],
    methods: ["toJSON", "toLocaleString", "toString"],
    getters: ["daysInMonth"],
  },
  ZonedDateTime: {
    static: ["compare"],
    methods: [
      "add",
      "equals",
      "getTimeZoneTransition",
      "startOfDay",
      "subtract",
      "toInstant",
      "toJSON",
      "toLocaleString",
      "toPlainDate",
      "toPlainDateTime",
      "toPlainTime",
      "toString",
      "with",
      "withTimeZone",
    ],
    getters: [
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
      "year",
    ],
  },
} as const satisfies TemporalApis;

/**
 * Whether a host value is a function. Unlike `instanceof Function`, this holds
 * for a function from another realm too.
 */
// biome-ignore lint/plugin: feature-detects a host value, which may be anything.
function isFunction(value: unknown): value is (...args: never[]) => unknown {
  // biome-ignore lint/plugin: feature detection of a host API, not parsing of input.
  return typeof value === "function";
}

/**
 * Whether `temporal` has every API in `apis` in a form code can call, and
 * whether the date arithmetic and time zone conversions Workspace code relies
 * on give the right answers in `timeZone` across a daylight saving change.
 * Built into the `<head>` loader, and asserted by the browser entry.
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
      // A namespace with instance members is a class, so must be a
      // constructor. `Reflect.construct` throws if it isn't, without calling it.
      if (members.methods !== undefined || members.getters !== undefined) {
        if (!isFunction(namespace)) return false;
        Reflect.construct(Object, [], namespace);
      }
      for (const member of members.static ?? []) {
        if (!isFunction(namespace?.[member])) return false;
      }
      // Read descriptors rather than values, since reading a getter off the
      // prototype throws, and only the prototype's own, so that
      // `Object.prototype`'s `toString` doesn't count.
      const prototype = Object(namespace?.prototype);
      const descriptor = (member: string) =>
        Object.getOwnPropertyDescriptor(prototype, member);
      for (const member of members.methods ?? []) {
        if (!isFunction(descriptor(member)?.value)) return false;
      }
      for (const member of members.getters ?? []) {
        if (!isFunction(descriptor(member)?.get)) return false;
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
