import { createHash } from "node:crypto";
import { Context, Data, Schema } from "effect";
import type { CustomerAgentClientId } from "@/features/account";
import {
  type CheckoutAttemptId,
  checkoutAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";

export const agentSelectionKeySchema = Schema.NonEmptyString.pipe(
  Schema.brand("AgentSelectionKey")
).annotate({
  identifier: "AgentSelectionKey",
  description:
    "Digest of one agent booking request: the account, the agent client, and the complete selection.",
});
export type AgentSelectionKey = typeof agentSelectionKeySchema.Type;

/**
 * The customer's AI agent a booking is made through. Only the customer MCP
 * server provides it, after verifying the agent's OAuth access token, so the
 * browser Server Action can never claim an agent or its consent channel.
 * `selectionKey` names the booking request, so an identical repeat finds the
 * reservation the request already holds.
 */
export class BookingAgent extends Context.Service<
  BookingAgent,
  {
    readonly clientId: CustomerAgentClientId;
    readonly selectionKey: AgentSelectionKey;
  }
>()("@deskohub-workspace/reservation/BookingAgent") {}

/**
 * The checkout attempt of an agent booking request's next reservation: the
 * first one when the request has none yet, else the one following its latest
 * reservation. A repeat recomputes the attempt that created a reservation from
 * the reservation before it, so attempts stay stable at any time of day and a
 * request whose reservation ended gets a fresh attempt.
 */
export const deriveAgentCheckoutAttemptId = (
  selectionKey: AgentSelectionKey,
  previousReservationId?: WorkspaceReservationId
): CheckoutAttemptId =>
  checkoutAttemptIdSchema.make(
    `agent-attempt-${createHash("sha256")
      .update(
        [
          "deskohub-workspace/agent-checkout-attempt",
          selectionKey,
          ...(previousReservationId ? [previousReservationId] : []),
        ].join("\0")
      )
      .digest("base64url")}`
  );

/**
 * An agent booked for an account without a bookable profile. The customer
 * completes the profile on the site; an agent never writes it.
 */
export class AgentBookingProfileRequiredError extends Data.TaggedError(
  "AgentBookingProfileRequiredError"
)<Record<string, never>> {}

/**
 * An agent repeated a booking request whose reservation is waiting for its
 * payment to finish after the Pay link expired. The booking and its payment
 * stay as they are; the agent follows the order's status instead.
 */
export class AgentBookingPaymentInProgressError extends Data.TaggedError(
  "AgentBookingPaymentInProgressError"
)<{ readonly reservationId: WorkspaceReservationId }> {}
