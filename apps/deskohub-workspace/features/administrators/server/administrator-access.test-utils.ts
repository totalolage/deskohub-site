import { mock } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
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
type TestAdministratorAccess =
  | "administrator"
  | "not-administrator"
  | "signed-out"
  | "unavailable";

/** The session and grant reads a test drives, from `mockAdministratorAccess`. */
export interface TestAdministratorAccessControl {
  /** The administrator the request starts as and returns to on `reset()`. */
  readonly administrator: AdministratorAccountActor;
  /** The selected account, which the session reads as while signed in. */
  readonly actor: () => AdministratorAccountActor;
  /** Reads the session as another account, keeping the current access. */
  readonly actAs: (actor: AdministratorAccountActor) => void;
  /** How often the guards read the session since the last `reset()`. */
  readonly reads: () => number;
  readonly set: (access: TestAdministratorAccess) => void;
  /** Returns to `administrator` with the grant and a zero read count. */
  readonly reset: () => void;
}

/**
 * Substitutes the session and grant reads behind the administration request
 * edge, so a test drives pages and actions through the real guards. Call it
 * before importing the module under test; it starts as `administrator`.
 * Server Action tests get it through `mockAdministrationActionRequest`.
 */
export const mockAdministratorAccess = (
  name = "administration-request"
): TestAdministratorAccessControl => {
  const administrator: AdministratorAccountActor = {
    accountId: customerAccountIdSchema.make(crypto.randomUUID()),
    email: reservationCustomerEmailSchema.make(testEmailAddress(name)),
  };
  let actor = administrator;
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
                : { ...actor, deletionRequested: false, ...testSessionProfile }
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
    actor: () => actor,
    actAs: (next) => {
      actor = next;
    },
    reads: () => reads,
    set: (next) => {
      access = next;
    },
    reset: () => {
      actor = administrator;
      access = "administrator";
      reads = 0;
    },
  };
};
