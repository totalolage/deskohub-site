import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Context, Data, Effect, Layer } from "effect";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { m } from "@/features/administration/i18n";
import type { AdministratorAccountActor } from "../account-role";
import { mockAdministratorAccess } from "../server/administrator-access.test-utils";

class StubAdministratorAccountNotFoundError extends Data.TaggedError(
  "AdministratorAccountNotFoundError"
)<{ readonly message: string }> {}

class StubAdministratorSelfRevocationError extends Data.TaggedError(
  "AdministratorSelfRevocationError"
)<{ readonly message: string }> {}

const access = mockAdministratorAccess("roster-actor");
const actor = access.administrator;
const otherAccountId = customerAccountIdSchema.make("fixture-other");
const otherEmail = testEmailAddress("roster-other");

let referer = "https://deskohub.test/en-US/admin/administrators";
const rosterCalls: { readonly method: string; readonly input: unknown }[] = [];
const revalidatedPaths: string[] = [];
let grantResult: Effect.Effect<unknown, unknown> = Effect.succeed({});
let revokeResult: Effect.Effect<unknown, unknown> = Effect.succeed({});

class StubAdministratorRoster extends Context.Service<
  StubAdministratorRoster,
  {
    readonly grant: (input: {
      readonly email: string;
      readonly actor: AdministratorAccountActor;
    }) => Effect.Effect<unknown, unknown>;
    readonly revoke: (input: {
      readonly accountId: CustomerAccountId;
      readonly actor: AdministratorAccountActor;
    }) => Effect.Effect<unknown, unknown>;
  }
>()("@test/AdministratorRoster") {}

mock.module(
  "@/features/administrators/backend/administrator-roster.service",
  () => ({
    AdministratorRoster: Object.assign(StubAdministratorRoster, {
      Live: Layer.succeed(
        StubAdministratorRoster,
        StubAdministratorRoster.of({
          grant: (input) => {
            rosterCalls.push({ method: "grant", input });
            return grantResult;
          },
          revoke: (input) => {
            rosterCalls.push({ method: "revoke", input });
            return revokeResult;
          },
        })
      ),
    }),
  })
);

mock.module("@/features/i18n/server/revalidate-localized-path", () => ({
  revalidateLocalizedPath: (path: string) => {
    revalidatedPaths.push(path);
  },
}));

mock.module("next/server", () => ({
  after: () => undefined,
  connection: () => Promise.resolve(),
}));

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers({ referer }),
}));

const { grantAdministrator, revokeAdministrator } = await import("./actions");

beforeEach(() => {
  access.set("administrator");
  referer = "https://deskohub.test/en-US/admin/administrators";
  rosterCalls.length = 0;
  revalidatedPaths.length = 0;
});

describe("grantAdministrator action", () => {
  test("grants as the authorized administrator and refreshes the page", async () => {
    grantResult = Effect.succeed({ changed: true, email: otherEmail });

    const result = await grantAdministrator({ email: ` ${otherEmail} ` });

    expect(result).toEqual({ data: { changed: true, email: otherEmail } });
    expect(rosterCalls).toEqual([
      { method: "grant", input: { email: otherEmail, actor } },
    ]);
    expect(revalidatedPaths).toEqual(["/admin/administrators"]);
  });

  test("reports an existing grant as unchanged data, not an error", async () => {
    grantResult = Effect.succeed({ changed: false, email: otherEmail });

    const result = await grantAdministrator({ email: otherEmail });

    expect(result).toEqual({ data: { changed: false, email: otherEmail } });
  });

  test("tells the operator the person must sign in first", async () => {
    grantResult = Effect.fail(
      new StubAdministratorAccountNotFoundError({ message: "not found" })
    );

    const result = await grantAdministrator({ email: otherEmail });

    expect(result.serverError).toBe(
      m.administratorsGrantAccountNotFound({}, { locale: "en-US" })
    );
    expect(result.data).toBeUndefined();
    expect(revalidatedPaths).toEqual([]);
  });

  test("answers in the locale of the page that called it", async () => {
    referer = "https://deskohub.test/cs-CZ/admin/administrators";
    grantResult = Effect.fail(
      new StubAdministratorAccountNotFoundError({ message: "not found" })
    );

    const result = await grantAdministrator({ email: otherEmail });

    expect(result.serverError).toBe(
      m.administratorsGrantAccountNotFound({}, { locale: "cs-CZ" })
    );
  });

  test("rejects an invalid email before authorizing", async () => {
    const result = await grantAdministrator({ email: "not-an-email" });

    expect(result.validationErrors).toBeDefined();
    expect(rosterCalls).toEqual([]);
  });

  test("fails closed without the administrator grant", async () => {
    access.set("not-administrator");

    const result = await grantAdministrator({ email: otherEmail });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBe(
      m.administratorsGrantFailed({}, { locale: "en-US" })
    );
    expect(rosterCalls).toEqual([]);
    expect(revalidatedPaths).toEqual([]);
  });
});

describe("revokeAdministrator action", () => {
  test("revokes as the authorized administrator and refreshes the page", async () => {
    revokeResult = Effect.succeed({ changed: true });

    const result = await revokeAdministrator({ accountId: otherAccountId });

    expect(result).toEqual({ data: { changed: true } });
    expect(rosterCalls).toEqual([
      { method: "revoke", input: { accountId: otherAccountId, actor } },
    ]);
    expect(revalidatedPaths).toEqual(["/admin/administrators"]);
  });

  test("explains that administrators can't revoke their own grant", async () => {
    revokeResult = Effect.fail(
      new StubAdministratorSelfRevocationError({ message: "self" })
    );

    const result = await revokeAdministrator({ accountId: actor.accountId });

    expect(result.serverError).toBe(
      m.administratorsRevokeSelf({}, { locale: "en-US" })
    );
    expect(revalidatedPaths).toEqual([]);
  });

  test("fails closed without the administrator grant", async () => {
    access.set("not-administrator");

    const result = await revokeAdministrator({ accountId: otherAccountId });

    expect(result.data).toBeUndefined();
    expect(result.serverError).toBe(
      m.administratorsRevokeFailed({}, { locale: "en-US" })
    );
    expect(rosterCalls).toEqual([]);
  });
});
