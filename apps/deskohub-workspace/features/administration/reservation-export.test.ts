import { describe, expect, test } from "bun:test";
import { getAdministrationReservationExportHref } from "./reservation-export";

describe("getAdministrationReservationExportHref", () => {
  test("carries the applied filters, sort, and direction", () => {
    const href = getAdministrationReservationExportHref({
      customerId: "dotypos-customer",
      direction: "asc",
      from: "2026-08-06",
      sort: "date",
      status: "complete",
      to: "2026-08-12",
      type: "cowork",
    });
    const url = new URL(href, "https://example.test");
    expect(url.pathname).toBe("/admin/reservations/export.csv");
    expect(url.searchParams.get("customerId")).toBe("dotypos-customer");
    expect(url.searchParams.get("from")).toBe("2026-08-06");
    expect(url.searchParams.get("to")).toBe("2026-08-12");
    expect(url.searchParams.get("status")).toBe("complete");
    expect(url.searchParams.get("type")).toBe("cowork");
    expect(url.searchParams.get("sort")).toBe("date");
    expect(url.searchParams.get("direction")).toBe("asc");
  });

  test("never carries a page parameter", () => {
    const href = getAdministrationReservationExportHref({
      direction: "desc",
      page: 3,
      sort: "created",
    } as never);
    expect(href).toBe(
      "/admin/reservations/export.csv?direction=desc&sort=created"
    );
    expect(href).not.toContain("page");
  });

  test("omits absent filters entirely", () => {
    expect(getAdministrationReservationExportHref({})).toBe(
      "/admin/reservations/export.csv"
    );
  });
});
