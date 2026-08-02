import type { Temporal } from "@js-temporal/polyfill";
import { siteConstants } from "@/shared/utils/constants";

export const isOpeningHoursCalendarMaintenanceTime = (
  instant: Temporal.Instant
) => instant.toZonedDateTimeISO(siteConstants.workingHours.timezone).hour === 0;
