import { offlineAccessAgentScope } from "@/features/account/agent-scopes";
import type { CustomerAgentNoticeKind } from "@/features/account/components/customer-agent-notice";
import type { CustomerAgentConsentScope } from "@/features/account/customer-agent-routes";

/** What the consent page shows once the customer is signed in. */
export type CustomerAgentConsentOutcome<Client> =
  | { readonly notice: CustomerAgentNoticeKind }
  | { readonly client: Client; readonly administration: boolean };

/**
 * Whether nothing is left to allow once the administration scope is dropped
 * for an account without the administrator grant.
 */
const asksOnlyForAdministration = (
  request: {
    readonly administration: boolean;
    readonly scopes: ReadonlyArray<CustomerAgentConsentScope>;
  },
  administrator: boolean
) =>
  request.administration &&
  !administrator &&
  request.scopes.every((scope) => scope === offlineAccessAgentScope);

/**
 * Whether the signed-in customer may decide on the request: the agent's
 * client was found and the administrator grant could be read.
 */
export const resolveCustomerAgentConsentOutcome = <Client>({
  request,
  client,
  administrator,
}: {
  readonly request: {
    readonly administration: boolean;
    readonly scopes: ReadonlyArray<CustomerAgentConsentScope>;
  };
  readonly client: Client | undefined | "unavailable";
  readonly administrator: boolean | "unavailable";
}): CustomerAgentConsentOutcome<Client> => {
  if (administrator === "unavailable") return { notice: "unavailable" };
  if (asksOnlyForAdministration(request, administrator)) {
    return { notice: "administration-only" };
  }
  if (client === undefined) return { notice: "unknown-request" };
  if (client === "unavailable") return { notice: "unavailable" };
  return { client, administration: administrator };
};
