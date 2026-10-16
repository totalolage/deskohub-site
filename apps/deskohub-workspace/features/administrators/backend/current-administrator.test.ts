import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit, Layer } from "effect";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "@/features/account/backend/customer-authentication.service";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { AccountRoleGrants } from "./account-role-grants.service";
import { currentAdministratorAccess } from "./current-administrator";

const accountId = customerAccountIdSchema.make(crypto.randomUUID());
const email = reservationCustomerEmailSchema.make(
  testEmailAddress("current-administrator")
);
const session: CustomerAccountSession = {
  accountId,
  email,
  deletionRequested: false,
};

const readAccess = ({
  currentUser,
  granted,
}: {
  readonly currentUser: CustomerAuthentication["Service"]["currentUser"];
  readonly granted: () => boolean;
}) => {
  const grantChecks: unknown[] = [];
  const run = () =>
    Effect.runPromiseExit(
      currentAdministratorAccess.pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(CustomerAuthentication, { currentUser }),
            Layer.succeed(AccountRoleGrants, {
              grant: () => Effect.die("unused"),
              revoke: () => Effect.die("unused"),
              has: (key) =>
                Effect.sync(() => {
                  grantChecks.push(key);
                  return granted();
                }),
            })
          )
        )
      )
    );
  return { run, grantChecks };
};

describe("currentAdministratorAccess", () => {
  test("acts as the account when its verified session holds the grant", async () => {
    const { run, grantChecks } = readAccess({
      currentUser: Effect.succeed(session),
      granted: () => true,
    });

    expect(await run()).toEqual(
      Exit.succeed({
        kind: "administrator",
        actor: { accountId, email },
      })
    );
    expect(grantChecks).toEqual([{ accountId, role: "administrator" }]);
  });

  test("checks the grant on every read, so a revocation applies next time", async () => {
    let granted = true;
    const { run, grantChecks } = readAccess({
      currentUser: Effect.succeed(session),
      granted: () => granted,
    });

    expect(await run()).toMatchObject(Exit.succeed({ kind: "administrator" }));
    granted = false;
    expect(await run()).toEqual(Exit.succeed({ kind: "not-administrator" }));
    expect(grantChecks).toHaveLength(2);
  });

  test("treats a signed-in account without the grant as not an administrator", async () => {
    const { run } = readAccess({
      currentUser: Effect.succeed(session),
      granted: () => false,
    });

    expect(await run()).toEqual(Exit.succeed({ kind: "not-administrator" }));
  });

  test("never grants access to an account awaiting deletion", async () => {
    const { run, grantChecks } = readAccess({
      currentUser: Effect.succeed({ ...session, deletionRequested: true }),
      granted: () => true,
    });

    expect(await run()).toEqual(Exit.succeed({ kind: "not-administrator" }));
    expect(grantChecks).toEqual([]);
  });

  test.each([
    ["no session", Effect.succeed(null)],
    [
      "an unauthenticated session",
      Effect.fail(
        new CustomerAccountAccessError({ reason: "unauthenticated" })
      ),
    ],
    [
      "an unverified email",
      Effect.fail(
        new CustomerAccountAccessError({ reason: "unverified-email" })
      ),
    ],
  ] as const)("reads %s as signed out", async (_, currentUser) => {
    const { run, grantChecks } = readAccess({
      currentUser,
      granted: () => true,
    });

    expect(await run()).toEqual(Exit.succeed({ kind: "signed-out" }));
    expect(grantChecks).toEqual([]);
  });

  test("keeps a session read failure in the error channel", async () => {
    const { run } = readAccess({
      currentUser: Effect.fail(
        customerAccountUnavailable("authentication.session")
      ),
      granted: () => true,
    });

    expect(Exit.isFailure(await run())).toBe(true);
  });
});
