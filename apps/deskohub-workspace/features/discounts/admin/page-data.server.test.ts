import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Predicate } from "effect";
import { mockAdministratorAccess } from "@/features/administrators/server/administrator-access.test-utils";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import type { DiscountCodeId, VoucherId } from "../persistence-contracts";

const access = mockAdministratorAccess("discount-administration-pages");

mock.module("server-only", () => ({}));
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

const { DiscountAdministration, DiscountAdminNotFoundError } = await import(
  "./discount-administration.service"
);
const pages = await import("./page-data.server");

type Administration = DiscountAdministration["Service"];

let administration: Partial<
  Record<keyof Administration, () => Effect.Effect<unknown, unknown>>
> = {};
const calls: string[] = [];

// Answers only the reads a test sets; any other read is a test failure.
const originalLive = DiscountAdministration.Live;
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

const codeId = "019c91dd-c560-7e55-b9d8-c95065efd51d" as DiscountCodeId;
const voucherId = "019c91dd-c560-7e55-b9d8-c95065efd51e" as VoucherId;
const customerId = "customer-id" as DotyposCustomerId;
const missingCustomer = new DiscountAdminNotFoundError({
  resource: { kind: "Dotypos customer", id: customerId },
  message: "missing",
});
const missingRecord = () => Effect.fail(missingCustomer);
const searchParams = () =>
  Promise.resolve({ notice: "Saved", status: "success" });

// The real `notFound` throws an error whose digest names the outcome.
const pageOutcome = async <A>(load: () => Promise<A>) => {
  try {
    return { kind: "ok" as const, value: await load() };
  } catch (signal) {
    if (
      Predicate.hasProperty(signal, "digest") &&
      signal.digest === "NEXT_HTTP_ERROR_FALLBACK;404"
    ) {
      return { kind: "not-found" as const };
    }
    throw signal;
  }
};

afterAll(() => {
  DiscountAdministration.Live = originalLive;
});

beforeEach(() => {
  access.set("administrator");
  administration = {};
  calls.length = 0;
});

describe("discount administration record pages", () => {
  const recordPages = [
    {
      read: "loadCodeDetail",
      load: () => pages.loadDiscountAdminCodePageData(codeId, searchParams()),
    },
    {
      read: "loadVoucherDetail",
      load: () =>
        pages.loadDiscountAdminVoucherPageData(voucherId, searchParams()),
    },
    {
      read: "loadCustomerProfile",
      load: () =>
        pages.loadDiscountAdminCustomerPageData(customerId, searchParams()),
    },
    {
      read: "loadCustomerCodeCreation",
      load: () =>
        pages.loadDiscountAdminCustomerCodeCreationPageData(customerId),
    },
    {
      read: "loadCustomerVoucherCreation",
      load: () =>
        pages.loadDiscountAdminCustomerVoucherCreationPageData(customerId),
    },
  ] as const;

  test.each(recordPages)(
    "answers a missing record with the ordinary 404 ($read)",
    async ({ load, read }) => {
      administration = { [read]: missingRecord };

      expect(await pageOutcome(load)).toEqual({ kind: "not-found" });
      expect(calls).toEqual([read]);
    }
  );

  test.each(recordPages)(
    "reads nothing for an account without the grant ($read)",
    async ({ load }) => {
      access.set("not-administrator");

      expect(await pageOutcome(load)).toEqual({ kind: "not-found" });
      expect(calls).toEqual([]);
    }
  );

  test("shows a record beside the page's notice", async () => {
    const detail = { code: { id: codeId } };
    administration = { loadCodeDetail: () => Effect.succeed(detail) };

    expect(
      await pageOutcome(() =>
        pages.loadDiscountAdminCodePageData(codeId, searchParams())
      )
    ).toEqual({
      kind: "ok",
      value: { detail, notice: { message: "Saved", status: "success" } },
    });
  });
});

describe("discount administration pages that never 404", () => {
  test("shows the customer page without a profile it can't read", async () => {
    administration = { loadCustomerProfile: missingRecord };
    expect(
      await pages.loadOptionalDiscountAdminCustomerPageData(
        customerId,
        Promise.resolve({})
      )
    ).toEqual({ profile: null, notice: undefined });

    administration = {
      loadCustomerProfile: () => Effect.fail(new Error("Dotypos unavailable")),
    };
    expect(
      await pages.loadOptionalDiscountAdminCustomerPageData(
        customerId,
        searchParams()
      )
    ).toEqual({
      profile: null,
      notice: { message: "Saved", status: "success" },
    });
  });

  test("leaves the customer breadcrumb unlabelled when the name is unavailable", async () => {
    administration = { loadCustomerBreadcrumbLabel: missingRecord };

    expect(
      await pages.loadDiscountAdminCustomerBreadcrumbLabel(customerId, "en-US")
    ).toBeUndefined();
  });

  test("reads only the notice for the shell", async () => {
    expect(
      await pages.loadDiscountAdminShellPageData(
        Promise.resolve({ notice: "Saved", status: "unknown" })
      )
    ).toEqual({ notice: undefined });
    expect(calls).toEqual([]);
  });
});
