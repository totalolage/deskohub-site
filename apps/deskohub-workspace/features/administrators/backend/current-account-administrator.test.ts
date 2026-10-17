import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { AccountRoleGrants } from "./account-role-grants.service";

const accountId = customerAccountIdSchema.make("synthetic-account");
const signedInSession = {
  accountId,
  email: reservationCustomerEmailSchema.make(testEmailAddress("administrator")),
  deletionRequested: false,
} as const;

const has = mock(() => Effect.succeed(false));
let currentUser: Effect.Effect<typeof signedInSession | null, never> =
  Effect.succeed(signedInSession);

const testLayer = () =>
  Layer.mergeAll(
    Layer.succeed(CustomerAuthentication, { currentUser }),
    Layer.mock(AccountRoleGrants, { has })
  );

beforeEach(() => {
  has.mockReset();
  has.mockImplementation(() => Effect.succeed(false));
  currentUser = Effect.succeed(signedInSession);
});

describe("currentAccountIsAdministrator", () => {
  test("is true when the session's account holds the administrator grant", async () => {
    has.mockImplementation(() => Effect.succeed(true));
    const { currentAccountIsAdministrator } = await import(
      "./current-account-administrator"
    );

    const isAdministrator = await currentAccountIsAdministrator.pipe(
      Effect.provide(testLayer()),
      Effect.runPromise
    );

    expect(isAdministrator).toBe(true);
    expect(has).toHaveBeenCalledWith({ accountId, role: "administrator" });
  });

  test("is false for a signed-in customer without the grant", async () => {
    const { currentAccountIsAdministrator } = await import(
      "./current-account-administrator"
    );

    const isAdministrator = await currentAccountIsAdministrator.pipe(
      Effect.provide(testLayer()),
      Effect.runPromise
    );

    expect(isAdministrator).toBe(false);
  });

  test("is false without reading grants for an anonymous visitor", async () => {
    currentUser = Effect.succeed(null);
    const { currentAccountIsAdministrator } = await import(
      "./current-account-administrator"
    );

    const isAdministrator = await currentAccountIsAdministrator.pipe(
      Effect.provide(testLayer()),
      Effect.runPromise
    );

    expect(isAdministrator).toBe(false);
    expect(has).not.toHaveBeenCalled();
  });
});
