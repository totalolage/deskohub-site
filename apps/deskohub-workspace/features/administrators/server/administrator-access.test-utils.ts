import { mock } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import {
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import type { AdministratorAccountActor } from "../account-role";
import { AccountRoleGrants } from "../backend/account-role-grants.service";

/**
 * Who the request acts as: an administrator, a signed-in account without the
 * grant, a signed-out visitor, or a request whose session can't be read.
 */
export type TestAdministratorAccess =
  | "administrator"
  | "not-administrator"
  | "signed-out"
  | "unavailable";

/**
 * Substitutes the session and grant reads behind the administration request
 * edge, so a test drives pages and actions through the real guards. Call it
 * before importing the module under test; it starts as `administrator`.
 */
export const mockAdministratorAccess = (
  name = "administration-request"
): {
  readonly administrator: AdministratorAccountActor;
  /** How often the guards read the session. */
  readonly reads: () => number;
  readonly set: (access: TestAdministratorAccess) => void;
} => {
  const administrator: AdministratorAccountActor = {
    accountId: customerAccountIdSchema.make(crypto.randomUUID()),
    email: reservationCustomerEmailSchema.make(testEmailAddress(name)),
  };
  let access: TestAdministratorAccess = "administrator";
  let reads = 0;

  mock.module(
    "@/features/administrators/server/administrator-access-layer.server",
    () => ({
      administratorAccessLayer: Layer.mergeAll(
        Layer.succeed(CustomerAuthentication, {
          currentUser: Effect.suspend(() => {
            reads += 1;
            if (access === "unavailable") {
              return Effect.fail(
                customerAccountUnavailable("authentication.session")
              );
            }
            return Effect.succeed(
              access === "signed-out"
                ? null
                : { ...administrator, deletionRequested: false }
            );
          }),
        }),
        Layer.succeed(AccountRoleGrants, {
          grant: () => Effect.die("unused"),
          revoke: () => Effect.die("unused"),
          has: () => Effect.sync(() => access === "administrator"),
          lockHeld: () => Effect.die("unused"),
          list: () => Effect.die("unused"),
        })
      ),
    })
  );

  return {
    administrator,
    reads: () => reads,
    set: (next) => {
      access = next;
    },
  };
};
