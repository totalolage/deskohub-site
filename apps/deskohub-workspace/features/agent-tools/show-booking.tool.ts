import { Effect, Schema, Struct } from "effect";
import bookingWidgetHtml from "@/features/agent-tools/booking-widget/generated/booking-widget.html" with {
  type: "text",
};
import { m } from "@/features/i18n";
import {
  agentToolLocaleField,
  CallableAgentTools,
  defineAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import type { AgentToolView } from "./agent-tool-view";
import { loadAgentOfferings } from "./list-offerings.tool";
import { completeSelectionFields } from "./quote-selection";
import {
  type ShowBookingResult,
  showBookingResultSchema,
} from "./show-booking.schema";
import { startReservationTool } from "./start-reservation.tool";

/** The booking view: offerings, availability, a quote, and the handoff. */
const bookingView: AgentToolView = {
  uri: "ui://dh-workspace/booking-v1.html",
  name: "booking",
  title: "DH Workspace booking",
  description:
    "Lets the customer choose a product, date, and options, check availability and the price, and continue to payment on the website.",
  html: bookingWidgetHtml,
};

const inputSchema = Schema.Struct({
  family: Schema.optionalKey(completeSelectionFields.family),
  date: Schema.optionalKey(completeSelectionFields.date),
  end_date: completeSelectionFields.end_date,
  tier: completeSelectionFields.tier,
  duration: completeSelectionFields.duration,
  start_time: completeSelectionFields.start_time,
  seats: completeSelectionFields.seats,
  locale: agentToolLocaleField,
});

export const showBookingTool = defineAgentTool({
  name: "show_booking",
  title: "Show the DH Workspace booking view",
  description:
    "Shows the customer an interactive booking view where they choose cowork, the meeting room, or the office, a date and options, see availability and the price, and continue to payment on the website. Prefill any choices the customer already made. The result also lists the offerings and the booking_mode, so where no view is shown, continue with check_availability and get_quote.",
  access: "public",
  readOnly: true,
  unavailableCode: "offerings_unavailable",
  view: bookingView,
  input: inputSchema,
  output: showBookingResultSchema,
  run: Effect.fn("agentTools.showBooking")((input) =>
    Effect.Do.pipe(
      Effect.let("locale", () => getAgentToolLocale(input)),
      Effect.bind("listing", ({ locale }) => loadAgentOfferings(locale)),
      Effect.bind("callable", () => CallableAgentTools),
      Effect.map(({ locale, listing, callable }): ShowBookingResult => {
        // The view starts a booking only when its agent could: the caller's
        // token grants the scope and the deployment publishes the tool.
        const reserve = callable.has(startReservationTool.name);

        return {
          booking_mode: reserve ? "reserve" : "reservation_page",
          locale,
          selection: Struct.omit(input, ["locale"]),
          ...listing,
          note: reserve
            ? m.agentToolBookingViewReserveNote({}, { locale })
            : m.agentToolBookingViewReservationPageNote({}, { locale }),
        };
      })
    )
  ),
});
