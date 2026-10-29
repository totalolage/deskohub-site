import { Effect, Schema } from "effect";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { getReservationQuoteDiscount } from "@/features/checkout/reservation-quote-schema";
import { m } from "@/features/i18n";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import { currentInstant } from "@/shared/utils/temporal";
import {
  agentToolLocaleField,
  defineAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { toAgentToolMoney } from "./agent-tool-money";
import { type GetQuoteResult, getQuoteResultSchema } from "./get-quote.schema";
import {
  completeSelectionFields,
  type QuoteSelection,
  resolveQuoteSelection,
} from "./quote-selection";

const inputSchema = Schema.Struct({
  ...completeSelectionFields,
  locale: agentToolLocaleField,
});

type GetQuoteInput = typeof inputSchema.Type;

export const getQuoteTool = defineAgentTool({
  name: "get_quote",
  title: "Quote a Deskohub Workspace booking",
  description:
    "Prices a complete selection anonymously: a cowork tier and date, a meeting-room start time and duration, or office dates and seats. The total includes any public sale running at the moment of the quote, and the reservation link opens the booking page prefilled. The website confirms the price when the customer books; this tool does not check availability.",
  access: "public",
  readOnly: true,
  unavailableCode: "quote_unavailable",
  input: inputSchema,
  output: getQuoteResultSchema,
  run: Effect.fn("agentTools.getQuote")((input) =>
    Effect.succeed({ input }).pipe(
      Effect.let("locale", ({ input }) => getAgentToolLocale(input)),
      Effect.bind("now", () => currentInstant),
      Effect.bind("selection", resolveQuoteSelection),
      Effect.bind("pricing", priceQuoteSelection),
      Effect.map(toQuoteResult)
    )
  ),
});

const priceQuoteSelection = ({
  selection,
}: {
  readonly selection: QuoteSelection;
}) =>
  Effect.all(
    {
      advertised: buildAdvertisedPrice(selection.request),
      reservationUrl: getShareableReservationUrl(
        selection.reservationSelection
      ),
    },
    { concurrency: "inherit" }
  ).pipe(Effect.mapError(AgentToolError.unavailable("quote_unavailable")));

const toQuoteResult = ({
  input,
  locale,
  now,
  pricing: { advertised, reservationUrl },
}: {
  readonly input: GetQuoteInput;
  readonly locale: ReturnType<typeof getAgentToolLocale>;
  readonly now: Temporal.Instant;
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
