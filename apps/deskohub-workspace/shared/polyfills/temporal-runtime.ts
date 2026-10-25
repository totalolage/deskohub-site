/**
 * The Temporal entry points Workspace code calls, by namespace. The browser
 * gets the polyfill unless every one of them is native.
 * `temporal-runtime.test.ts` keeps this in step with the source.
 */
export const requiredTemporalApis = {
  Duration: ["from"],
  Instant: ["compare", "from", "fromEpochMilliseconds"],
  Now: ["instant", "plainDateISO", "zonedDateTimeISO"],
  PlainDate: ["compare", "from"],
  PlainDateTime: ["compare", "from"],
  PlainTime: ["from"],
  PlainYearMonth: ["from"],
  ZonedDateTime: ["compare", "from"],
} as const satisfies Record<string, readonly string[]>;

/**
 * Whether `temporal` has every entry point in `apis`, and whether the date
 * arithmetic and time zone conversions Workspace code relies on give the
 * right answers in `timeZone` across a daylight saving change. Built into the
 * `<head>` loader, and asserted by the browser entry.
 */
export function isTemporalComplete(
  // biome-ignore lint/plugin: feature-detects the host's Temporal global, which may be missing or partial.
  temporal: unknown,
  apis: Readonly<Record<string, readonly string[]>>,
  timeZone: string
): boolean {
  try {
    // biome-ignore lint/plugin: the namespaces of a host global that may be partial.
    const namespaces = temporal as Record<string, Record<string, unknown>>;
    for (const [namespace, members] of Object.entries(apis)) {
      for (const member of members) {
        // biome-ignore lint/plugin: feature detection of a host API, not parsing of input.
        if (typeof namespaces[namespace]?.[member] !== "function") return false;
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
