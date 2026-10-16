import {
  DateTime,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from "effect";

/**
 * Dotypos stores timestamps such as `versionDate` and `created` with up to
 * microsecond precision and compares them at that precision in filters, which
 * is finer than `Date` and `DateTime` hold. A timestamp is therefore kept as
 * whole microseconds since the Unix epoch.
 */
export const DotyposTimestampSchema = Schema.BigInt.pipe(
  Schema.brand("DotyposTimestamp")
).annotate({
  identifier: "DotyposTimestamp",
  description:
    "A Dotypos timestamp in microseconds since the Unix epoch, the precision Dotypos stores and filters.",
});
export type DotyposTimestamp = typeof DotyposTimestampSchema.Type;

const microsecondsPerSecond = BigInt(1_000_000);
const millisecondsPerSecond = 1000;

const isoTimestampPattern =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/;

const parseDotyposTimestamp = (value: string): Option.Option<bigint> =>
  Option.fromNullishOr(isoTimestampPattern.exec(value)).pipe(
    Option.flatMap(([, wholeSeconds, fraction = "", offset]) =>
      Option.some(Date.parse(`${wholeSeconds}${offset}`)).pipe(
        Option.filter(Number.isFinite),
        Option.map(
          (milliseconds) =>
            BigInt(milliseconds / millisecondsPerSecond) *
              microsecondsPerSecond +
            BigInt(fraction.padEnd(6, "0"))
        )
      )
    )
  );

/**
 * Formats a timestamp as UTC ISO 8601 with six fraction digits, the form
 * Dotypos filters compare exactly (`versionDate|gt|2026-05-28T18:51:02.838316Z`).
 * Epoch-millisecond filter values lose the microseconds.
 */
export const formatDotyposTimestamp = (timestamp: bigint) => {
  const fraction =
    ((timestamp % microsecondsPerSecond) + microsecondsPerSecond) %
    microsecondsPerSecond;
  const wholeSeconds = new Date(
    Number((timestamp - fraction) / microsecondsPerSecond) *
      millisecondsPerSecond
  )
    .toISOString()
    .slice(0, 19);
  return `${wholeSeconds}.${fraction.toString().padStart(6, "0")}Z`;
};

/** The microsecond a `DateTime` names; `DateTime` holds whole milliseconds. */
export const dotyposTimestampFromDateTime = (
  dateTime: DateTime.DateTime
): DotyposTimestamp =>
  DotyposTimestampSchema.make(
    BigInt(DateTime.toEpochMillis(dateTime)) *
      (microsecondsPerSecond / BigInt(millisecondsPerSecond))
  );

/** Decodes an ISO 8601 instant with at most six fraction digits. */
export const DotyposTimestampFromString = Schema.String.pipe(
  Schema.decodeTo(DotyposTimestampSchema, {
    decode: SchemaGetter.transformOrFail((value: string) =>
      Option.match(parseDotyposTimestamp(value), {
        onNone: () =>
          Effect.fail(
            new SchemaIssue.InvalidValue(Option.some(value), {
              message:
                "must be an ISO 8601 instant with at most microsecond precision",
            })
          ),
        onSome: Effect.succeed,
      })
    ),
    encode: SchemaGetter.transform(formatDotyposTimestamp),
  })
).annotate({
  identifier: "DotyposTimestampFromString",
  description:
    "A Dotypos ISO 8601 timestamp decoded to microseconds since the Unix epoch.",
});
