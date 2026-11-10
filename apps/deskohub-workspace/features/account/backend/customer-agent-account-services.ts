import { Layer } from "effect";
import { customerAuthenticationForAgent } from "./auth/customer-agent-authorization.service";
import { CurrentCustomerAccount } from "./current-customer-account";
import { CustomerAccountContactService } from "./customer-account-contact.service";
import { CustomerAccountReservationOwnership } from "./customer-account-reservation-ownership";
import { CustomerAccountSections } from "./customer-account-sections";

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
    CustomerAccountSections.withAuthentication(authentication),
    CurrentCustomerAccount.withAuthentication(authentication),
    CustomerAccountContactService.withAuthentication(authentication),
    CustomerAccountReservationOwnership.withAuthentication(authentication)
  );
};
