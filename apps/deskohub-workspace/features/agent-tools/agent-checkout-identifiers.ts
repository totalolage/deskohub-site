import "server-only";

import { createHash } from "node:crypto";
import type { CustomerAgentGrant } from "@/features/account";
import { payStateDefaultTtlMilliseconds } from "@/features/checkout/backend/checkout";
import {
  type CheckoutAttemptId,
  type CheckoutSessionId,
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
} from "@/features/checkout/checkout-identifiers";
import type { SelectedReservation } from "./quote-selection";

/**
 * The checkout IDs of an agent's booking, derived instead of generated so a
 * repeated call reuses the checkout's idempotency and supersession.
 *
 * The session is one per account and agent client: a new selection
 * supersedes the client's previous hold, so it keeps at most one open. The
 * attempt is one per selection within one hold window, the Pay-state
 * lifetime, so an identical repeat reuses the live hold; a repeat in a later
 * window becomes a new attempt that supersedes it, so an expired or paid
 * attempt never blocks booking the same selection again.
 */
export const deriveAgentCheckoutIdentifiers = ({
  grant,
  reservation,
  now,
}: {
  readonly grant: CustomerAgentGrant;
  readonly reservation: SelectedReservation;
  readonly now: Temporal.Instant;
}): {
  readonly checkoutSessionId: CheckoutSessionId;
  readonly checkoutAttemptId: CheckoutAttemptId;
} => {
  const checkoutSessionId = checkoutSessionIdSchema.make(
    digest("session", grant.accountId, grant.clientId)
  );
  const holdWindow = Math.floor(
    now.epochMilliseconds / payStateDefaultTtlMilliseconds
  );

  return {
    checkoutSessionId,
    checkoutAttemptId: checkoutAttemptIdSchema.make(
      digest(
        "attempt",
        checkoutSessionId,
        JSON.stringify(reservation),
        String(holdWindow)
      )
    ),
  };
};

const digest = (kind: string, ...parts: ReadonlyArray<string>) =>
  `agent-${kind}-${createHash("sha256")
    .update([`deskohub-workspace/agent-checkout-${kind}`, ...parts].join("\0"))
    .digest("base64url")}`;
