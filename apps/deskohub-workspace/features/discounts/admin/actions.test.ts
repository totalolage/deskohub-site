import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Predicate } from "effect";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";

const access = mockAdministratorAccess("discount-administration-actions");
const revalidatedPaths: string[] = [];

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () =>
    new Headers({ referer: "https://deskohub.test/en-US/admin" }),
}));
mock.module("next/server", () => ({
  after: () => undefined,
  connection: () => Promise.resolve(),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("@/features/i18n/server/revalidate-localized-path", () => ({
  revalidateLocalizedPath: (path: string) => {
    revalidatedPaths.push(path);
  },
}));

const { DiscountAdministration, DiscountAdminNotFoundError } = await import(
  "./discount-administration.service"
);
const { getDiscountAdminMutationErrorMessage } = await import(
  "./mutation-error-message"
);

type Administration = DiscountAdministration["Service"];

let administration: Partial<
  Record<keyof Administration, () => Effect.Effect<unknown, unknown>>
> = {};
const calls: string[] = [];

// Answers only the calls a test sets; any other call is a test failure.
DiscountAdministration.Live = Layer.succeed(
  DiscountAdministration,
  new Proxy({} as Administration, {
    get: (_, method) => {
      if (!Predicate.isString(method)) return undefined;
      calls.push(method);
      return (
        administration[method as keyof Administration] ??
        (() => Effect.die(`unexpected ${method}`))
      );
    },
  })
);

// Imported after the fake, since the actions take the layer on load.
const { mutateDiscountAdmin, searchDiscountAdminCustomers } = await import(
  "./actions"
);

const customerCode = {
  kind: "create-customer-code",
  customerId: "customer-id",
  code: {
    code: "SUMMER10",
    enabled: true,
    validFrom: "2026-08-01T00:00:00+02:00",
    validUntil: "2026-09-01T00:00:00+02:00",
    maxUses: 100,
  },
  discount: {
    kind: "existing",
    discountId: "019c91dd-c560-7e55-b9d8-c95065efd51d",
  },
} as const;

beforeEach(() => {
  access.set("administrator");
  administration = {};
  calls.length = 0;
  revalidatedPaths.length = 0;
});

describe("mutateDiscountAdmin", () => {
  test("revalidates the customer page a customer code was created for", async () => {
    administration = {
      createCustomerCode: () =>
        Effect.succeed("019c91dd-c560-7e55-b9d8-c95065efd51f"),
    };

    const result = await mutateDiscountAdmin(customerCode);

    expect(result).toHaveProperty("data");
    expect(calls).toEqual(["createCustomerCode"]);
    expect(revalidatedPaths).toEqual([
      administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId: "customer-id",
      }),
    ]);
  });

  test("words a failed mutation for the operator and revalidates nothing", async () => {
    const missing = new DiscountAdminNotFoundError({
      resource: { kind: "Dotypos customer", id: "customer-id" as never },
      message: "missing",
    });
    administration = { createCustomerCode: () => Effect.fail(missing) };

    const result = await mutateDiscountAdmin(customerCode);

    expect(result).toEqual({
      serverError: getDiscountAdminMutationErrorMessage(missing, "en-US"),
    });
    expect(revalidatedPaths).toEqual([]);
  });

  test("refuses an account without the grant before any mutation", async () => {
    access.set("not-administrator");

    const result = await mutateDiscountAdmin(customerCode);

    expect(result).toHaveProperty("serverError");
    expect(result).not.toHaveProperty("data");
    expect(calls).toEqual([]);
    expect(revalidatedPaths).toEqual([]);
  });
});

describe("searchDiscountAdminCustomers", () => {
  test("reports any failed search as unavailable", async () => {
    administration = {
      searchCustomers: () => Effect.fail(new Error("Dotypos unavailable")),
    };

    expect(await searchDiscountAdminCustomers({ query: "customer" })).toEqual({
      serverError: m.discountsErrorCustomerSearchUnavailable(
        {},
        { locale: "en-US" }
      ),
    });
  });
});
