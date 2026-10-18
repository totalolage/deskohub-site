import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
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
import { AccountRoleGrants } from "../backend/account-role-grants.service";

const session: CustomerAccountSession = {
  accountId: customerAccountIdSchema.make(crypto.randomUUID()),
  email: reservationCustomerEmailSchema.make(
    testEmailAddress("current-account-administrator")
  ),
  deletionRequested: false,
};

let currentUser: CustomerAuthentication["Service"]["currentUser"] =
  Effect.succeed(session);
let granted: AccountRoleGrants["Service"]["has"] = () => Effect.succeed(true);
let grantChecks = 0;

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({
  after: () => {},
  connection: () => Promise.resolve(),
}));
mock.module("./administrator-access-layer.server", () => ({
  administratorAccessLayer: Layer.mergeAll(
    Layer.succeed(CustomerAuthentication, {
      currentUser: Effect.suspend(() => currentUser),
    }),
    Layer.succeed(AccountRoleGrants, {
      grant: () => Effect.die("unused"),
      revoke: () => Effect.die("unused"),
      has: (key) => {
        grantChecks += 1;
        return granted(key);
      },
    })
  ),
}));

const { isCurrentAccountAdministrator } = await import(
  "./current-account-administrator.server"
);

beforeEach(() => {
  currentUser = Effect.succeed(session);
  granted = () => Effect.succeed(true);
  grantChecks = 0;
});

describe("isCurrentAccountAdministrator", () => {
  test("is true for a verified session whose account holds the grant", async () => {
    expect(await isCurrentAccountAdministrator()).toBe(true);
  });

  test("is false for a signed-in account without the grant", async () => {
    granted = () => Effect.succeed(false);

    expect(await isCurrentAccountAdministrator()).toBe(false);
  });

  test("is false without a grant read for an account awaiting deletion", async () => {
    currentUser = Effect.succeed({ ...session, deletionRequested: true });

    expect(await isCurrentAccountAdministrator()).toBe(false);
    expect(grantChecks).toBe(0);
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
  ] as const)("is false without a grant read for %s", async (_, user) => {
    currentUser = user;

    expect(await isCurrentAccountAdministrator()).toBe(false);
    expect(grantChecks).toBe(0);
  });

  test("is false when the session read fails", async () => {
    currentUser = Effect.fail(
      customerAccountUnavailable("authentication.session")
    );

    expect(await isCurrentAccountAdministrator()).toBe(false);
  });

  test("is false when the grant lookup fails", async () => {
    granted = () => Effect.die(new Error("grant lookup unavailable"));

    expect(await isCurrentAccountAdministrator()).toBe(false);
  });
});
