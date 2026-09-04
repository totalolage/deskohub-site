import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Exit } from "effect";

let requestHeaders = new Headers();

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
}));
mock.module("next/server", () => ({
  after: () => {},
  connection: () => Promise.resolve(),
}));

const loadAuthorization = async () =>
  await import("./basic-auth.server").then(
    ({ requireAdministrationAuthorization }) =>
      requireAdministrationAuthorization()
  );

describe("administration server authorization", () => {
  test("authorizes the configured Basic credentials at the operation boundary", async () => {
    requestHeaders = new Headers({
      authorization: `Basic ${Buffer.from("admin:test-password").toString("base64")}`,
    });

    const exit = await Effect.runPromiseExit(await loadAuthorization());

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value).toBe("admin");
  });

  test("rejects direct operation calls without valid Basic credentials", async () => {
    for (const authorization of [
      undefined,
      "Basic malformed",
      `Basic ${Buffer.from("admin:wrong-password").toString("base64")}`,
    ]) {
      requestHeaders = new Headers(
        authorization ? { authorization } : undefined
      );

      const exit = await Effect.runPromiseExit(await loadAuthorization());

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain(
          "AdministrationUnauthorizedError"
        );
      }
    }
  });

  test("rejects direct invocations of every exported admin action", async () => {
    requestHeaders = new Headers({
      referer: "https://deskohub.test/admin/discounts",
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

    expect(mutation).toHaveProperty("serverError");
    expect(mutation).not.toHaveProperty("data");
    expect(search).toHaveProperty("serverError");
    expect(search).not.toHaveProperty("data");
    expect(reservation).toHaveProperty("serverError");
    expect(reservation).not.toHaveProperty("data");
  });

  test("rejects direct invocations of every exported admin page-data loader", async () => {
    requestHeaders = new Headers();
    const pageAuthorization = await import(
      "@/features/administration/page-authorization.server"
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
      pageAuthorization.authorizeAdministrationPage,
      administration.loadAdministrationOverview,
      () => administration.loadAdministrationReservations(searchParams),
      () =>
        administration.loadAdministrationReservationsPage(searchParams).result,
      () => administration.loadAdministrationReservation("reservation-id"),
      () =>
        administration.loadAdministrationReservationBreadcrumbLabel(
          "reservation-id"
        ),
      () => administration.loadAdministrationBookings(searchParams),
      () => administration.loadAdministrationBookingsPage(searchParams).result,
      () => administration.loadAdministrationBooking("booking-id"),
      () =>
        administration.loadAdministrationBookingBreadcrumbLabel("booking-id"),
      () => administration.loadAdministrationCustomers(searchParams),
      () =>
        administration.loadAdministrationCustomerReservations(
          "customer-id",
          searchParams
        ),
      () => administration.loadAdministrationOrders(searchParams),
      () => administration.loadAdministrationOrdersPage(searchParams).result,
      () => administration.loadAdministrationOperations(searchParams),
      () =>
        administration.loadAdministrationOperationsPage(searchParams).result,
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
