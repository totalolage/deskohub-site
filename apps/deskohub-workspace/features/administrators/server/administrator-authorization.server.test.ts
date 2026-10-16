import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit, Layer } from "effect";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "@/features/account/backend/customer-authentication.service";
import {
  customerAccountIdSchema,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { AccountRoleGrants } from "../backend/account-role-grants.service";

const actor = {
  accountId: customerAccountIdSchema.make(crypto.randomUUID()),
  email: reservationCustomerEmailSchema.make(
    testEmailAddress("administrator-authorization")
  ),
};
const session: CustomerAccountSession = { ...actor, deletionRequested: false };

let currentUser: CustomerAuthentication["Service"]["currentUser"] =
  Effect.succeed(session);
let granted = true;
let requestHeaders = new Headers();

class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super("redirect");
  }
}
class NotFoundSignal extends Error {}

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => requestHeaders,
}));
mock.module("next/server", () => ({
  after: () => {},
  connection: () => Promise.resolve(),
}));
mock.module("next/navigation", () => ({
  redirect: (location: string) => {
    throw new RedirectSignal(location);
  },
  notFound: () => {
    throw new NotFoundSignal();
  },
  unstable_rethrow: () => undefined,
}));
mock.module("./administrator-access-layer.server", () => ({
  administratorAccessLayer: Layer.mergeAll(
    Layer.succeed(CustomerAuthentication, {
      currentUser: Effect.suspend(() => currentUser),
    }),
    Layer.succeed(AccountRoleGrants, {
      grant: () => Effect.die("unused"),
      revoke: () => Effect.die("unused"),
      has: () => Effect.sync(() => granted),
    })
  ),
}));

const { authorizeAdministratorPage, requireAdministratorAuthorization } =
  await import("./administrator-authorization.server");

const pageOutcome = async () => {
  try {
    return { kind: "ok" as const, value: await authorizeAdministratorPage() };
  } catch (signal) {
    if (signal instanceof RedirectSignal) {
      return { kind: "redirect" as const, location: signal.location };
    }
    if (signal instanceof NotFoundSignal) return { kind: "not-found" as const };
    throw signal;
  }
};

describe("authorizeAdministratorPage", () => {
  test("returns the administrator account actor", async () => {
    currentUser = Effect.succeed(session);
    granted = true;

    expect(await pageOutcome()).toEqual({ kind: "ok", value: actor });
  });

  test("sends a signed-out visitor to sign-in and back to the page", async () => {
    currentUser = Effect.succeed(null);
    requestHeaders = new Headers({
      "x-deskohub-administration-path": "/cs-CZ/admin/invoices?page=2",
    });

    expect(await pageOutcome()).toEqual({
      kind: "redirect",
      location: `/cs-CZ/auth/sign-in?returnTo=${encodeURIComponent(
        "/cs-CZ/admin/invoices?page=2"
      )}`,
    });
  });

  test("drops a return path that leaves the site", async () => {
    currentUser = Effect.succeed(null);
    requestHeaders = new Headers({
      "x-deskohub-administration-path": "//evil.example/admin",
    });

    expect(await pageOutcome()).toEqual({
      kind: "redirect",
      location: "/en-US/auth/sign-in",
    });
  });

  test("answers a signed-in account without the grant with the ordinary 404", async () => {
    currentUser = Effect.succeed(session);
    granted = false;

    expect(await pageOutcome()).toEqual({ kind: "not-found" });
  });

  test("stops serving on the next request after a revocation", async () => {
    currentUser = Effect.succeed(session);
    granted = true;
    expect(await pageOutcome()).toEqual({ kind: "ok", value: actor });

    currentUser = Effect.succeed(session);
    granted = false;
    expect(await pageOutcome()).toEqual({ kind: "not-found" });
  });

  test("fails closed when the session or grant can't be read", async () => {
    currentUser = Effect.fail(
      customerAccountUnavailable("authentication.session")
    );

    await expect(pageOutcome()).rejects.toBeDefined();
  });
});

describe("requireAdministratorAuthorization", () => {
  test("returns the administrator account actor", async () => {
    currentUser = Effect.succeed(session);
    granted = true;

    expect(
      await Effect.runPromiseExit(requireAdministratorAuthorization)
    ).toEqual(Exit.succeed(actor));
  });

  test.each([
    ["signed out", Effect.succeed(null), true],
    ["without the grant", Effect.succeed(session), false],
    [
      "when the session read fails",
      Effect.fail(customerAccountUnavailable("authentication.session")),
      true,
    ],
  ] as const)("fails closed without a redirect %s", async (_, user, grant) => {
    currentUser = user;
    granted = grant;

    const exit = await Effect.runPromiseExit(requireAdministratorAuthorization);

    expect(exit).toMatchObject(
      Exit.fail({ _tag: "AdministratorUnauthorizedError" })
    );
  });
});
