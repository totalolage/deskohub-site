import { describe, expect, test } from "bun:test";
import {
  getAdministrationPagination,
  getReservationSearchPattern,
} from "./listing";

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

  test("treats SQL wildcard characters as literal reservation ID text", () => {
    expect(getReservationSearchPattern("reservation%_\\id")).toBe(
      "%reservation\\%\\_\\\\id%"
    );
  });
});
