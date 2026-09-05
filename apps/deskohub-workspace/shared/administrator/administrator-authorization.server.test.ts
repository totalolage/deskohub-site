import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Exit } from "effect";

let requestHeaders = new Headers();

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
}));

const toAuthorization = (username: string, password: string) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

const loadAuthorization = async () =>
  await import("./administrator-authorization.server").then(
    ({ requireAdministratorAuthorization }) =>
      requireAdministratorAuthorization()
  );

describe("administrator server authorization", () => {
  test("authorizes every configured administrator independently at the operation boundary", async () => {
    for (const [username, password] of [
      ["admin", "test-password"],
      ["operator", "operator-test-password"],
    ] as const) {
      requestHeaders = new Headers({
        authorization: toAuthorization(username, password),
      });

      const exit = await Effect.runPromiseExit(await loadAuthorization());

      expect(Exit.isSuccess(exit)).toBe(true);
      if (Exit.isSuccess(exit)) expect(exit.value).toBe(username);
    }
  });

  test("rejects direct operation calls with wrong, crossed, or malformed credentials", async () => {
    for (const authorization of [
      undefined,
      "Basic malformed",
      toAuthorization("admin", "operator-test-password"),
      toAuthorization("operator", "test-password"),
      toAuthorization("admin", "wrong-password"),
      toAuthorization("unknown", "test-password"),
    ]) {
      requestHeaders = new Headers(
        authorization ? { authorization } : undefined
      );

      const exit = await Effect.runPromiseExit(await loadAuthorization());

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause.toString()).toContain(
          "AdministratorUnauthorizedError"
        );
      }
    }
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

    expect(mutation).toHaveProperty("serverError");
    expect(mutation).not.toHaveProperty("data");
    expect(search).toHaveProperty("serverError");
    expect(search).not.toHaveProperty("data");
    expect(reservation).toHaveProperty("serverError");
    expect(reservation).not.toHaveProperty("data");
  });

  test("rejects direct invocations of the shared administrator page gate", async () => {
    requestHeaders = new Headers();
    const { authorizeAdministratorPage } = await import(
      "./administrator-authorization.server"
    );

    const error = await authorizeAdministratorPage().then(
      () => null,
      (cause: unknown) => cause
    );

    expect(error).toHaveProperty("digest", "NEXT_HTTP_ERROR_FALLBACK;404");
  });

  test("rejects direct invocations of every exported admin page-data loader", async () => {
    requestHeaders = new Headers();
    const authorization = await import("./administrator-authorization.server");
    const adminCli = await import("@/features/admin-cli/page-data.server");
    const administration = await import(
      "@/features/administration/page-data.server"
    );
    const discounts = await import(
      "@/features/discounts/admin/page-data.server"
    );
    const searchParams = Promise.resolve({});
    const operations = [
      authorization.authorizeAdministratorPage,
      administration.authorizeAdministrationPage,
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
      () => adminCli.loadCliAuthenticationApproval("attacker-controlled-code"),
      () => adminCli.loadCliSessions(),
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
