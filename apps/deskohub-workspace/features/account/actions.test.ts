import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AresLookupFailure } from "@deskohub/ares";
import { Context, Effect, Layer } from "effect";
import { CustomerAccountAccessError } from "./customer-account";

const revalidatePath = mock((_path: string) => undefined);
mock.module("next/cache", () => ({ revalidatePath }));

const requestHeaders = new Headers({ referer: "https://deskohub.test/en-US" });
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ getAll: () => [] }),
}));
mock.module("next/server", () => ({
  after: () => undefined,
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("botid/server", () => ({
  checkBotId: () => Promise.resolve({ isBot: false }),
}));

const areAccountsEnabled = mock(() => Promise.resolve(true));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled,
}));

let deleteUser: (args: { body: object; headers: Headers }) => Promise<unknown>;
mock.module("@/features/account/server/auth.server", () => ({
  auth: {
    api: {
      deleteUser: (args: { body: object; headers: Headers }) =>
        deleteUser(args),
    },
  },
}));

type Session = {
  readonly accountId: "@test/account-id";
  readonly email: string;
  readonly deletionRequested: boolean;
};

let currentUser: Effect.Effect<Session | null, unknown>;
const Authentication = Context.Service<
  Authentication,
  { readonly currentUser: Effect.Effect<Session | null, unknown> }
>()("@test/ActionsAuthentication");
Object.assign(Authentication, {
  Default: Layer.effect(
    Authentication,
    Effect.succeed({
      get currentUser() {
        return currentUser;
      },
    })
  ),
});
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);

type ProfileInput = {
  firstName: string;
  lastName?: string;
  phone?: string;
};

type Resolution =
  | {
      readonly accountId: "@test/account-id";
      readonly dotyposCustomerId: string;
    }
  | { readonly reason: string; readonly linkReason?: string };

let resolve: Effect.Effect<
  Extract<Resolution, { accountId: string }>,
  Extract<Resolution, { reason: string }>
>;
type ResolutionEffect = typeof resolve;
const Resolver = Context.Service<
  Resolver,
  { readonly resolve: ResolutionEffect }
>()("@test/ActionsResolver");
Object.assign(Resolver, {
  Live: Layer.succeed(Resolver, {
    get resolve() {
      return resolve;
    },
  }),
});
mock.module(
  "@/features/account/backend/customer-account-resolver.service",
  () => ({
    CustomerAccountResolver: Resolver,
  })
);

const profileCalls: { op: string; args: unknown[] }[] = [];
const Profile = Context.Service<
  Profile,
  {
    readonly update: (
      account: { accountId: string; dotyposCustomerId: string },
      input: ProfileInput
    ) => Effect.Effect<{ firstName: string }, never>;
    readonly create: (
      accountId: string,
      email: string,
      input: ProfileInput
    ) => Effect.Effect<{ firstName: string }, never>;
  }
>()("@test/ActionsProfile");
Object.assign(Profile, {
  Live: Layer.succeed(Profile, {
    update: (account, input) => {
      profileCalls.push({ op: "update", args: [account, input] });
      return Effect.succeed({ firstName: "Ada" });
    },
    create: (accountId, email, input) => {
      profileCalls.push({ op: "create", args: [accountId, email, input] });
      return Effect.succeed({ firstName: "Ada" });
    },
  }),
});
mock.module("@/features/account/backend/customer-profile.service", () => ({
  CustomerProfileService: Profile,
}));

let lookupOutcome: Effect.Effect<
  typeof syntheticAresCompany,
  AresLookupFailure
>;
let lookupCalls: string[];
const AresLookup = Context.Service<
  AresLookup,
  {
    readonly lookup: (
      ico: string
    ) => Effect.Effect<typeof syntheticAresCompany, AresLookupFailure>;
  }
>()("@test/ActionsAresLookup");
Object.assign(AresLookup, {
  Live: Layer.succeed(AresLookup, {
    lookup: (ico: string) => {
      lookupCalls.push(ico);
      return lookupOutcome;
    },
  }),
});
mock.module("@deskohub/ares", () => ({
  AresLookupFailure,
  AresLookupService: AresLookup,
}));

const syntheticAresCompany = {
  ico: "27082440",
  obchodniJmeno: "Synthetická testovací s.r.o.",
  dic: "CZ27082440",
  sidlo: {
    nazevUlice: "Testovací ulice",
    cisloDomovni: 123,
    cisloOrientacni: 4,
    nazevObce: "Praha",
    psc: 11000,
    kodStatu: "CZ",
  },
};

