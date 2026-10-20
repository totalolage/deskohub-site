/**
 * What a customer can let an AI agent do for them through the Workspace
 * OAuth server. Reading offerings needs no grant; the scope only lets agents
 * name it.
 */
export const customerAgentScopes = [
  "offerings:read",
  "reservations:read",
  "reservations:create",
] as const;

export type CustomerAgentScope = (typeof customerAgentScopes)[number];

export const isCustomerAgentScope = (
  scope: string
): scope is CustomerAgentScope =>
  (customerAgentScopes as ReadonlyArray<string>).includes(scope);

/**
 * Lets an agent refresh its access without the customer present. Without
 * it, Better Auth revokes a grant's tokens when the browser session it was
 * granted in ends. It names no customer data, so it isn't a customer agent
 * scope.
 */
export const customerAgentOfflineAccessScope = "offline_access";
