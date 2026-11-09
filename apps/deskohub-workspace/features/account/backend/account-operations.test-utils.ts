import { testEmailAddress } from "@deskohub/test-email";
import { Cause, Effect, Exit, Layer } from "effect";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
  type LinkedCustomerAccount,
} from "../customer-account";
import { CustomerAccountResolver } from "./customer-account-resolver.service";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import { testSessionProfile } from "./customer-authentication.test-utils";

/** The verified session the account operation tests sign in with. */
export const testCustomerSession: CustomerAccountSession = {
  accountId: customerAccountIdSchema.make("operations-test-account"),
  email: reservationCustomerEmailSchema.make(testEmailAddress("ada")),
  deletionRequested: false,
  ...testSessionProfile,
};

/** The session account, linked to its Dotypos customer. */
export const testLinkedAccount: LinkedCustomerAccount = {
  accountId: testCustomerSession.accountId,
  dotyposCustomerId: dotyposCustomerIdSchema.make("60111"),
};

/** The request's authentication: signed in as `session`, or signed out. */
export const authenticatedAs = (
  session: CustomerAccountSession | null,
  options: { readonly failure?: CustomerAccountAccessError } = {}
) =>
  Layer.succeed(CustomerAuthentication, {
    currentUser: options.failure
      ? Effect.fail(options.failure)
      : Effect.succeed(session),
  });

/**
 * The account resolver answering with `resolution`, counting every
 * resolution in `calls`.
 */
export const resolvingTo = (
  resolution: Effect.Effect<LinkedCustomerAccount, CustomerAccountAccessError>,
  calls: { count: number } = { count: 0 }
) =>
  Layer.mock(CustomerAccountResolver, {
    resolve: Effect.suspend(() => {
      calls.count += 1;
      return resolution;
    }),
  });

/** The error an operation failed with; throws when it succeeded. */
export const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) throw new Error("Expected the operation to fail");
  return Cause.squash(exit.cause);
};
