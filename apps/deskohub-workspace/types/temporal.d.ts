import type { Temporal as TemporalPolyfill } from "@js-temporal/polyfill";

declare global {
  var Temporal: typeof TemporalPolyfill;

  namespace Temporal {
    type Duration = TemporalPolyfill.Duration;
    type Instant = TemporalPolyfill.Instant;
    type PlainDate = TemporalPolyfill.PlainDate;
    type PlainDateTime = TemporalPolyfill.PlainDateTime;
    type PlainMonthDay = TemporalPolyfill.PlainMonthDay;
    type PlainTime = TemporalPolyfill.PlainTime;
    type PlainYearMonth = TemporalPolyfill.PlainYearMonth;
    type ZonedDateTime = TemporalPolyfill.ZonedDateTime;
  }
}
