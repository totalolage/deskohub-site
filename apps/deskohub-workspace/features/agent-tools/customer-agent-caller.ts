import { Context, Layer } from "effect";
import {
  type CustomerAgentCaller,
  type CustomerAgentGrant,
  customerAgentAccountServices,
} from "@/features/account";

export type { CustomerAgentCaller };

/**
 * The verified grant behind the access token of the agent calling a
 * signed-in tool: the customer account, the agent's OAuth client, and the
 * scopes the customer granted it.
 */
export class CurrentCustomerAgentGrant extends Context.Service<
  CurrentCustomerAgentGrant,
  CustomerAgentGrant
>()("@deskohub-workspace/agent-tools/CurrentCustomerAgentGrant") {}

/**
 * The grant, and the account services backed by the caller's access token,
 * which re-verify the token on every read.
 */
const tokenBackedCallServices = ({ grant, accessToken }: CustomerAgentCaller) =>
  Layer.merge(
    Layer.succeed(CurrentCustomerAgentGrant, grant),
    customerAgentAccountServices(accessToken)
  );

type TokenBackedCallServices = ReturnType<typeof tokenBackedCallServices>;

export type SignedInAgentToolServices = Layer.Success<TokenBackedCallServices>;

export type SignedInAgentToolRequirements =
  Layer.Services<TokenBackedCallServices>;

/**
 * How a signed-in tool call builds the services it reads the customer
 * through. Every call defaults to the token-backed services; a test
 * provides its own to read a fixed customer instead.
 */
export const CustomerAgentCallServices = Context.Reference<{
  readonly forCaller: (
    caller: CustomerAgentCaller
  ) => Layer.Layer<
    SignedInAgentToolServices,
    Layer.Error<TokenBackedCallServices>,
    SignedInAgentToolRequirements
  >;
}>("@deskohub-workspace/agent-tools/CustomerAgentCallServices", {
  defaultValue: () => ({ forCaller: tokenBackedCallServices }),
});
