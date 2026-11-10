import { Layer } from "effect";
import { CurrentCustomerAccount } from "./current-customer-account";
import { CustomerAccountContactService } from "./customer-account-contact.service";
import { CustomerAccountReservationOwnership } from "./customer-account-reservation-ownership";
import { CustomerAccountSections } from "./customer-account-sections";
import { CustomerProfileService } from "./customer-profile.service";

/**
 * The account services reading the customer through the
 * `CustomerAuthentication` the caller provides: the account sections, the
 * standing, the profile service, the contact reader and reservation
 * ownership. Each service's `ForProvidedAuthentication` builds its
 * dependencies from the others', so a build constructs every service once,
 * shared with any caller in the same build that names one of them alone.
 */
export const CustomerAccountServices = Layer.mergeAll(
  CustomerAccountSections.ForProvidedAuthentication,
  CurrentCustomerAccount.ForProvidedAuthentication,
  CustomerProfileService.ForProvidedAuthentication,
  CustomerAccountContactService.ForProvidedAuthentication,
  CustomerAccountReservationOwnership.ForProvidedAuthentication
);
