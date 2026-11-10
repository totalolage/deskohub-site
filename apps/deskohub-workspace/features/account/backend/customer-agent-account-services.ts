import { Layer } from "effect";
import { customerAuthenticationForAgent } from "./auth/customer-agent-authorization.service";
import { CustomerAccountServices } from "./customer-account-services";

/**
 * The account services of a request a customer's agent makes with this
 * access token, and the token's authentication itself. They read the
 * customer through the token, re-verified on every read, instead of the
 * browser session, so the account lock, the activity checks, and
 * reservation ownership see the agent's customer.
 */
export const customerAgentAccountServices = (accessToken: string) =>
  CustomerAccountServices.pipe(
    Layer.provideMerge(customerAuthenticationForAgent(accessToken))
  );
