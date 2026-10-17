import { Effect, Match, Schema } from "effect";
import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import {
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import { workspaceMoneyWithValue } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { loadAdvisoryOfficeSeatCapacity } from "@/features/office/backend/office-reservation-capacity";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import { getCoworkAdvertisedPriceReservation } from "@/features/reservation/cowork-reservation";
import { getCoworkReservationSearchParams } from "@/features/reservation/cowork-reservation-checkout-query";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import { getMeetingRoomReservationSearchParams } from "@/features/reservation/meeting-room-reservation-checkout-query";
import { getMeetingRoomReservationDurationKey } from "@/features/reservation/meeting-room-reservation-duration";
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
  run: Effect.fn("agentTools.getQuote")(function* (input) {
    const locale = getAgentToolLocale(input);
    const now = yield* currentInstant;
    const selection = yield* Match.value(input.family).pipe(
      Match.when("cowork", () => getCoworkSelection({ input, locale, now })),
      Match.when("meeting-room", () =>
        getMeetingRoomSelection({ input, locale, now })
      ),
      Match.when("office", () => getOfficeSelection({ input, locale, now })),
      Match.exhaustive
    );
    const [advertised, reservationUrl] = yield* Effect.all(
      [
        buildAdvertisedPrice(selection.request),
        getShareableReservationUrl(
          input.family,
          selection.reservationSearchParams
        ),
      ],
      { concurrency: "inherit" }
    ).pipe(Effect.mapError(AgentToolError.unavailable("quote_unavailable")));
    const { expectedPrice, undiscountedPrice } = advertised.quote.payment;

    return {
      family: input.family,
      total: toAgentToolMoney(expectedPrice),
      regular_price: toAgentToolMoney(undiscountedPrice),
      discount: toAgentToolMoney(
        workspaceMoneyWithValue(
          undiscountedPrice.value - expectedPrice.value,
          expectedPrice
        )
      ),
      quoted_at: now.toString(),
      note: m.agentToolQuoteNote({}, { locale }),
      reservation_url: reservationUrl,
    };
  }),
});

type SelectionInput = {
  readonly input: GetQuoteInput;
  readonly locale: Locale;
  readonly now: Temporal.Instant;
};

const getCoworkSelection = Effect.fn("agentTools.getCoworkQuoteSelection")(
  function* ({ input, locale, now }: SelectionInput) {
    const entryTier = input.tier;
    if (!entryTier) return yield* AgentToolError.invalidInput("tier");
    const today = getCurrentWorkspaceDate(now);
    yield* resolveCoworkDates({ date: input.date, today });
    if (!isCoworkOfferOpen({ entryTier, date: input.date, now })) {
      return yield* AgentToolError.dateOutOfRange({
        earliest: today.add({ days: 1 }).toString(),
        latest: getWorkspaceAvailabilityRange(today.toString()).to,
      });
    }
    const coffeeAddon = getCoworkTierCoffeeAddon(entryTier);
    if (input.coffee !== undefined && coffeeAddon !== "optional") {
      return yield* AgentToolError.invalidInput("coffee");
    }
    if (
      input.monitor_option !== undefined &&
      getCoworkTierWorkstationAddon(entryTier) === "unavailable"
    ) {
      return yield* AgentToolError.invalidInput("monitor_option");
    }
    const offer = {
      entryTier,
      date: input.date,
      coffee: coffeeAddon === "included" || (input.coffee ?? false),
      ...(input.monitor_option !== undefined && {
        monitorOption: input.monitor_option,
      }),
    };

    return {
      request: {
        locale,
        reservation: getCoworkAdvertisedPriceReservation(offer),
      },
      reservationSearchParams: getCoworkReservationSearchParams(offer),
    } satisfies QuoteSelection;
  }
);

const getMeetingRoomSelection = Effect.fn(
  "agentTools.getMeetingRoomQuoteSelection"
)(function* ({ input, locale, now }: SelectionInput) {
  const selection = yield* resolveMeetingRoomSelection({
    date: input.date,
    startTime: input.start_time,
    duration: input.duration,
    now,
  });
  const request = getMeetingRoomDurationAdvertisedPriceRequests({
    locale,
    startDateTime: selection.startDateTime,
  }).find(
    ({ reservation }) =>
      getMeetingRoomReservationDurationKey(reservation.details.duration) ===
      selection.durationKey
  );
  if (!request) return yield* AgentToolError.invalidInput("start_time");

  return {
    request,
    reservationSearchParams: getMeetingRoomReservationSearchParams({
      duration: selection.durationKey,
      startDateTime: selection.startDateTime,
    }),
  } satisfies QuoteSelection;
});

const getOfficeSelection = Effect.fn("agentTools.getOfficeQuoteSelection")(
  function* ({ input, locale, now }: SelectionInput) {
    yield* ensureOfficeOpen;
    const today = getCurrentWorkspaceDate(now);
    const range = yield* resolveOfficeRange({
      date: input.date,
      endDate: input.end_date,
      today,
    });
    const seats = input.seats ?? 1;
    const maximumSeats = yield* loadAdvisoryOfficeSeatCapacity.pipe(
      Effect.mapError(AgentToolError.unavailable("quote_unavailable"))
    );
    if (seats > maximumSeats) {
      return yield* AgentToolError.invalidInput("seats");
    }

    return {
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
    } satisfies QuoteSelection;
  }
);