const activeSession = {
  accountId: "@test/account-id" as const,
  email: "ada@example.test",
  deletionRequested: false,
};

describe("account actions", () => {
  beforeEach(() => {
    profileCalls.length = 0;
    revalidatePath.mockClear();
    areAccountsEnabled.mockReset();
    areAccountsEnabled.mockResolvedValue(true);
    currentUser = Effect.succeed(activeSession);
    resolve = Effect.succeed({
      accountId: "@test/account-id",
      dotyposCustomerId: "60111",
    });
    deleteUser = () => Promise.resolve({ success: true });
  });

  const importActions = () => import("./actions");

  test("creates the profile from the verified session when no profile matches", async () => {
    resolve = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "not-found",
      })
    );
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({ firstName: "Ada" });

    expect(result).toEqual({ data: { status: "completed" } });
    expect(profileCalls.map(({ op }) => op)).toEqual(["create"]);
    expect(profileCalls[0]!.args).toEqual([
      "@test/account-id",
      "ada@example.test",
      { firstName: "Ada" },
    ]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("updates the profile when the account already links a customer", async () => {
    const { updateCustomerProfile } = await importActions();

    const result = await updateCustomerProfile({ firstName: "Grace" });

    expect(result).toEqual({ data: { status: "updated" } });
    expect(profileCalls.map(({ op }) => op)).toEqual(["update"]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("rejects an email in the profile input and never forwards profile fields containing one", async () => {
    const { updateCustomerProfile } = await importActions();

    const result = await updateCustomerProfile({
      firstName: "Ada",
      email: "sneaky@example.test",
    } as never);

    expect(result.validationErrors).toBeTruthy();
    expect(profileCalls).toHaveLength(0);
    expect(JSON.stringify(profileCalls)).not.toContain("sneaky@example.test");
  });

  test("returns the localized profile error when the resolver blocks the edit", async () => {
    resolve = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "deletion-requested",
      })
    );
    const { updateCustomerProfile } = await importActions();

    const result = await updateCustomerProfile({ firstName: "Ada" });

    expect(result.serverError).toBe(
      "Your account is already being deleted, so the profile cannot be changed."
    );
    expect(profileCalls).toHaveLength(0);
  });

  test("never creates or updates a profile when resolution reports an unusable exact-email profile", async () => {
    resolve = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "unusable",
      })
    );
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({ firstName: "Ada" });

    expect(result.serverError).toBeTruthy();
    expect(profileCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("returns the existing unavailable failure without reading account data when accounts are disabled", async () => {
    areAccountsEnabled.mockResolvedValue(false);
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({ firstName: "Ada" });

    expect(result.serverError).toBe(
      "We cannot reach your account right now. Reservations can still be made without an account."
    );
    expect(profileCalls).toHaveLength(0);
    expect(areAccountsEnabled).toHaveBeenCalledTimes(1);
  });

  test("applies the unavailable failure to profile updates when accounts are disabled", async () => {
    areAccountsEnabled.mockResolvedValue(false);
    const { updateCustomerProfile } = await importActions();

    const result = await updateCustomerProfile({ firstName: "Ada" });

    expect(result.serverError).toBe(
      "We cannot reach your account right now. Reservations can still be made without an account."
    );
    expect(profileCalls).toHaveLength(0);
    expect(areAccountsEnabled).toHaveBeenCalledTimes(1);
  });

  test("deletes through the Better Auth endpoint and revalidates account and deleted paths", async () => {
    areAccountsEnabled.mockResolvedValue(false);
    const seen: { body: object; headers: Headers }[] = [];
    deleteUser = async (args) => {
      seen.push(args);
      return { success: true };
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "deleted" } });
    expect(seen).toHaveLength(1);
    expect(String(seen[0]!.headers.get("referer"))).toContain("deskohub.test");
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account");
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account/deleted");
  });

  test("asks for reauthentication when the delete endpoint reports a stale session", async () => {
    const { APIError } = await import("better-auth");
    deleteUser = () => {
      throw new APIError("BAD_REQUEST", {
        message: "Session expired. Re-authenticate to perform this action.",
        code: "SESSION_EXPIRED",
      });
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "reauthentication-required" } });
  });

  test("asks for reauthentication when the session is already gone", async () => {
    currentUser = Effect.succeed(null);

    let deleteUserCalls = 0;
    deleteUser = () => {
      deleteUserCalls += 1;
      return Promise.resolve({ success: true });
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "reauthentication-required" } });
    expect(deleteUserCalls).toBe(0);
  });

  test("reports a retryable failure for other endpoint errors and keeps the account", async () => {
    const { APIError } = await import("better-auth");
    deleteUser = () => {
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "beforeDelete failed",
      });
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "failed" } });
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account");
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account/deleted");
  });
});

