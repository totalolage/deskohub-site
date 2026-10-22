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

/**
 * Lets an administrator's AI agent use the administration. Only an account
 * that holds the administrator grant can consent to it, and every
 * administration call re-reads the grant, so the scope alone grants nothing.
 */
export const administrationAgentScope = "administration";

/** Every scope an agent's grant can carry. */
export const agentScopes = [
  ...customerAgentScopes,
  administrationAgentScope,
] as const;

export type AgentScope = (typeof agentScopes)[number];

export const isAgentScope = (scope: string): scope is AgentScope =>
  (agentScopes as ReadonlyArray<string>).includes(scope);

/**
 * Lets an agent refresh its access without the customer present. Without
 * it, Better Auth revokes a grant's tokens when the browser session it was
 * granted in ends. It names no customer data, so it isn't an agent scope.
 */
export const offlineAccessAgentScope = "offline_access";
