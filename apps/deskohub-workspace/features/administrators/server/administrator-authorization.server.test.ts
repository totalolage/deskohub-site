import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Exit, Layer, Predicate } from "effect";
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

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => requestHeaders,
}));
mock.module("next/server", () => ({
  after: () => {},
  connection: () => Promise.resolve(),
}));
mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
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

// The real `redirect` and `notFound` throw errors whose digest names the
// outcome; other test files share the module, so it isn't mocked here.
const pageOutcome = async () => {
  try {
    return { kind: "ok" as const, value: await authorizeAdministratorPage() };
  } catch (signal) {
    const digest = Predicate.hasProperty(signal, "digest")
      ? signal.digest
      : undefined;
    if (!Predicate.isString(digest)) throw signal;
    const redirect = /^NEXT_REDIRECT;\w+;(.*);\d+;$/.exec(digest);
    if (redirect) return { kind: "redirect" as const, location: redirect[1] };
    if (digest === "NEXT_HTTP_ERROR_FALLBACK;404") {
      return { kind: "not-found" as const };
    }
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

// The mocked access layer is bound once per process, so every guard test
// shares this file's session and grant state.
describe("administration entry points without the administrator grant", () => {
  beforeEach(() => {
    currentUser = Effect.succeed(session);
    granted = false;
  });

  test("rejects direct invocations of every exported admin action", async () => {
    requestHeaders = new Headers({
      referer: "https://deskohub.test/admin/reservations",
    });
    const { mutateDiscountAdmin, searchDiscountAdminCustomers } = await import(
      "@/features/discounts/admin/actions"
    );
    const { getAdministrationReservation } = await import(
      "@/features/administration/actions"
    );

    const mutation = await mutateDiscountAdmin({
      kind: "delete-discount",
      id: "00000000-0000-0000-0000-000000000001",
    });
    const search = await searchDiscountAdminCustomers({
      query: "attacker-controlled-name",
    });
    const reservation = await getAdministrationReservation({
      identifier: "attacker-controlled-id",
    });
    const { grantAdministrator, revokeAdministrator } = await import(
      "@/features/administrators/admin/actions"
    );
    const grant = await grantAdministrator({
      email: testEmailAddress("attacker-chosen-administrator"),
    });
    const revoke = await revokeAdministrator({ accountId: session.accountId });

    expect(mutation).toHaveProperty("serverError");
    expect(mutation).not.toHaveProperty("data");
    expect(search).toHaveProperty("serverError");
    expect(search).not.toHaveProperty("data");
    expect(reservation).toHaveProperty("serverError");
    expect(reservation).not.toHaveProperty("data");
    for (const result of [grant, revoke]) {
      expect(result).toHaveProperty("serverError");
      expect(result).not.toHaveProperty("data");
    }
  });

  test("rejects direct invocations of every exported admin page-data loader", async () => {
    const authorization = await import("./administrator-authorization.server");
    const administrators = await import(
      "@/features/administrators/admin/page-data.server"
    );
    const administration = await import(
      "@/features/administration/page-data.server"
    );
    const discounts = await import(
      "@/features/discounts/admin/page-data.server"
    );
    const accounting = await import(
      "@/features/accounting/admin/page-data.server"
    );
    const invoiceBreadcrumb = await import(
      "@/features/accounting/admin/invoice-breadcrumb.server"
    );
    const adminCli = await import("@/features/admin-cli/page-data.server");
    const searchParams = Promise.resolve({});
    const operations = [
      authorization.authorizeAdministratorPage,
      administration.loadAdministrationOverview,
      administration.loadAdministrationRefundAttention,
      administration.loadAdministrationReservationOverview,
      () =>
        administration.loadAdministrationReservationsPage(searchParams).result,
      () => administration.loadAdministrationReservation("reservation-id"),
      () =>
        administration.loadAdministrationReservationBreadcrumbLabel(
          "reservation-id"
        ),
      () => administration.loadAdministrationBookingsPage(searchParams).result,
      () => administration.loadAdministrationBooking("booking-id"),
      () =>
        administration.loadAdministrationBookingBreadcrumbLabel("booking-id"),
      () => administration.loadAdministrationCustomersPage(searchParams).result,
      () =>
        administration.loadAdministrationCustomerReservations(
          "customer-id",
          searchParams
        ),
      () => administration.loadAdministrationCustomerActivity("customer-id"),
      () =>
        administration.loadAdministrationCustomerReservationActivity(
          "customer-id"
        ),
      () => administration.loadAdministrationOrdersPage(searchParams).result,
      () => administration.loadAdministrationOrder("order-id"),
      () =>
        administration.loadAdministrationOperationsPage(searchParams).result,
      () => administration.loadAdministrationOperation("operation-id"),
      () => discounts.loadDiscountAdminPageData(searchParams),
      () => discounts.loadDiscountAdminCodesPageData(searchParams),
      () => discounts.loadDiscountAdminSalesPageData(searchParams),
      () => discounts.loadDiscountAdminShellPageData(searchParams),
      () =>
        discounts.loadDiscountAdminCodePageData(
          "00000000-0000-0000-0000-000000000001",
          searchParams
        ),
      () =>
        discounts.loadDiscountAdminCustomerPageData(
          "customer-id",
          searchParams
        ),
      () =>
        discounts.loadDiscountAdminCustomerCodeCreationPageData("customer-id"),
      () =>
        discounts.loadOptionalDiscountAdminCustomerPageData(
          "customer-id",
          searchParams
        ),
      () => discounts.loadDiscountAdminCustomerBreadcrumbLabel("customer-id"),
      () => accounting.loadInvoiceAdministrationList(searchParams),
      () => accounting.loadInvoiceCreationPage(),
      () => accounting.loadInvoiceAdministrationDetail("invoice-id"),
      () => accounting.loadInvoiceAdministrationPdf("invoice-id"),
      () =>
        invoiceBreadcrumb.loadInvoiceAdministrationBreadcrumbLabel(
          "invoice-id"
        ),
      () => adminCli.loadCliAuthenticationApproval("code"),
      () => adminCli.loadCliSessions(),
      () => administrators.loadAdministrators(),
    ] as const;

    for (const operation of operations) {
      const error = await operation().then(
        () => null,
        (cause: unknown) => cause
      );

      expect(error).toHaveProperty("digest", "NEXT_HTTP_ERROR_FALLBACK;404");
    }
  });
});
