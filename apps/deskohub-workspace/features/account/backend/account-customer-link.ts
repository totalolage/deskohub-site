import { Effect } from "effect";
import type { AccountCustomerLinkResponse } from "../account-customer-link";
import {
  type CustomerAccountAccessError,
  mapCustomerAccountFailure,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerAuthentication } from "./customer-authentication.service";

const signedOut: AccountCustomerLinkResponse = {
  accountId: null,
  dotyposCustomerId: null,
};

/**
 * Reads the verified account's existing Dotypos customer link without
 * claiming one, so the read never creates or reactivates a customer. An
 * account awaiting deletion reports no link.
 */
export const readCurrentAccountCustomerLink: Effect.Effect<
  AccountCustomerLinkResponse,
  CustomerAccountAccessError,
  CustomerAuthentication | CustomerAccountLinkRepository
> = Effect.gen(function* () {
  const authentication = yield* CustomerAuthentication;
  const user = yield* authentication.currentUser;
  if (user === null) return signedOut;
  if (user.deletionRequested) {
    return { accountId: user.accountId, dotyposCustomerId: null };
  }

  const links = yield* CustomerAccountLinkRepository;
  const dotyposCustomerId = yield* links
    .find(user.accountId)
    .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.read")));
  return { accountId: user.accountId, dotyposCustomerId };
}).pipe(Effect.withSpan("account.readCurrentAccountCustomerLink"));
