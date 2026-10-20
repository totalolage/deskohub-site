"use client";

import { authClient } from "./auth.client";
import type { CustomerAgentDisconnectResult } from "./customer-agent-connections";

/**
 * Disconnects the assistant behind the customer's consent `id`: Better Auth
 * deletes the consent and revokes the tokens that client holds for the
 * customer. A consent that is already gone, such as one disconnected in
 * another tab, counts as disconnected.
 */
export const disconnectCustomerAgent = async (
  id: string
): Promise<CustomerAgentDisconnectResult> => {
  const { error } = await authClient.oauth2.deleteConsent({ id }).then(
    (response) => response,
    () => ({ error: { status: 0 } })
  );
  return error === null || error.status === 404 ? "disconnected" : "failed";
};
