import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
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

const activeSession = {
  accountId: "@test/account-id" as const,
  email: "ada@example.test",
  deletionRequested: false,
};

describe("account actions", () => {
  beforeEach(() => {
    profileCalls.length = 0;
    revalidatePath.mockClear();
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
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account");
  });

  test("updates the profile when the account already links a customer", async () => {
    const { updateCustomerProfile } = await importActions();

    const result = await updateCustomerProfile({ firstName: "Grace" });

    expect(result).toEqual({ data: { status: "updated" } });
    expect(profileCalls.map(({ op }) => op)).toEqual(["update"]);
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account");
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

  test("deletes through the Better Auth endpoint and revalidates account and deleted paths", async () => {
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
  });
});
