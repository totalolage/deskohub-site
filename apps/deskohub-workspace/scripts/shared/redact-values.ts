/** Replaces every non-empty value with a marker, matching longer values first. */
export const redactValues = (text: string, values: readonly string[]): string =>
  values
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length)
    .reduce(
      (redacted, value) => redacted.replaceAll(value, "[REDACTED]"),
      text
    );
