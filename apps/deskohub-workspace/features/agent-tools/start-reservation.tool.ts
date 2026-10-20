import { Duration, Effect, Match, Schema } from "effect";
import { CustomerAccountContactService } from "@/features/account";
import { buildAdvertisedPrice } from "@/features/checkout/backend/checkout/advertised-price.server";
import { type Locale, m } from "@/features/i18n";
import { prepareWorkspacePayState } from "@/features/reservation/actions/prepare-pay-state";
import {
  type PreparePayStateInput,
  preparePayStateInputSchema,
} from "@/features/reservation/actions/prepare-pay-state.schema";
import { BookingAgent } from "@/features/reservation/backend/booking-agent";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { workspaceReservationKindSchema } from "@/features/reservation/reservation-kind";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { currentInstant } from "@/shared/utils/temporal";
import { deriveAgentCheckoutIdentifiers } from "./agent-checkout-identifiers";
import {
  agentToolLocaleField,
  defineSignedInAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { agentToolMoneySchema, toAgentToolMoney } from "./agent-tool-money";
import { CurrentCustomerAgentGrant } from "./customer-agent-caller";
import {
  completeSelectionFields,
  type QuoteSelection,
  resolveQuoteSelection,
} from "./quote-selection";

const inputSchema = Schema.Struct({
  ...completeSelectionFields,
  marketing_consent: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Set true only when the customer explicitly asked to receive DH Workspace marketing emails. Omit it otherwise; never assume consent.",
    })
  ),
  locale: agentToolLocaleField,
});

type StartReservationInput = typeof inputSchema.Type;

const outputSchema = Schema.Struct({
  order_id: Schema.String.annotate({
    description: "The order ID; get_reservation_status reports on it.",
  }),
  pay_url: Schema.String.annotate({
    description:
      "The Pay page for the held order. Give it to the customer, who checks the order, accepts the terms, and pays there.",
  }),
  pay_url_expires_at: Schema.String.annotate({
    description:
      "When the Pay link expires, as an ISO 8601 instant. Call start_reservation again with the same selection for a fresh link.",
  }),
  family: workspaceReservationKindSchema,
  total: agentToolMoneySchema.annotate({
    description:
      "The price quoted for the selection; the Pay page shows the confirmed price.",
  }),
  price_changed: Schema.Boolean.annotate({
    description:
      "Whether the price changed since the quote; the Pay page shows the new price.",
  }),
  note: Schema.String,
});

type StartReservationResult = typeof outputSchema.Type;

/**
 * Starts at most five bookings per account in 30 minutes. Each start calls
 * Dotypos live, about five to seven requests for the profile, the
 * availability re-check, the hold, and superseding the previous hold, so an
 * account's starts stay under a quarter of the 150 requests per 30 minutes
 * the whole site shares.
 */
const startReservationAccountBudget = {
  limit: 5,
  window: Duration.minutes(30),
};

export const startReservationTool = defineSignedInAgentTool({
  name: "start_reservation",
  title: "Start a DH Workspace booking",
  description:
    "Holds a complete selection for the signed-in customer, with the same arguments as get_quote, and returns a pay_url. Give the pay_url to the customer: they check the order, accept the terms, and pay on the website before the link expires; this tool can't pay. The customer's account profile is the contact. Calling again with the same selection returns the same held order with a fresh link; a different selection replaces the previous hold.",
  scope: "reservations:create",
  accountBudget: startReservationAccountBudget,
  readOnly: false,
  unavailableCode: "reservation_unavailable",
  input: inputSchema,
  output: outputSchema,
  run: Effect.fn("agentTools.startReservation")((input) =>
    Effect.succeed({ input }).pipe(
      Effect.let("locale", ({ input }) => getAgentToolLocale(input)),
      Effect.bind("now", () => currentInstant),
      Effect.bind("grant", () => CurrentCustomerAgentGrant),
      Effect.bind("selection", resolveQuoteSelection),
      Effect.bind("contact", () => readBookingContact),
      Effect.bind("advertised", ({ selection }) =>
        buildAdvertisedPrice(selection.request).pipe(
          Effect.mapError(AgentToolError.unavailable("reservation_unavailable"))
        )
      ),
      Effect.bind("submission", toSubmission),
      Effect.bind("prepared", ({ grant, submission }) =>
        prepareWorkspacePayState(submission).pipe(
          Effect.provideService(BookingAgent, { clientId: grant.clientId }),
          Effect.mapError(toStartReservationError)
        )
      ),
      Effect.flatMap(toStartReservationResult)
    )
  ),
});

