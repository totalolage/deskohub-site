import { Effect } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";

/**
 * Where the customer stands for connecting an AI assistant. A deletion-pending
 * account can't continue: the assistant's tokens would never authorize.
 */
export type CustomerAgentSessionState =
  | "signed-out"
  | "signed-in"
  | "deletion-pending"
  | "unavailable";

/**
 * Re-reads the authoritative session for the AI assistant connect and consent
 * steps. A session that can't stand for a verified account counts as signed
 * out, so signing in again fixes it; any failed read is `unavailable`.
 */
export const readCustomerAgentSession = (operation: string) =>
  Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.map((session): CustomerAgentSessionState => {
      if (!session) return "signed-out";
      return session.deletionRequested ? "deletion-pending" : "signed-in";
    }),
    Effect.catchTag("CustomerAccountAccessError", (error) =>
      error.reason === "unauthenticated" || error.reason === "unverified-email"
        ? Effect.succeed<CustomerAgentSessionState>("signed-out")
        : Effect.fail(error)
    ),
    Effect.provide(CustomerAuthentication.Default),
    runWorkspaceEffectOrElse(operation, {
      boundary: "page",
      failureCode: "customer_agent_session_unavailable",
      orElse: (): CustomerAgentSessionState => "unavailable",
    })
  );
