export const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

/**
 * Formats a count with the locale's digit grouping: "1,000" in English,
 * "1 000" (with a no-break space) in Czech.
 */
export const formatCount = (count: number, locale: string) =>
  new Intl.NumberFormat(locale).format(count);

/** A run of consecutive integers, from `first` to `last` inclusive. */
interface IntegerRun {
  readonly first: number;
  readonly last: number;
}

/**
 * Integers grouped into runs of consecutive values, in ascending order:
 * `[11, 9, 10, 14]` gives 9–11 and 14–14. Duplicates count once.
 */
export const consecutiveRuns = (
  values: Iterable<number>
): readonly IntegerRun[] =>
  [...new Set(values)]
    .sort((left, right) => left - right)
    .reduce<IntegerRun[]>((runs, value) => {
      const run = runs.at(-1);
      if (run && value === run.last + 1) {
        runs[runs.length - 1] = { first: run.first, last: value };
      } else {
        runs.push({ first: value, last: value });
      }
      return runs;
    }, []);

export const formatNamesWithNumericRanges = (
  names: readonly (string | null | undefined)[]
): string => {
  const seenNames = new Set<string>();
  const numericValues: number[] = [];
  const otherNames: string[] = [];

  for (const candidate of names) {
    const name = candidate?.trim();
    if (!name || seenNames.has(name)) continue;

    seenNames.add(name);

    if (/^(0|[1-9]\d*)$/.test(name)) {
      const value = Number(name);
      if (Number.isSafeInteger(value)) {
        numericValues.push(value);
        continue;
      }
    }

    otherNames.push(name);
  }

  // The pattern above admits only canonical numerals, so each value prints
  // back as its name.
  const formattedNumericNames = consecutiveRuns(numericValues).flatMap(
    ({ first, last }) =>
      last - first >= 2
        ? [`${first}-${last}`]
        : Array.from({ length: last - first + 1 }, (_, index) =>
            String(first + index)
          )
  );

  return [...formattedNumericNames, ...otherNames].join(", ");
};
