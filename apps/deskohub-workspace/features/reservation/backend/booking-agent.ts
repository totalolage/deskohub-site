import "server-only";

import { createHash } from "node:crypto";
import { Context, Data, Schema } from "effect";
import type {
  CustomerAgentClientId,
  CustomerAgentGrant,
} from "@/features/account";
import {
  type CheckoutAttemptId,
  type CheckoutSessionId,
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { SelectedReservation } from "./booking-selection";

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
 * The checkout IDs of an agent's booking, derived instead of generated so a
 * repeated call reuses the checkout's idempotency and supersession.
 *
 * The session is one per account and agent client: a new selection
 * supersedes the client's previous hold, in this session or one the booking
 * operation rotated into, so it leaves no earlier unpaid hold open. The
 * selection key names the request, one per session and selection, with no
 * time component: the booking operation finds the request's latest
 * reservation by it and continues from there, so an identical repeat reuses a
 * live hold at any time and a repeat after the reservation ended starts a new
 * one. The attempt is the request's first; the booking operation moves to a
 * later attempt once the request has reservations.
 */
export const deriveAgentCheckoutIdentifiers = ({
  grant,
  reservation,
}: {
  readonly grant: CustomerAgentGrant;
  readonly reservation: SelectedReservation;
}): {
  readonly checkoutSessionId: CheckoutSessionId;
  readonly checkoutAttemptId: CheckoutAttemptId;
  readonly selectionKey: AgentSelectionKey;
} => {
  const checkoutSessionId = checkoutSessionIdSchema.make(
    digest("session", grant.accountId, grant.clientId)
  );
  const selectionKey = agentSelectionKeySchema.make(
    digest("selection", checkoutSessionId, JSON.stringify(reservation))
  );

  return {
    checkoutSessionId,
    checkoutAttemptId: deriveAgentCheckoutAttemptId(selectionKey),
    selectionKey,
  };
};

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
    digest(
      "attempt",
      selectionKey,
      ...(previousReservationId ? [previousReservationId] : [])
    )
  );

/**
 * `agent-<kind>-` and the unpadded base64url SHA-256 of the kind's domain
 * label and the parts, joined by NUL. Live agent holds are found again by
 * these values, so the bytes, order, separators and encoding never change.
 */
const digest = (kind: string, ...parts: ReadonlyArray<string>) =>
  `agent-${kind}-${createHash("sha256")
    .update([`deskohub-workspace/agent-checkout-${kind}`, ...parts].join("\0"))
    .digest("base64url")}`;

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
