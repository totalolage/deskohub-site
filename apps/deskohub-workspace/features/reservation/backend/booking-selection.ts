import { Data, Effect, Match, Schema } from "effect";
import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import {
  type CoworkCoffeeAddonAvailability,
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  type WorkspaceCoworkCurrentTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkCurrentTiers,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-advisory-seat-capacity";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import {
  getCoworkAdvertisedPriceReservation,
  isCoworkOpenSpaceDayCutoffReached,
} from "@/features/reservation/cowork-reservation";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { meetingRoomStartDateTimeSchema } from "@/features/reservation/meeting-room-reservation";
import {
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDuration,
  type MeetingRoomReservationDurationKey,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { hasReservationIntervalEnded } from "@/features/reservation/reservation-interval";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import type { ReservationSelection } from "@/features/reservation/selection-path";
import { getWorkspaceAvailabilityRange } from "@/features/reservation/workspace-availability";
import { getPlainDatesBetween, type PlainDate } from "@/shared/utils/temporal";

/**
 * What a customer or their agent names when choosing a booking. Fields that
 * don't apply to the family are ignored or rejected the way the booking pages
 * treat them.
 */
export type BookingSelectionInput = {
  readonly family: WorkspaceReservationKind;
  /** The Prague date; for an office or a cowork range, the first date. */
  readonly date: PlainDate;
  /** Cowork or office only: the last date, inclusive. Defaults to `date`. */
  readonly endDate?: PlainDate;
  /** Meeting room only: the Prague start time in HH:mm on the hour. */
  readonly startTime?: string;
  readonly duration?: MeetingRoomReservationDurationKey;
  /** Office only. Defaults to 1. */
  readonly seats?: number;
  readonly tier?: WorkspaceCoworkCurrentTier;
  readonly coffee?: boolean;
  readonly monitorOption?: WorkspaceProductMonitorOption;
};

export type BookingSelectionField = keyof BookingSelectionInput;

/** Why the booking pages would not accept a selection. */
export type BookingSelectionRejection =
  | { readonly kind: "invalid-field"; readonly field: BookingSelectionField }
  | {
      /** The dates the selection could take instead, inclusive. */
      readonly kind: "date-out-of-range";
      readonly earliest: string;
      readonly latest: string;
    }
  | { readonly kind: "office-closed" };

/**
 * A selection the booking pages would not accept. Provider and capacity
 * lookups that fail along the way keep their own errors instead.
 */
export class BookingSelectionRejected extends Data.TaggedError(
  "BookingSelectionRejected"
)<{ readonly reason: BookingSelectionRejection }> {
  static invalidField = (field: BookingSelectionField) =>
    new BookingSelectionRejected({ reason: { kind: "invalid-field", field } });

  static dateOutOfRange = (range: {
    readonly earliest: string;
    readonly latest: string;
  }) =>
    new BookingSelectionRejected({
      reason: { kind: "date-out-of-range", ...range },
    });

  static officeClosed = () =>
    new BookingSelectionRejected({ reason: { kind: "office-closed" } });
}

/**
 * The PII-free fields of the reservation order a selection books; a booking
 * adds the customer's contact and billing.
 */
export type SelectedReservation =
  | {
      readonly kind: "cowork";
      readonly date: string;
      readonly entryTier: WorkspaceCoworkCurrentTier;
      readonly coffee: boolean;
      readonly monitorOption?: WorkspaceProductMonitorOption;
    }
  | {
      readonly kind: "meeting-room";
      readonly duration: MeetingRoomReservationDuration;
      readonly reservationDate: string;
      readonly startsAt: ReservationInterval["startsAt"];
      readonly endsAt: ReservationInterval["endsAt"];
      /** Set only by a booking, never by a quote: setup costs nothing. */
      readonly earlySetup?: true;
    }
  | {
      readonly kind: "office";
      readonly startsOn: string;
      readonly endsOn: string;
      readonly seats: number;
    };

/** A complete selection as the price request, page link, and order it makes. */
export type QuoteSelection = {
  readonly request: AdvertisedPriceRequest;
  /** Names every quoted option, so the page fills nothing from history. */
  readonly reservationSelection: ReservationSelection;
  readonly reservation: SelectedReservation;
};

type QuoteSelectionRequest = {
  readonly selection: BookingSelectionInput;
  readonly locale: Locale;
  readonly now: Temporal.Instant;
};

/** The most days one cowork request covers. */
const coworkMaximumDayCount = 31;

/**
 * Resolves a complete selection the way the booking pages accept it: dates
 * inside the booking horizon, offers still open, and options the product
 * offers.
 */
export const resolveBookingQuoteSelection = (request: QuoteSelectionRequest) =>
  Match.value(request.selection.family).pipe(
    Match.when("cowork", () => getCoworkQuoteSelection(request)),
    Match.when("meeting-room", () => getMeetingRoomQuoteSelection(request)),
    Match.when("office", () => getOfficeQuoteSelection(request)),
    Match.exhaustive
  );

/** Fails with `office-closed` while office reservations are closed. */
export const ensureOfficeOpen = OfficeReleaseGate.isOpen.pipe(
  Effect.filterOrFail(
    (enabled) => enabled,
    () => BookingSelectionRejected.officeClosed()
  ),
  Effect.asVoid
);

/** The dates of a cowork request, inside the advisory calendar range. */
export const resolveCoworkDates = Effect.fn(
  "bookingSelection.resolveCoworkDates"
)(
  ({
    date,
    endDate = date,
    today,
  }: {
    readonly date: string;
    readonly endDate?: string;
    readonly today: Temporal.PlainDate;
  }) =>
    Effect.Do.pipe(
      Effect.tap(() => ensureDateOrder({ date, endDate })),
      Effect.tap(() =>
        ensureWithin({
          dates: [date, endDate],
          ...getWorkspaceAvailabilityRange(today.toString()),
        })
      ),
      Effect.let("dates", () =>
        getPlainDatesBetween(
          Temporal.PlainDate.from(date),
          Temporal.PlainDate.from(endDate)
        )
      ),
      Effect.filterOrFail(
        ({ dates }) => dates.length <= coworkMaximumDayCount,
        () =>
          BookingSelectionRejected.dateOutOfRange({
            earliest: date,
            latest: Temporal.PlainDate.from(date)
              .add({ days: coworkMaximumDayCount - 1 })
              .toString(),
          })
      ),
      Effect.map(({ dates }) => dates.map((day) => day.toString()))
    )
);

/** Whether a cowork offer can still start on a date, given the time of day. */
export const isCoworkOfferOpen = (input: {
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly date: string;
  readonly now: Temporal.Instant;
}) => !isCoworkOpenSpaceDayCutoffReached(input);

/** The current cowork offers, or the one a request names. */
export const getRequestedCoworkTiers = (
  tier: WorkspaceCoworkCurrentTier | undefined
): ReadonlyArray<WorkspaceCoworkCurrentTier> =>
  tier ? [tier] : workspaceCoworkCurrentTiers;

/** A meeting-room selection resolved to its duration and Prague interval. */
export const resolveMeetingRoomSelection = Effect.fn(
  "bookingSelection.resolveMeetingRoomSelection"
)(
  (input: {
    readonly date: string;
    readonly startTime?: string;
    readonly duration?: MeetingRoomReservationDurationKey;
    readonly now: Temporal.Instant;
  }) =>
    Effect.Do.pipe(
      Effect.bind("durationKey", () =>
        requireField(input.duration, "duration")
      ),
      Effect.let("duration", ({ durationKey }) =>
        getMeetingRoomReservationDuration(durationKey)
      ),
      Effect.bind("startDateTime", ({ duration }) =>
        decodeMeetingRoomStart({ ...input, duration })
      ),
      Effect.bind("interval", ({ startDateTime, duration }) =>
        requireField(
          getMeetingRoomReservationInterval(startDateTime, duration),
          "startTime"
        )
      ),
      Effect.tap(({ duration, interval }) =>
        ensureMeetingRoomSelectionOpen({ ...input, duration, interval })
      ),
      Effect.map(({ durationKey, duration, startDateTime, interval }) => ({
        durationKey,
        duration,
        startDateTime,
        interval,
      }))
    )
);

/** An office date range inside the booking horizon and the duration limit. */
export const resolveOfficeRange = Effect.fn(
  "bookingSelection.resolveOfficeRange"
)(
  ({
    date,
    endDate = date,
    today,
  }: {
    readonly date: PlainDate;
    readonly endDate?: PlainDate;
    readonly today: Temporal.PlainDate;
  }) =>
    Effect.Do.pipe(
      Effect.tap(() => ensureDateOrder({ date, endDate })),
      Effect.let("maximumEndsOn", () =>
        getOfficeReservationMaximumEndsOn(today)
      ),
      Effect.tap(({ maximumEndsOn }) =>
        ensureWithin({
          dates: [date],
          from: today.toString(),
          to: maximumEndsOn.toString(),
        })
      ),
      Effect.let("latest", ({ maximumEndsOn }) =>
        Temporal.PlainDate.from(date)
          .add({
            days:
              getOfficeReservationMaximumDayCount({
                startsOn: date,
                maximumEndsOn,
                unavailableDates: [],
              }) - 1,
          })
          .toString()
      ),
      Effect.tap(({ latest }) =>
        ensureWithin({ dates: [endDate], from: date, to: latest })
      ),
      Effect.map(() => ({
        startsOn: date,
        endsOn: endDate,
        dates: getPlainDatesBetween(
          Temporal.PlainDate.from(date),
          Temporal.PlainDate.from(endDate)
        ).map((day) => day.toString()),
      }))
    )
);

const getCoworkQuoteSelection = Effect.fn(
  "bookingSelection.getCoworkQuoteSelection"
)((request: QuoteSelectionRequest) =>
  Effect.succeed(request).pipe(
    Effect.bind("entryTier", ({ selection }) => requireCoworkTier(selection)),
    Effect.tap(({ selection }) => ensureSingleCoworkDate(selection)),
    Effect.let("today", ({ now }) => getCurrentWorkspaceDate(now)),
    Effect.tap(({ selection, today }) =>
      resolveCoworkDates({ date: selection.date, today })
    ),
    Effect.tap(ensureCoworkOfferOpen),
    Effect.let("coffeeAddon", ({ entryTier }) =>
      getCoworkTierCoffeeAddon(entryTier)
    ),
    Effect.tap(ensureCoworkAddonsOffered),
    Effect.let("offer", toCoworkOffer),
    Effect.map(
      ({ locale, offer }): QuoteSelection => ({
        request: {
          locale,
          reservation: getCoworkAdvertisedPriceReservation(offer),
        },
        reservationSelection: { kind: "cowork", ...offer },
        reservation: { kind: "cowork", ...offer },
      })
    )
  )
);

const requireCoworkTier = ({ tier }: BookingSelectionInput) =>
  Effect.succeed(tier).pipe(
    Effect.filterOrFail(
      (entryTier) => entryTier !== undefined,
      () => BookingSelectionRejected.invalidField("tier")
    )
  );

/** A cowork booking covers one date; checkout has no cowork date range. */
const ensureSingleCoworkDate = ({ date, endDate }: BookingSelectionInput) =>
  Effect.succeed(endDate).pipe(
    Effect.filterOrFail(
      (end) => end === undefined || end === date,
      () => BookingSelectionRejected.invalidField("endDate")
    ),
    Effect.asVoid
  );

const ensureCoworkOfferOpen = ({
  selection,
  entryTier,
  now,
  today,
}: {
  readonly selection: BookingSelectionInput;
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly now: Temporal.Instant;
  readonly today: Temporal.PlainDate;
}) =>
  Effect.succeed({ entryTier, date: selection.date, now }).pipe(
    Effect.filterOrFail(isCoworkOfferOpen, () =>
      BookingSelectionRejected.dateOutOfRange({
        earliest: today.add({ days: 1 }).toString(),
        latest: getWorkspaceAvailabilityRange(today.toString()).to,
      })
    ),
    Effect.asVoid
  );

const ensureCoworkAddonsOffered = ({
  selection,
  entryTier,
  coffeeAddon,
}: {
  readonly selection: BookingSelectionInput;
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly coffeeAddon: CoworkCoffeeAddonAvailability;
}) =>
  Effect.succeed(selection).pipe(
    Effect.filterOrFail(
      ({ coffee }) => coffee === undefined || coffeeAddon === "optional",
      () => BookingSelectionRejected.invalidField("coffee")
    ),
    Effect.filterOrFail(
      ({ monitorOption }) =>
        monitorOption === undefined ||
        getCoworkTierWorkstationAddon(entryTier) !== "unavailable",
      () => BookingSelectionRejected.invalidField("monitorOption")
    ),
    Effect.asVoid
  );

const toCoworkOffer = ({
  selection,
  entryTier,
  coffeeAddon,
}: {
  readonly selection: BookingSelectionInput;
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly coffeeAddon: CoworkCoffeeAddonAvailability;
}) => ({
  entryTier,
  date: selection.date,
  coffee: coffeeAddon === "included" || (selection.coffee ?? false),
  ...(selection.monitorOption !== undefined && {
    monitorOption: selection.monitorOption,
  }),
});

const getMeetingRoomQuoteSelection = Effect.fn(
  "bookingSelection.getMeetingRoomQuoteSelection"
)((request: QuoteSelectionRequest) =>
  Effect.succeed(request).pipe(
    Effect.bind("meetingRoom", ({ selection, now }) =>
      resolveMeetingRoomSelection({
        date: selection.date,
        startTime: selection.startTime,
        duration: selection.duration,
        now,
      })
    ),
    Effect.bind("request", ({ locale, meetingRoom }) =>
      findMeetingRoomPriceRequest({
        locale,
        startDateTime: meetingRoom.startDateTime,
        durationKey: meetingRoom.durationKey,
      })
    ),
    Effect.map(
      ({ selection, request, meetingRoom }): QuoteSelection => ({
        request,
        reservationSelection: {
          kind: "meeting-room",
          duration: meetingRoom.durationKey,
          startDateTime: meetingRoom.startDateTime,
        },
        reservation: {
          kind: "meeting-room",
          duration: meetingRoom.duration,
          reservationDate: selection.date,
          ...meetingRoom.interval,
        },
      })
    )
  )
);

const findMeetingRoomPriceRequest = ({
  locale,
  startDateTime,
  durationKey,
}: {
  readonly locale: Locale;
  readonly startDateTime: string;
  readonly durationKey: MeetingRoomReservationDurationKey;
}) =>
  Effect.succeed(
    getMeetingRoomDurationAdvertisedPriceRequests({
      locale,
      startDateTime,
    }).find(
      ({ reservation }) =>
        getMeetingRoomReservationDurationKey(reservation.details.duration) ===
        durationKey
    )
  ).pipe(
    Effect.filterOrFail(
      (priceRequest) => priceRequest !== undefined,
      () => BookingSelectionRejected.invalidField("startTime")
    )
  );

const getOfficeQuoteSelection = Effect.fn(
  "bookingSelection.getOfficeQuoteSelection"
)((request: QuoteSelectionRequest) =>
  Effect.succeed(request).pipe(
    Effect.tap(() => ensureOfficeOpen),
    Effect.let("today", ({ now }) => getCurrentWorkspaceDate(now)),
    Effect.bind("range", ({ selection, today }) =>
      resolveOfficeRange({
        date: selection.date,
        endDate: selection.endDate,
        today,
      })
    ),
    Effect.let("seats", ({ selection }) => selection.seats ?? 1),
    Effect.tap(ensureOfficeSeatsWithinCapacity),
    Effect.map(
      ({ locale, range, seats }): QuoteSelection => ({
        request: getOfficeAdvertisedPriceRequest({
          startsOn: range.startsOn,
          endsOn: range.endsOn,
          seats,
          locale,
        }),
        reservationSelection: {
          kind: "office",
          startsOn: range.startsOn,
          dayCount: range.dates.length,
          seats,
        },
        reservation: {
          kind: "office",
          startsOn: range.startsOn,
          endsOn: range.endsOn,
          seats,
        },
      })
    )
  )
);

/** The capacity lookup's own failure passes through untouched. */
const ensureOfficeSeatsWithinCapacity = ({
  seats,
}: {
  readonly seats: number;
}) =>
  loadAdvisoryOfficeSeatCapacity.pipe(
    Effect.filterOrFail(
      (maximumSeats) => seats <= maximumSeats,
      () => BookingSelectionRejected.invalidField("seats")
    ),
    Effect.asVoid
  );

const requireField = <A>(value: A, field: BookingSelectionField) =>
  Effect.fromNullishOr(value).pipe(
    Effect.mapError(() => BookingSelectionRejected.invalidField(field))
  );

/**
 * The selected start; an hourly booking needs a start time, and a whole day
 * starts at midnight whatever time the selection names.
 */
const decodeMeetingRoomStart = ({
  date,
  startTime,
  duration,
}: {
  readonly date: string;
  readonly startTime?: string;
  readonly duration: MeetingRoomReservationDuration;
}) =>
  Effect.succeed(
    isMeetingRoomWholeDayReservationDuration(duration) ? "00:00" : startTime
  ).pipe(
    Effect.filterOrFail(
      (time) => time !== undefined,
      () => BookingSelectionRejected.invalidField("startTime")
    ),
    Effect.flatMap((time) =>
      Schema.decodeEffect(meetingRoomStartDateTimeSchema)(`${date}T${time}`)
    ),
    Effect.mapError(() => BookingSelectionRejected.invalidField("startTime"))
  );

/**
 * Checkout and a reservation link keep a selection until its interval ends, so
 * resolution accepts the same selections and their links open the form on
 * them.
 */
const ensureMeetingRoomSelectionOpen = (input: {
  readonly date: string;
  readonly duration: MeetingRoomReservationDuration;
  readonly interval: ReservationInterval;
  readonly now: Temporal.Instant;
}) =>
  Effect.succeed(
    getWorkspaceAvailabilityRange(getCurrentWorkspaceDate(input.now).toString())
  ).pipe(
    Effect.filterOrFail(
      (range) =>
        !hasReservationIntervalEnded(input.interval, input.now) &&
        input.date <= range.to,
      (range) =>
        BookingSelectionRejected.dateOutOfRange({
          earliest: getFirstOpenMeetingRoomDate(input.duration, input.now),
          latest: range.to,
        })
    ),
    Effect.asVoid
  );

/** The Prague date of the first meeting-room selection resolution accepts. */
const getFirstOpenMeetingRoomDate = (
  duration: MeetingRoomReservationDuration,
  now: Temporal.Instant
) =>
  Temporal.PlainDateTime.from(
    getEarliestMeetingRoomStartDateTime(duration, now)
  )
    .toPlainDate()
    .toString();

const ensureDateOrder = ({
  date,
  endDate,
}: {
  readonly date: string;
  readonly endDate: string;
}) =>
  Effect.succeed(endDate).pipe(
    Effect.filterOrFail(
      (end) => end >= date,
      () => BookingSelectionRejected.invalidField("endDate")
    ),
    Effect.asVoid
  );

const ensureWithin = ({
  dates,
  from,
  to,
}: {
  readonly dates: ReadonlyArray<string>;
  readonly from: string;
  readonly to: string;
}) =>
  Effect.succeed(dates).pipe(
    Effect.filterOrFail(
      (candidates) => candidates.every((date) => date >= from && date <= to),
      () =>
        BookingSelectionRejected.dateOutOfRange({ earliest: from, latest: to })
    ),
    Effect.asVoid
  );
