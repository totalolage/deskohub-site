import { Effect, Schema } from "effect";
import type { CustomerAgentGrant } from "@/features/account";
import type { Locale } from "@/features/i18n";
import { preparePayStateInputSchema } from "@/features/reservation/actions/prepare-pay-state.schema";
import { defaultReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { BookingAgent, deriveAgentCheckoutIdentifiers } from "./booking-agent";
import type { SelectedReservation } from "./booking-selection";
import { prepareWorkspacePayState } from "./reservation-booking.service";

/**
 * The account profile an agent books with. An agent books only a profile
 * that has a phone; the customer completes any other on the site.
 */
type AgentBookingContact = {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
};

/**
 * Prepares Pay for one booking request of the customer's AI agent: the
 * shared booking operation, run for the agent that the grant names.
 *
 * The request's checkout session, attempt and selection key all come from
 * the grant and the selected reservation here, so the submission the
 * operation books and the {@link BookingAgent} it continues the request by
 * always name the same request. The booking carries the profile contact and
 * personal billing without an invoice. A marketing grant is recorded only
 * when the customer asked for one; declining records and withdraws nothing.
 */
export const prepareAgentPayState = Effect.fn("agentBooking.preparePayState")(
  function* (request: {
    readonly grant: CustomerAgentGrant;
    readonly reservation: SelectedReservation;
    readonly contact: AgentBookingContact;
    readonly advertisedPriceToken: string;
    readonly marketingConsent: boolean;
    readonly locale: Locale;
  }) {
    const identifiers = deriveAgentCheckoutIdentifiers(request);
    const submission = yield* Schema.decodeUnknownEffect(
      preparePayStateInputSchema
    )({
      locale: request.locale,
      checkoutSessionId: identifiers.checkoutSessionId,
      checkoutAttemptId: identifiers.checkoutAttemptId,
      advertisedPriceToken: request.advertisedPriceToken,
      ...(request.marketingConsent && { marketingConsent: true }),
      customer: "account",
      reservation: {
        ...request.reservation,
        name: request.contact.name,
        email: request.contact.email,
        phone: request.contact.phone,
        billing: defaultReservationBillingSelection,
      },
    });
    return yield* prepareWorkspacePayState(submission).pipe(
      Effect.provideService(BookingAgent, {
        clientId: request.grant.clientId,
        selectionKey: identifiers.selectionKey,
      })
    );
  }
);
