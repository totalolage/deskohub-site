import type { CustomerAgentConsentScope } from "@/features/account/customer-agent-routes";

/*
 * Wiring contract between the Connected assistants section and the browser
 * client that disconnects them. The section only renders outcomes.
 */

/** An AI assistant the customer let use their account. */
export type CustomerAgentConnection = {
  /** The customer's consent; disconnecting removes it. */
  readonly id: string;
  /** The name from the assistant's metadata; absent when it gives none. */
  readonly name: string | undefined;
  /** The host the assistant's metadata lives on. */
  readonly host: string | undefined;
  /** What the customer allowed, in the consent page's order. */
  readonly scopes: readonly CustomerAgentConsentScope[];
  /** Whether the administrator also let it use the administration. */
  readonly administration: boolean;
  /** ISO 8601 time of the customer's consent. */
  readonly connectedAt: string;
};

export type CustomerAgentDisconnectResult = "disconnected" | "failed";
