import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AdminCliAdministrationApi,
  AdministrationBookingQuery,
  AdministrationCustomerQuery,
  AdministrationCustomerReservationsQuery,
  AdministrationCustomerSearchQuery,
  AdministrationDiscountMutation,
  AdministrationOperationQuery,
  AdministrationOrderQuery,
  AdministrationReservationLookupQuery,
  AdministrationReservationQuery,
  CliClientName,
  StartCliAuthentication,
} from "./workspace-admin-api";

describe("CliClientName", () => {
  test("trims a client label", () => {
    expect(Schema.decodeUnknownSync(CliClientName)("  Office Mac  ")).toBe(
      "Office Mac"
    );
  });

  test("rejects a client label longer than 80 characters", () => {
    expect(() =>
      Schema.decodeUnknownSync(CliClientName)("a".repeat(81))
    ).toThrow();
  });
});

describe("StartCliAuthentication", () => {
  test("rejects a whitespace-only client name", () => {
    expect(() =>
      Schema.decodeUnknownSync(StartCliAuthentication)({
        challenge: "a".repeat(43),
        clientName: "   ",
        cliVersion: "1.0.0",
        buildTarget: "development",
      })
    ).toThrow();
  });
});

describe("administration contract", () => {
  test("keeps read operations safe and typed", () => {
    expect(AdminCliAdministrationApi.endpoints.getOverview?.method).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.listReservations?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.getReservation?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.findReservation?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.listBookings?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.getBooking?.method).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.listOrders?.method).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.getOrder?.method).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.listOperations?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.getOperation?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.listCustomers?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.searchCustomers?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.getCustomer?.method).toBe("GET");
    expect(
      AdminCliAdministrationApi.endpoints.listCustomerReservations?.method
    ).toBe("GET");
    expect(
      AdminCliAdministrationApi.endpoints.getDiscountDashboard?.method
    ).toBe("GET");
    expect(AdminCliAdministrationApi.endpoints.getDiscountCode?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.listSessions?.method).toBe(
      "GET"
    );
    expect(AdminCliAdministrationApi.endpoints.mutateDiscounts?.method).toBe(
      "POST"
    );
    expect(AdminCliAdministrationApi.endpoints.renameSession?.method).toBe(
      "PATCH"
    );
    expect(AdminCliAdministrationApi.endpoints.revokeSession?.method).toBe(
      "DELETE"
    );
    expect(
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        page: 2,
        status: "complete",
      })
    ).toEqual({ page: 2, status: "complete" });
  });

  test("validates discount mutations at the shared HTTP boundary", () => {
    const discountId = "01980000-0000-7000-8000-000000000001";
    const decode = Schema.decodeUnknownSync(AdministrationDiscountMutation);

    expect(
      decode({
        kind: "create-discount",
        discount: {
          labels: { "cs-CZ": "Léto", "en-US": "Summer" },
          adjustment: { kind: "percentage", basisPoints: 1500 },
          products: [{ kind: "cowork", tier: "plus" }],
        },
      })
    ).toEqual({
      kind: "create-discount",
      discount: {
        labels: { "cs-CZ": "Léto", "en-US": "Summer" },
        adjustment: { kind: "percentage", basisPoints: 1500 },
        products: [{ kind: "cowork", tier: "plus" }],
      },
    });

    expect(() =>
      decode({
        kind: "update-discount",
        discount: {
          id: discountId,
          labels: { "cs-CZ": "Léto", "en-US": "Summer" },
          adjustment: {
            kind: "fixed",
            amount: { value: 1000, exponent: 0, currency: "CZK" },
          },
          products: [
            { kind: "cowork", tier: "plus" },
            { kind: "cowork", tier: "plus" },
          ],
        },
      })
    ).toThrow();

    expect(() =>
      decode({
        kind: "create-discount",
        discount: {
          labels: {
            "cs-CZ": "Léto",
            "en-US": "Summer",
            "de-DE": "Sommer",
          },
          adjustment: { kind: "percentage", basisPoints: 1500 },
          products: [{ kind: "cowork", tier: "plus" }],
        },
      })
    ).toThrow();

    expect(() =>
      decode({
        kind: "create-code",
        code: {
          code: "SUMMER10",
          enabled: true,
          validFrom: "2026-08-11T00:00:00Z",
          validUntil: "2026-08-10T00:00:00Z",
          maxUses: null,
        },
        discount: { kind: "existing", discountId },
      })
    ).toThrow();
  });

  test("rejects invalid reservation filters before service execution", () => {
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationQuery)({ page: 0 })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        date: "10-08-2026",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        date: "2026-13-01",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationReservationLookupQuery)({
        identifier: "   ",
      })
    ).toThrow();
  });

  test("validates customer list and search queries", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationCustomerQuery)({ page: 3 })
    ).toEqual({ page: 3 });
    expect(
      Schema.decodeUnknownSync(AdministrationCustomerSearchQuery)({
        query: "  Ada  ",
      })
    ).toEqual({ query: "Ada" });
    expect(() =>
      Schema.decodeUnknownSync(AdministrationCustomerQuery)({ page: 0 })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationCustomerSearchQuery)({
        query: "A",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationCustomerSearchQuery)({
        query: "Ada;drop",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationCustomerReservationsQuery)({
        page: 0,
      })
    ).toThrow();
  });

  test("validates booking filters", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationBookingQuery)({
        date: "2026-08-10",
        page: 2,
      })
    ).toEqual({ date: "2026-08-10", page: 2 });
    expect(() =>
      Schema.decodeUnknownSync(AdministrationBookingQuery)({
        date: "10-08-2026",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationBookingQuery)({
        date: "2026-02-30",
      })
    ).toThrow();
  });

  test("validates payment date filters", () => {
    expect(
      Schema.decodeUnknownSync(AdministrationOrderQuery)({
        from: "2024-02-29",
        to: "2026-08-10",
      })
    ).toEqual({ from: "2024-02-29", to: "2026-08-10" });
    expect(
      Schema.decodeUnknownSync(AdministrationOperationQuery)({
        channel: "ECOMMERCE",
        operationType: "CAPTURE",
      })
    ).toEqual({ channel: "ECOMMERCE", operationType: "CAPTURE" });
    expect(() =>
      Schema.decodeUnknownSync(AdministrationOrderQuery)({ from: "tomorrow" })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AdministrationOrderQuery)({
        from: "2026-02-29",
      })
    ).toThrow();
  });
});
