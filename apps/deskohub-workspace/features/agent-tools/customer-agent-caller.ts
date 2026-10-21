import { Context, Layer } from "effect";
import {
  type CustomerAgentGrant,
  customerAgentAccountServices,
} from "@/features/account";

/**
 * The verified grant behind the access token of the agent calling a
 * signed-in tool: the customer account, the agent's OAuth client, and the
 * scopes the customer granted it.
 */
export class CurrentCustomerAgentGrant extends Context.Service<
  CurrentCustomerAgentGrant,
  CustomerAgentGrant
>()("@deskohub-workspace/agent-tools/CurrentCustomerAgentGrant") {}

/** An agent whose access token the MCP request authorized. */
export interface CustomerAgentCaller {
  readonly grant: CustomerAgentGrant;
  readonly accessToken: string;
}

/**
 * The services a signed-in tool call reads the customer through: the grant,
 * and the account services backed by the caller's access token.
 */
export const customerAgentCallServices = ({
  grant,
  accessToken,
}: CustomerAgentCaller) =>
  Layer.merge(
    Layer.succeed(CurrentCustomerAgentGrant, grant),
    customerAgentAccountServices(accessToken)
  );

export type SignedInAgentToolServices = Layer.Success<
  ReturnType<typeof customerAgentCallServices>
>;

export type SignedInAgentToolRequirements = Layer.Services<
  ReturnType<typeof customerAgentCallServices>
>;
