export type DurationUnit = {
  readonly value: number;
  readonly unit: "day" | "hour" | "minute" | "second";
};

export const formatDuration = (
  units: readonly DurationUnit[],
  locale: string
) =>
  new Intl.ListFormat(locale, {
    style: "long",
    type: "conjunction",
  }).format(
    units.map(({ value, unit }) =>
      new Intl.NumberFormat(locale, {
        style: "unit",
        unit,
        unitDisplay: "long",
      }).format(value)
    )
  );
