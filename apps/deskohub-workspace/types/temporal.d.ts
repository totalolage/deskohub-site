declare namespace Temporal {
  interface DurationLike {
    readonly days?: number;
  }

  class PlainDate {
    static from(item: string): PlainDate;

    add(duration: DurationLike): PlainDate;
    toZonedDateTime(item: { readonly timeZone: string }): ZonedDateTime;
  }

  interface ZonedDateTime {
    toInstant(): Instant;
  }

  interface Instant {
    readonly epochMilliseconds: number;
  }
}
