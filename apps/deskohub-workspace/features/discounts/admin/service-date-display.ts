import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  formatPlainDateRange,
  withPlainSpaces,
} from "@/shared/utils/date-time-format";

type DisplayedServiceDates = {
  readonly serviceDateFrom: string | null;
  readonly serviceDateUntil: string | null;
};

/**
 * The reservation start dates a code applies to, as one date or a range, or
 * "Any date" for a code without them. The range uses plain spaces so the
 * server and browser render the same text.
 */
export const formatDiscountCodeServiceDates = (
  { serviceDateFrom, serviceDateUntil }: DisplayedServiceDates,
  locale: Locale
) =>
  serviceDateFrom === null || serviceDateUntil === null
    ? m.discountsServiceDatesAny({}, { locale })
    : withPlainSpaces(
        formatPlainDateRange({
          start: Temporal.PlainDate.from(serviceDateFrom),
          end: Temporal.PlainDate.from(serviceDateUntil),
          locale,
        })
      );
