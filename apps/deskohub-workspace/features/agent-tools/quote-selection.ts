import { Effect, Match, Schema } from "effect";
import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import {
  type CoworkCoffeeAddonAvailability,
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  type WorkspaceCoworkCurrentTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-advisory-seat-capacity";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";
import { getCoworkReservationSelectionSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { getMeetingRoomReservationSelectionSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import {
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDuration,
  type MeetingRoomReservationDurationKey,
} from "@/features/reservation/meeting-room-reservation-duration";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import { getOfficeReservationSelectionSearchParams } from "@/features/reservation/office-reservation-checkout-query";
import type { ReservationSelectionSearchParams } from "@/features/reservation/reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { ReservationInterval } from "@/features/reservation/reservation-interval-domain";
import { getWorkspaceAvailabilityRange } from "@/features/reservation/workspace-availability";
import { AgentToolError } from "./agent-tool-error";
import {
  ensureOfficeOpen,
  isCoworkOfferOpen,
  quoteSelectionFields,
  resolveCoworkDates,
  resolveMeetingRoomSelection,
  resolveOfficeRange,
} from "./reservation-selection";

/** The arguments naming one complete, priceable selection. */
export const completeSelectionFields = {
  ...quoteSelectionFields,
  tier: Schema.optionalKey(
    Schema.Literals(workspaceCoworkCurrentTiers).annotate({
      description: "Cowork only, required: open-space or reserved-desk.",
    })
  ),
  coffee: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Cowork Open Space only: add coffee. Reserved Desk always includes it.",
    })
  ),
  monitor_option: Schema.optionalKey(
    Schema.Literals(workspaceProductMonitorOptions).annotate({
      description:
        "Cowork Reserved Desk only: add a monitor workstation in this configuration. Every configuration costs the same.",
    })
  ),
};

const completeSelectionSchema = Schema.Struct(completeSelectionFields);

type CompleteSelection = typeof completeSelectionSchema.Type;

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
  readonly reservationSearchParams: ReservationSelectionSearchParams;
  readonly reservation: SelectedReservation;
};

type SelectionInput = {
  readonly input: CompleteSelection;
  readonly locale: Locale;
  readonly now: Temporal.Instant;
};

/**
 * Resolves a complete selection the way the booking pages accept it: dates
 * inside the booking horizon, offers still open, and options the product
 * offers.
 */
export const resolveQuoteSelection = (selectionInput: SelectionInput) =>
  Match.value(selectionInput.input.family).pipe(
    Match.when("cowork", () => getCoworkSelection(selectionInput)),
    Match.when("meeting-room", () => getMeetingRoomSelection(selectionInput)),
    Match.when("office", () => getOfficeSelection(selectionInput)),
    Match.exhaustive
  );

const getCoworkSelection = Effect.fn("agentTools.getCoworkQuoteSelection")(
  (selectionInput: SelectionInput) =>
    Effect.succeed(selectionInput).pipe(
      Effect.bind("entryTier", ({ input }) => requireCoworkTier(input)),
      Effect.tap(({ input }) => ensureSingleCoworkDate(input)),
      Effect.let("today", ({ now }) => getCurrentWorkspaceDate(now)),
      Effect.tap(({ input, today }) =>
        resolveCoworkDates({ date: input.date, today })
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
          reservationSearchParams:
            getCoworkReservationSelectionSearchParams(offer),
          reservation: { kind: "cowork", ...offer },
        })
      )
    )
);

const requireCoworkTier = ({ tier }: CompleteSelection) =>
  Effect.succeed(tier).pipe(
    Effect.filterOrFail(
      (entryTier) => entryTier !== undefined,
      () => AgentToolError.invalidInput("tier")
    )
  );

/** A cowork booking covers one date; checkout has no cowork date range. */
const ensureSingleCoworkDate = ({ date, end_date }: CompleteSelection) =>
  Effect.succeed(end_date).pipe(
    Effect.filterOrFail(
      (endDate) => endDate === undefined || endDate === date,
      () => AgentToolError.invalidInput("end_date")
    ),
    Effect.asVoid
  );

