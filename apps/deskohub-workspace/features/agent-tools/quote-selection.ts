import { Effect, Schema } from "effect";
import {
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import type { Locale } from "@/features/i18n";
import {
  type BookingSelectionInput,
  resolveBookingQuoteSelection,
} from "@/features/reservation/backend/booking-selection";
import { AgentToolError } from "./agent-tool-error";
import { quoteSelectionFields } from "./reservation-selection";

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
 * Resolves a tool's complete selection the way the booking pages accept it.
 * A failed office capacity lookup answers `quote_unavailable` in every tool.
 */
export const resolveQuoteSelection = ({
  input,
  locale,
  now,
}: {
  readonly input: CompleteSelection;
  readonly locale: Locale;
  readonly now: Temporal.Instant;
}) =>
  resolveBookingQuoteSelection({
    selection: toBookingSelectionInput(input),
    locale,
    now,
  }).pipe(
    Effect.catchTag(
      "BookingSelectionRejected",
      (rejected) => Effect.fail(AgentToolError.rejectedSelection(rejected)),
      (lookupFailure) =>
        Effect.fail(
          AgentToolError.unavailable("quote_unavailable")(lookupFailure)
        )
    )
  );

const toBookingSelectionInput = ({
  end_date,
  start_time,
  monitor_option,
  ...selection
}: CompleteSelection): BookingSelectionInput => ({
  ...selection,
  endDate: end_date,
  startTime: start_time,
  monitorOption: monitor_option,
});
