import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AdminCliReadApi,
  AdministrationBookingQuery,
  AdministrationCustomerQuery,
  AdministrationCustomerReservationsQuery,
  AdministrationCustomerSearchQuery,
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

describe("administration read contract", () => {
  test("keeps read operations safe and typed", () => {
    expect(AdminCliReadApi.endpoints.getOverview?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.listReservations?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.getReservation?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.findReservation?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.listBookings?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.getBooking?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.listOrders?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.getOrder?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.listOperations?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.getOperation?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.listCustomers?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.searchCustomers?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.getCustomer?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.listCustomerReservations?.method).toBe(
      "GET"
    );
    expect(AdminCliReadApi.endpoints.getDiscountDashboard?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.getDiscountCode?.method).toBe("GET");
    expect(AdminCliReadApi.endpoints.listSessions?.method).toBe("GET");
    expect(
      Schema.decodeUnknownSync(AdministrationReservationQuery)({
        page: 2,
        status: "complete",
      })
    ).toEqual({ page: 2, status: "complete" });
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
