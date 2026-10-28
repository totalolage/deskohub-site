import { Option } from "effect";
import { workspaceSiteConstants } from "@/shared/utils";
import { ceilToWholeHour, floorToWholeHour } from "@/shared/utils/temporal";

const maximumHourlyAlgoPinDurationHours = 672;

/** An access span in Workspace's own precision. */
type AccessSpan = {
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
};

/**
 * The bounds an Igloohome hourly AlgoPIN is programmed with, as Prague local
 * date-times with their offset. The lock opens from the start of the hour that
 * contains the access start, so it may accept the code before the span starts.
 */
export type IgloohomeAccessWindow = {
  readonly startsAt: string;
  readonly endsAt: string;
};

const toPragueTime = (instant: Temporal.Instant) =>
  instant.toZonedDateTimeISO(workspaceSiteConstants.location.timeZone);

const toProviderTime = (value: Temporal.ZonedDateTime) =>
  value.toString({ smallestUnit: "second", timeZoneName: "never" });

/** Hourly AlgoPINs run between whole Prague hours around the span. */
const getHourlySpan = ({ startsAt, endsAt }: AccessSpan) => ({
  startsAt: floorToWholeHour(toPragueTime(startsAt)),
  endsAt: ceilToWholeHour(toPragueTime(endsAt)),
});

/**
 * Whether two access spans program the same Igloohome hours, so a code issued
 * for one also serves the other.
 */
export const isSameIgloohomeAccessWindow = (
  left: AccessSpan,
  right: AccessSpan
) => {
  const leftHours = getHourlySpan(left);
  const rightHours = getHourlySpan(right);
  return (
    leftHours.startsAt.equals(rightHours.startsAt) &&
    leftHours.endsAt.equals(rightHours.endsAt)
  );
};

/**
 * The Igloohome window that covers an access span. Igloohome only accepts a
 * window that starts in the current or a future hour, so a span that has
 * already started opens from the current Prague hour. `none` when the window
 * can't be represented by a 1–672 hour AlgoPIN.
 */
export const getIgloohomeAccessWindow = (
  span: AccessSpan & { readonly now: Temporal.Instant }
): Option.Option<IgloohomeAccessWindow> => {
  const hours = getHourlySpan(span);
  const currentHour = floorToWholeHour(toPragueTime(span.now));
  const startsAt =
    Temporal.ZonedDateTime.compare(hours.startsAt, currentHour) >= 0
      ? hours.startsAt
      : currentHour;
  const durationHours =
    (hours.endsAt.toInstant().epochMilliseconds -
      startsAt.toInstant().epochMilliseconds) /
    3_600_000;

  return Number.isInteger(durationHours) &&
    durationHours >= 1 &&
    durationHours <= maximumHourlyAlgoPinDurationHours
    ? Option.some({
        startsAt: toProviderTime(startsAt),
        endsAt: toProviderTime(hours.endsAt),
      })
    : Option.none();
};
