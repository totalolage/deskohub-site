import { describe, expect, test } from "bun:test";
import { loadFixtureReservations } from "./fixtures";
import { getAdministrationPagination } from "./listing";

describe("administration listings", () => {
  test("clamps a stale requested page to the available range", () => {
    expect(
      getAdministrationPagination({
        pageSize: 24,
        requestedPage: 999,
        total: 50,
      })
    ).toEqual({ offset: 48, page: 3, pageCount: 3 });
    expect(
      getAdministrationPagination({
        pageSize: 24,
        requestedPage: 999,
        total: 0,
      })
    ).toEqual({ offset: 0, page: 1, pageCount: 1 });
  });

  test("filters reservations by the selected customer search result", () => {
    expect(loadFixtureReservations({ customerId: "customer-alex" }).total).toBe(
      2
    );
  });
});