const ensureCoworkOfferOpen = ({
  input,
  entryTier,
  now,
  today,
}: {
  readonly input: CompleteSelection;
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly now: Temporal.Instant;
  readonly today: Temporal.PlainDate;
}) =>
  Effect.succeed({ entryTier, date: input.date, now }).pipe(
    Effect.filterOrFail(isCoworkOfferOpen, () =>
      AgentToolError.dateOutOfRange({
        earliest: today.add({ days: 1 }).toString(),
        latest: getWorkspaceAvailabilityRange(today.toString()).to,
      })
    ),
    Effect.asVoid
  );

const ensureCoworkAddonsOffered = ({
  input,
  entryTier,
  coffeeAddon,
}: {
  readonly input: CompleteSelection;
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly coffeeAddon: CoworkCoffeeAddonAvailability;
}) =>
  Effect.succeed(input).pipe(
    Effect.filterOrFail(
      ({ coffee }) => coffee === undefined || coffeeAddon === "optional",
      () => AgentToolError.invalidInput("coffee")
    ),
    Effect.filterOrFail(
      ({ monitor_option }) =>
        monitor_option === undefined ||
        getCoworkTierWorkstationAddon(entryTier) !== "unavailable",
      () => AgentToolError.invalidInput("monitor_option")
    ),
    Effect.asVoid
  );

const toCoworkOffer = ({
  input,
  entryTier,
  coffeeAddon,
}: {
  readonly input: CompleteSelection;
  readonly entryTier: WorkspaceCoworkCurrentTier;
  readonly coffeeAddon: CoworkCoffeeAddonAvailability;
}) => ({
  entryTier,
  date: input.date,
  coffee: coffeeAddon === "included" || (input.coffee ?? false),
  ...(input.monitor_option !== undefined && {
    monitorOption: input.monitor_option,
  }),
});

const getMeetingRoomSelection = Effect.fn(
  "agentTools.getMeetingRoomQuoteSelection"
)((selectionInput: SelectionInput) =>
  Effect.succeed(selectionInput).pipe(
    Effect.bind("meetingRoom", ({ input, now }) =>
      resolveMeetingRoomSelection({
        date: input.date,
        startTime: input.start_time,
        duration: input.duration,
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
      ({ input, request, meetingRoom }): QuoteSelection => ({
        request,
        reservationSearchParams: getMeetingRoomReservationSelectionSearchParams(
          {
            duration: meetingRoom.durationKey,
            startDateTime: meetingRoom.startDateTime,
          }
        ),
        reservation: {
          kind: "meeting-room",
          duration: meetingRoom.duration,
          reservationDate: input.date,
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
      (request) => request !== undefined,
      () => AgentToolError.invalidInput("start_time")
    )
  );

const getOfficeSelection = Effect.fn("agentTools.getOfficeQuoteSelection")(
  (selectionInput: SelectionInput) =>
    Effect.succeed(selectionInput).pipe(
      Effect.tap(() => ensureOfficeOpen),
      Effect.let("today", ({ now }) => getCurrentWorkspaceDate(now)),
      Effect.bind("range", ({ input, today }) =>
        resolveOfficeRange({
          date: input.date,
          endDate: input.end_date,
          today,
        })
      ),
      Effect.let("seats", ({ input }) => input.seats ?? 1),
      Effect.tap(ensureOfficeSeatsWithinCapacity),
      Effect.map(
        ({ locale, range, seats }): QuoteSelection => ({
          request: getOfficeAdvertisedPriceRequest({
            startsOn: range.startsOn,
            endsOn: range.endsOn,
            seats,
            locale,
          }),
          reservationSearchParams: getOfficeReservationSelectionSearchParams({
            startsOn: range.startsOn,
            dayCount: range.dates.length,
            seats,
          }),
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

const ensureOfficeSeatsWithinCapacity = ({
  seats,
}: {
  readonly seats: number;
}) =>
  loadAdvisoryOfficeSeatCapacity.pipe(
    Effect.mapError(AgentToolError.unavailable("quote_unavailable")),
    Effect.filterOrFail(
      (maximumSeats) => seats <= maximumSeats,
      () => AgentToolError.invalidInput("seats")
    ),
    Effect.asVoid
  );
