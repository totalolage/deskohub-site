import { Effect, Schema } from "effect";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { getReservationQuoteDiscount } from "@/features/checkout/reservation-quote-schema";
import { m } from "@/features/i18n";
import { getShareableReservationUrl } from "@/features/reservation/backend/shareable-reservation-url";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { currentInstant } from "@/shared/utils/temporal";
import {
  agentToolLocaleField,
  defineAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { agentToolMoneySchema, toAgentToolMoney } from "./agent-tool-money";
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
      Effect.bind("selection", resolveQuoteSelection),
      Effect.bind("pricing", priceQuoteSelection),
      Effect.map(toQuoteResult)
    )
  ),
});

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
