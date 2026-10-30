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
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { currentInstant } from "@/shared/utils/temporal";
import { deriveAgentCheckoutIdentifiers } from "./agent-checkout-identifiers";
import {
  agentToolLocaleField,
  defineSignedInAgentTool,
  getAgentToolLocale,
} from "./agent-tool";
import { AgentToolError } from "./agent-tool-error";
import { toAgentToolMoney } from "./agent-tool-money";
import { CurrentCustomerAgentGrant } from "./customer-agent-caller";
import {
  completeSelectionFields,
  type QuoteSelection,
  resolveQuoteSelection,
} from "./quote-selection";
import {
  type StartReservationResult,
  startReservationResultSchema,
} from "./start-reservation.schema";

const inputSchema = Schema.Struct({
  ...completeSelectionFields,
  early_setup: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Meeting room only: set true when the customer wants to come 15 minutes before the start to set up. It's free; the booked time and price stay the same.",
    })
  ),
  marketing_consent: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Set true only when the customer explicitly asked to receive Deskohub Workspace marketing emails. Omit it otherwise; never assume consent.",
    })
  ),
  locale: agentToolLocaleField,
});

type StartReservationInput = typeof inputSchema.Type;

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
  title: "Start a Deskohub Workspace booking",
  description:
    "Holds a complete selection for the signed-in customer, with the same arguments as get_quote plus early_setup for a meeting room, and returns a pay_url. Give the pay_url to the customer: they check the order, accept the terms, and pay on the website before the link expires; this tool can't pay. The customer's account profile is the contact. Calling again with the same selection returns the same held order and pay_url until the link expires; a different selection replaces the unpaid hold you made before. A hold whose payment has started is kept, and holds made by other assistants are not affected.",
  scope: "reservations:create",
  accountBudget: startReservationAccountBudget,
  readOnly: false,
  // A different selection cancels the unpaid hold made before; the same
  // selection returns the same held order.
  destructive: true,
  idempotent: true,
  unavailableCode: "reservation_unavailable",
  input: inputSchema,
  output: startReservationResultSchema,
  run: Effect.fn("agentTools.startReservation")((input) =>
    Effect.succeed({ input }).pipe(
      Effect.let("locale", ({ input }) => getAgentToolLocale(input)),
      Effect.bind("now", () => currentInstant),
      Effect.bind("grant", () => CurrentCustomerAgentGrant),
      Effect.bind("quoted", resolveQuoteSelection),
      Effect.bind("selection", withEarlySetup),
      Effect.let("identifiers", ({ grant, selection }) =>
        deriveAgentCheckoutIdentifiers({
          grant,
          reservation: selection.reservation,
        })
      ),
      Effect.bind("contact", () => readBookingContact),
      Effect.bind("advertised", ({ selection }) =>
        buildAdvertisedPrice(selection.request).pipe(
          Effect.mapError(AgentToolError.unavailable("reservation_unavailable"))
        )
      ),
      Effect.bind("submission", toSubmission),
      Effect.bind("prepared", ({ grant, identifiers, submission }) =>
        prepareWorkspacePayState(submission).pipe(
          Effect.provideService(BookingAgent, {
            clientId: grant.clientId,
            selectionKey: identifiers.selectionKey,
          }),
          Effect.mapError(toStartReservationError)
        )
      ),
      Effect.flatMap(toStartReservationResult)
    )
  ),
});

/**
 * Adds the early setup the customer asked for to a meeting-room selection.
 * The selection key then differs, so a repeat with another choice replaces
 * the hold. Setup is free, so the quoted price stays. Other families offer no
 * setup time.
 */
const withEarlySetup = ({
  input,
  quoted,
}: {
  readonly input: StartReservationInput;
  readonly quoted: QuoteSelection;
}): Effect.Effect<QuoteSelection, AgentToolError> => {
  if (input.early_setup !== true) return Effect.succeed(quoted);
  return quoted.reservation.kind === "meeting-room"
    ? Effect.succeed({
        ...quoted,
        reservation: { ...quoted.reservation, earlySetup: true },
      })
    : Effect.fail(AgentToolError.invalidInput("early_setup"));
};

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
  identifiers,
  selection,
  contact,
  advertised,
}: {
  readonly input: StartReservationInput;
  readonly locale: Locale;
  readonly identifiers: ReturnType<typeof deriveAgentCheckoutIdentifiers>;
  readonly selection: QuoteSelection;
  readonly contact: Effect.Success<typeof readBookingContact>;
  readonly advertised: Effect.Success<ReturnType<typeof buildAdvertisedPrice>>;
}): Effect.Effect<PreparePayStateInput, AgentToolError> =>
  Schema.decodeUnknownEffect(preparePayStateInputSchema)({
    locale,
    checkoutSessionId: identifiers.checkoutSessionId,
    checkoutAttemptId: identifiers.checkoutAttemptId,
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
    Match.tag("AgentBookingProfileRequiredError", (cause) =>
      AgentToolError.refused("profile_incomplete")(cause)
    ),
    Match.tag("CheckoutAttemptUnavailableError", (cause) =>
      AgentToolError.refused("reservation_conflict")(cause)
    ),
    Match.tag("AgentBookingPaymentInProgressError", (cause) =>
      AgentToolError.refused("payment_in_progress")(cause)
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