describe("account ARES business lookup action", () => {
  beforeEach(() => {
    profileCalls.length = 0;
    revalidatePath.mockClear();
    areAccountsEnabled.mockReset();
    areAccountsEnabled.mockResolvedValue(true);
    currentUser = Effect.succeed(activeSession);
    resolve = Effect.succeed({
      accountId: "@test/account-id",
      dotyposCustomerId: "60111",
    });
    lookupCalls = [];
    lookupOutcome = Effect.succeed(syntheticAresCompany);
  });

  const importActions = () => import("./actions");

  test("returns the mapped billing draft for a found company with one provider call", async () => {
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: " 27082440 " });

    expect(result).toEqual({
      data: {
        status: "found",
        company: {
          companyName: "Synthetická testovací s.r.o.",
          companyId: "27082440",
          vatId: "CZ27082440",
          addressLine1: "Testovací ulice 123/4",
          city: "Praha",
          zip: "11000",
          country: "CZ",
        },
      },
    });
    expect(lookupCalls).toEqual(["27082440"]);
    expect(profileCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("reports an invalid company ID without touching the registry", async () => {
    lookupOutcome = Effect.fail(
      new AresLookupFailure({ reason: "InvalidIco" })
    );
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "1234567a" });

    expect(result).toEqual({
      data: {
        status: "invalid-ico",
        message:
          "Enter a valid company ID (IČO): exactly eight digits with a valid check digit.",
      },
    });
    expect(lookupCalls).toEqual(["1234567a"]);
  });

  test("reports a missing company as not found", async () => {
    lookupOutcome = Effect.fail(new AresLookupFailure({ reason: "NotFound" }));
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result).toEqual({
      data: {
        status: "not-found",
        message: "No company was found for this company ID (IČO).",
      },
    });
  });

  test("reports an unavailable registry as retryable", async () => {
    lookupOutcome = Effect.fail(
      new AresLookupFailure({ reason: "Unavailable" })
    );
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result).toEqual({
      data: {
        status: "unavailable",
        message:
          "The business registry is temporarily unavailable. Please try again in a moment.",
      },
    });
  });

  test("never looks up a company without a verified session", async () => {
    currentUser = Effect.succeed(null);
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result.serverError).toBe(
      "Your session has expired. Please sign in again."
    );
    expect(lookupCalls).toHaveLength(0);
  });

  test("succeeds for a verified unlinked account without resolving the customer", async () => {
    let resolverRuns = 0;
    resolve = Effect.suspend(() => {
      resolverRuns += 1;
      return Effect.fail(
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "not-found",
        })
      );
    });
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result).toEqual({
      data: {
        status: "found",
        company: {
          companyName: "Synthetická testovací s.r.o.",
          companyId: "27082440",
          vatId: "CZ27082440",
          addressLine1: "Testovací ulice 123/4",
          city: "Praha",
          zip: "11000",
          country: "CZ",
        },
      },
    });
    expect(lookupCalls).toEqual(["27082440"]);
    // The read-only lookup must not run any resolver-owned write seam:
    // no resolution (which can reactivate and claim), no profile
    // classification, create, update, or patch.
    expect(resolverRuns).toBe(0);
    expect(profileCalls).toHaveLength(0);
  });

  test("never looks up a company while deletion is pending", async () => {
    currentUser = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result.serverError).toBe(
      "Your account is already being deleted, so the profile cannot be changed."
    );
    expect(lookupCalls).toHaveLength(0);
    expect(profileCalls).toHaveLength(0);
  });

  test("never looks up a company when accounts are disabled", async () => {
    areAccountsEnabled.mockResolvedValue(false);
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result.serverError).toBe(
      "We cannot reach your account right now. Reservations can still be made without an account."
    );
    expect(lookupCalls).toHaveLength(0);
    expect(areAccountsEnabled).toHaveBeenCalledTimes(1);
  });
});
