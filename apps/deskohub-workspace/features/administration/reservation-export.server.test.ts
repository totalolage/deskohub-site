import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import {
  getAdministrationReservationExportCsv,
  loadAdministrationReservationExportFilters,
} from "./reservation-export.server";

const params = (search: string) => new URLSearchParams(search);

describe("loadAdministrationReservationExportFilters", () => {
  test("accepts valid narrowing filter combinations", () => {
    expect(
      loadAdministrationReservationExportFilters(
        params(
          "customerId=dotypos-customer&status=complete&type=cowork&from=2026-08-06&to=2026-08-12&sort=date&direction=asc"
        )
      )
    ).toEqual({
      ok: true,
      input: {
        customerId: "dotypos-customer",
        from: "2026-08-06",
        to: "2026-08-12",
        direction: "asc",
        sort: "date",
        status: "complete",
        type: "cowork",
      },
    });
    expect(
      loadAdministrationReservationExportFilters(params("date=2026-08-12"))
    ).toEqual({
      ok: true,
      input: {
        customerId: undefined,
        from: "2026-08-12",
        to: "2026-08-12",
        direction: "desc",
        sort: "created",
        status: undefined,
        type: undefined,
      },
    });
  });

  test("fails closed on a malformed customer identifier", () => {
    expect(
      loadAdministrationReservationExportFilters(params("customerId=%20"))
    ).toEqual({ ok: false, reason: "invalid-filter" });
  });

  test("fails closed on a malformed status", () => {
    expect(
      loadAdministrationReservationExportFilters(params("status=refunded"))
    ).toEqual({ ok: false, reason: "invalid-filter" });
  });

  test("fails closed on a malformed type", () => {
    expect(
      loadAdministrationReservationExportFilters(params("type=hot-desk"))
    ).toEqual({ ok: false, reason: "invalid-filter" });
  });

  test("fails closed on malformed date filters", () => {
    expect(
      loadAdministrationReservationExportFilters(params("from=08/06/2026"))
    ).toEqual({ ok: false, reason: "invalid-filter" });
    expect(
      loadAdministrationReservationExportFilters(params("date=yesterday"))
    ).toEqual({ ok: false, reason: "invalid-filter" });
    expect(
      loadAdministrationReservationExportFilters(
        params("from=2026-08-06&to=not-a-date")
      )
    ).toEqual({ ok: false, reason: "invalid-filter" });
  });

  test("treats sort and direction leniently like the page", () => {
    const result = loadAdministrationReservationExportFilters(
      params("sort=newest&direction=up")
    );
    expect(result).toEqual({
      ok: true,
      input: {
        customerId: undefined,
        direction: "desc",
        sort: "created",
        status: undefined,
        type: undefined,
      },
    });
  });

  test("ignores the page parameter entirely", () => {
    const result = loadAdministrationReservationExportFilters(
      params("page=7&status=cancelled")
    );
    expect(result).toEqual({
      ok: true,
      input: {
        customerId: undefined,
        direction: "desc",
        sort: "created",
        status: "cancelled",
        type: undefined,
      },
    });
    expect(JSON.stringify(result)).not.toContain("page");
  });
});

describe("getAdministrationReservationExportCsv", () => {
  const reservation = {
    createdAt: "2026-08-10T08:00:00Z",
    customer: { displayName: 'Doe, "Jane"' },
    date: "2026-08-12",
    id: "workspace-reservation-1",
    latestPayment: {
      amount: { currency: "EUR", exponent: 2, value: 1234 },
      stateLabel: "Paid",
    },
    startsAt: "2026-08-12T09:00:00Z",
    status: { label: "Complete" },
    type: "meeting-room",
    typeLabel: "Cowork Plus",
  } as never;

  test("renders the safe table columns with human labels", () => {
    const csv = getAdministrationReservationExportCsv([reservation]);
    const [header, row] = csv.split("\r\n");
    expect(header).toBe(
      "Reservation ID,Booking date,Status,Customer,Reservation type,Created,Payment"
    );
    expect(row?.startsWith("workspace-reservation-1,")).toBe(true);
    expect(row).toContain('"12 Aug 2026, 11:00"');
    expect(row).toContain('"Doe, ""Jane"""');
  });

  test("keeps payment security values and provider payloads out of the export", () => {
    const csv = getAdministrationReservationExportCsv([reservation]);
    expect(csv).not.toContain("providerOrderId");
    expect(csv).not.toContain("redirect");
    expect(csv).not.toContain("accessCode");
  });

  test("leaves the payment column empty when no payment exists", () => {
    const csv = getAdministrationReservationExportCsv([
      { ...reservation, latestPayment: null },
    ]);
    const row = csv.split("\r\n")[1];
    expect(row?.endsWith(",")).toBe(true);
  });
});
