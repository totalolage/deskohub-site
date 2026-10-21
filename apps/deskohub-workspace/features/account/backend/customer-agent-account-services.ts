import { Layer } from "effect";
import { customerAuthenticationForAgent } from "./auth/customer-agent-authorization.service";
import { OptionalAccountActivityGuard } from "./customer-account-activity";
import { CustomerAccountContactService } from "./customer-account-contact.service";
import { CustomerAccountReservationOwnership } from "./customer-account-reservation-ownership";

/**
 * The account services of a request a customer's agent makes with this
 * access token. They read the customer through the token, re-verified on
 * every read, instead of the browser session, so the account lock, the
 * activity checks, and reservation ownership see the agent's customer.
 */
export const customerAgentAccountServices = (accessToken: string) => {
  const authentication = customerAuthenticationForAgent(accessToken);

  return Layer.mergeAll(
    authentication,
    OptionalAccountActivityGuard.withAuthentication(authentication),
    CustomerAccountContactService.withAuthentication(authentication),
    CustomerAccountReservationOwnership.withAuthentication(authentication)
  );
};