/**
 * The customer's own account profile, the contact every account booking
 * carries. An account without a bookable profile finishes it on the site.
 */
const readBookingContact = CustomerAccountContactService.pipe(
  Effect.flatMap((contacts) => contacts.current),
  Effect.mapError(AgentToolError.refused("account_unavailable")),
  Effect.flatMap((contact) =>
    contact?.phone
      ? Effect.succeed({ ...contact, phone: contact.phone })
      : Effect.fail(AgentToolError.refused("profile_incomplete")())
  )
);

const toSubmission = ({
  input,
  locale,
  now,
  grant,
  selection,
  contact,
  advertised,
}: {
  readonly input: StartReservationInput;
  readonly locale: Locale;
  readonly now: Temporal.Instant;
  readonly grant: CurrentCustomerAgentGrant["Service"];
  readonly selection: QuoteSelection;
  readonly contact: Effect.Success<typeof readBookingContact>;
  readonly advertised: Effect.Success<ReturnType<typeof buildAdvertisedPrice>>;
}): Effect.Effect<PreparePayStateInput, AgentToolError> =>
  Schema.decodeUnknownEffect(preparePayStateInputSchema)({
    locale,
    ...deriveAgentCheckoutIdentifiers({
      grant,
      reservation: selection.reservation,
      now,
    }),
    advertisedPriceToken: advertised.advertisedPriceToken,
    // Absent or false records nothing and withdraws nothing; the booking
    // operation labels a grant with the agent channel.
    ...(input.marketing_consent === true && { marketingConsent: true }),
    customer: "account",
    reservation: {
      ...selection.reservation,
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
      billing: defaultReservationBillingSelection,
    },
  }).pipe(
    Effect.mapError(AgentToolError.unavailable("reservation_unavailable"))
  );

const toStartReservationError = (
  error: Effect.Error<ReturnType<typeof prepareWorkspacePayState>>
) =>
  Match.value(error).pipe(
    Match.tag("WorkspaceTableUnavailableError", (cause) =>
      AgentToolError.refused("selection_unavailable")(cause)
    ),
    Match.tag("AgentHoldLimitError", (cause) =>
      AgentToolError.refused("hold_limit_reached")(cause)
    ),
    Match.tag("AgentBookingProfileRequiredError", (cause) =>
      AgentToolError.refused("profile_incomplete")(cause)
    ),
    Match.tag("CheckoutAttemptUnavailableError", (cause) =>
      AgentToolError.refused("reservation_conflict")(cause)
    ),
    Match.tag("AdvertisedPriceMismatchError", (cause) =>
      AgentToolError.refused("reservation_conflict")(cause)
    ),
    Match.tag("CustomerAccountAccessError", (cause) =>
      AgentToolError.refused("account_unavailable")(cause)
    ),
    Match.tag("OfficeReservationsDisabledError", () =>
      AgentToolError.unsupportedFamily()
    ),
    Match.orElse(AgentToolError.unavailable("reservation_unavailable"))
  );

const toStartReservationResult = ({
  input,
  locale,
  advertised,
  prepared,
}: {
  readonly input: StartReservationInput;
  readonly locale: Locale;
  readonly advertised: Effect.Success<ReturnType<typeof buildAdvertisedPrice>>;
  readonly prepared: Effect.Success<
    ReturnType<typeof prepareWorkspacePayState>
  >;
}) =>
  Match.value(prepared).pipe(
    Match.discriminatorsExhaustive("status")({
      // The hold creation claim lost to another submission that holds no
      // reusable reservation.
      error: () =>
        Effect.fail(AgentToolError.refused("reservation_conflict")()),
      ready: (ready) => Effect.succeed({ ready, priceChanged: false }),
      pricing_changed: (ready) => Effect.succeed({ ready, priceChanged: true }),
    }),
    Effect.flatMap(({ ready, priceChanged }) =>
      getWorkspaceRuntimeCallbackOrigin.pipe(
        Effect.mapError(AgentToolError.unavailable("reservation_unavailable")),
        Effect.map(
          (origin): StartReservationResult => ({
            order_id: ready.orderId,
            pay_url: new URL(ready.redirectUrl, origin).toString(),
            pay_url_expires_at: ready.expiresAt,
            family: input.family,
            total: toAgentToolMoney(advertised.quote.payment.expectedPrice),
            price_changed: priceChanged,
            note: priceChanged
              ? m.agentToolStartReservationPriceChangedNote({}, { locale })
              : m.agentToolStartReservationNote({}, { locale }),
          })
        )
      )
    )
  );
