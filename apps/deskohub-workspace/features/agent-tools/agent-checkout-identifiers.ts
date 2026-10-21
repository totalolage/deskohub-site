import "server-only";

import { createHash } from "node:crypto";
import type { CustomerAgentGrant } from "@/features/account";
import {
  type CheckoutAttemptId,
  type CheckoutSessionId,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type AgentSelectionKey,
  agentSelectionKeySchema,
  deriveAgentCheckoutAttemptId,
} from "@/features/reservation/backend/booking-agent";
import type { SelectedReservation } from "./quote-selection";

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

const digest = (kind: string, ...parts: ReadonlyArray<string>) =>
  `agent-${kind}-${createHash("sha256")
    .update([`deskohub-workspace/agent-checkout-${kind}`, ...parts].join("\0"))
    .digest("base64url")}`;
