import { Effect, Match, Schema } from "effect";
import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import {
  type CoworkCoffeeAddonAvailability,
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  type WorkspaceCoworkCurrentTier,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { getReservationQuoteDiscount } from "@/features/checkout/reservation-quote-schema";
import { type Locale, m } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-reservation-capacity";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";
import { getCoworkReservationSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { getMeetingRoomReservationSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import {
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDurationKey,
} from "@/features/reservation/meeting-room-reservation-duration";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import { getOfficeReservationSearchParams } from "@/features/reservation/office-reservation-checkout-query";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { getWorkspaceAvailabilityRange } from "@/features/reservation/workspace-availability";
import { currentInstant } from "@/shared/utils/temporal";
import {
  agentToolLocaleField,
  defineAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { agentToolMoneySchema, toAgentToolMoney } from "./agent-tool-money";
import {
  ensureOfficeOpen,
  isCoworkOfferOpen,
  reservationSelectionFields,
  resolveCoworkDates,
  resolveMeetingRoomSelection,
  resolveOfficeRange,
} from "./reservation-selection";

const inputSchema = Schema.Struct({
  ...reservationSelectionFields,
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
  locale: agentToolLocaleField,
});

type GetQuoteInput = typeof inputSchema.Type;

const outputSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  total: agentToolMoneySchema.annotate({
    description: "The price the customer pays for the selection.",
  }),
  regular_price: agentToolMoneySchema,
  discount: agentToolMoneySchema.annotate({
    description: "Anonymous sale discount included in total; zero without one.",
  }),
  quoted_at: Schema.String,
  note: Schema.String,
  reservation_url: Schema.String,
});

export type GetQuoteResult = typeof outputSchema.Type;

type QuoteSelection = {
  readonly request: AdvertisedPriceRequest;
  readonly reservationSearchParams: URLSearchParams;
};

export const getQuoteTool = defineAgentTool({
  name: "get_quote",
  title: "Quote a DH Workspace booking",
  description:
    "Prices a complete selection anonymously: a cowork tier and date, a meeting-room start time and duration, or office dates and seats. The total includes any public sale running at the moment of the quote, and the reservation link opens the booking page prefilled. The price is confirmed on the website before payment; it does not check availability.",
  access: "public",
  readOnly: true,
  unavailableCode: "quote_unavailable",
  input: inputSchema,
  output: outputSchema,
  run: Effect.fn("agentTools.getQuote")((input) =>
    Effect.succeed({ input }).pipe(
      Effect.let("locale", ({ input }) => getAgentToolLocale(input)),
      Effect.bind("now", () => currentInstant),
      Effect.bind("selection", getQuoteSelection),
      Effect.bind("pricing", priceQuoteSelection),
      Effect.map(toQuoteResult)
    )
  ),
});

type SelectionInput = {
  readonly input: GetQuoteInput;
  readonly locale: Locale;
  readonly now: Temporal.Instant;
};

const getQuoteSelection = (selectionInput: SelectionInput) =>
  Match.value(selectionInput.input.family).pipe(
    Match.when("cowork", () => getCoworkSelection(selectionInput)),
    Match.when("meeting-room", () => getMeetingRoomSelection(selectionInput)),
    Match.when("office", () => getOfficeSelection(selectionInput)),
    Match.exhaustive
  );

const priceQuoteSelection = ({
  input,
  selection,
}: {
  readonly input: GetQuoteInput;
  readonly selection: QuoteSelection;
}) =>
  Effect.all(
    {
      advertised: buildAdvertisedPrice(selection.request),
      reservationUrl: getShareableReservationUrl(
        input.family,
        selection.reservationSearchParams
      ),
    },
    { concurrency: "inherit" }
  ).pipe(Effect.mapError(AgentToolError.unavailable("quote_unavailable")));

const toQuoteResult = ({
  input,
  locale,
  now,
  pricing: { advertised, reservationUrl },
}: SelectionInput & {
  readonly pricing: Effect.Success<ReturnType<typeof priceQuoteSelection>>;
}): GetQuoteResult => {
  const { expectedPrice, undiscountedPrice } = advertised.quote.payment;

  return {
    family: input.family,
    total: toAgentToolMoney(expectedPrice),
    regular_price: toAgentToolMoney(undiscountedPrice),
    discount: toAgentToolMoney(
      getReservationQuoteDiscount(advertised.quote.payment)
    ),
    quoted_at: now.toString(),
    note: m.agentToolQuoteNote({}, { locale }),
    reservation_url: reservationUrl,
  };
};

const getCoworkSelection = Effect.fn("agentTools.getCoworkQuoteSelection")(
  (selectionInput: SelectionInput) =>
    Effect.succeed(selectionInput).pipe(
      Effect.bind("entryTier", ({ input }) => requireCoworkTier(input)),
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
        ({ locale, offer }) =>
          ({
            request: {
              locale,
              reservation: getCoworkAdvertisedPriceReservation(offer),
            },
            reservationSearchParams: getCoworkReservationSearchParams(offer),
          }) satisfies QuoteSelection
      )
    )
);

const requireCoworkTier = ({ tier }: GetQuoteInput) =>
  Effect.succeed(tier).pipe(
    Effect.filterOrFail(
      (entryTier) => entryTier !== undefined,
      () => AgentToolError.invalidInput("tier")
    )
  );

const ensureCoworkOfferOpen = ({
  input,
  entryTier,
  now,
  today,
}: {
  readonly input: GetQuoteInput;
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
  readonly input: GetQuoteInput;
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
  readonly input: GetQuoteInput;
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
      ({ request, meetingRoom }) =>
        ({
          request,
          reservationSearchParams: getMeetingRoomReservationSearchParams({
            duration: meetingRoom.durationKey,
            startDateTime: meetingRoom.startDateTime,
          }),
        }) satisfies QuoteSelection
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
        ({ locale, today, range, seats }) =>
          ({
            request: getOfficeAdvertisedPriceRequest({
              startsOn: range.startsOn,
              endsOn: range.endsOn,
              seats,
              locale,
            }),
            reservationSearchParams: getOfficeReservationSearchParams({
              seats,
              ...(range.startsOn === today.toString() && {
                dayCount: range.dates.length,
              }),
            }),
          }) satisfies QuoteSelection
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
