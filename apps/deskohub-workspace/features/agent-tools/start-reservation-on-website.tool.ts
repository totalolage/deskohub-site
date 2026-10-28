import { Effect, Schema } from "effect";
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
import {
  completeSelectionFields,
  resolveQuoteSelection,
} from "./quote-selection";
import { startReservationTool } from "./start-reservation.tool";

const inputSchema = Schema.Struct({
  ...completeSelectionFields,
  locale: agentToolLocaleField,
});

const outputSchema = Schema.Struct({
  family: workspaceReservationKindSchema,
  reservation_url: Schema.String.annotate({
    description:
      "The reservation page on the website, prefilled with the selection. Give it to the customer, who finishes the booking there.",
  }),
  note: Schema.String,
});

/**
 * `start_reservation` for clients whose app directory admits no checkout:
 * it books nothing and only hands the selection to the website's
 * reservation page, so anyone may call it. It takes the transactional
 * tool's name, so agents follow the same flow on every client.
 */
export const startReservationOnWebsiteTool = defineAgentTool({
  name: startReservationTool.name,
  title: "Continue a Deskohub Workspace booking on the website",
  description:
    "Opens a complete selection, with the same arguments as get_quote, on the Deskohub Workspace website and returns its reservation_url. Give the reservation_url to the customer: the reservation page opens with the selection filled in, and the customer finishes the booking there. This tool books nothing and needs no sign-in.",
  access: "public",
  readOnly: true,
  unavailableCode: "quote_unavailable",
  input: inputSchema,
  output: outputSchema,
  run: Effect.fn("agentTools.startReservationOnWebsite")((input) =>
    Effect.succeed({ input }).pipe(
      Effect.let("locale", ({ input }) => getAgentToolLocale(input)),
      Effect.bind("now", () => currentInstant),
      Effect.bind("selection", resolveQuoteSelection),
      Effect.bind("reservationUrl", ({ selection }) =>
        getShareableReservationUrl(selection.reservationSelection).pipe(
          Effect.mapError(AgentToolError.unavailable("quote_unavailable"))
        )
      ),
      Effect.map(({ input, locale, reservationUrl }) => ({
        family: input.family,
        reservation_url: reservationUrl,
        note: m.agentToolStartReservationOnWebsiteNote({}, { locale }),
      }))
    )
  ),
});
