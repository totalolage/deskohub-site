import { describe, expect, test } from "bun:test";
import { loadFixtureReservations } from "./fixtures";
import {
  getAdministrationExternalOrderPageIds,
  getAdministrationPagination,
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

  test("filters reservations by the selected customer search result", () => {
    expect(loadFixtureReservations({ customerId: "customer-alex" }).total).toBe(
      2
    );
  });

  test("paginates provider ordering with unavailable references last", () => {
    expect(
      getAdministrationExternalOrderPageIds({
        offset: 1,
        orderedExternalIds: ["provider-c", "provider-a", "provider-b"],
        pageSize: 3,
        references: [
          { externalId: "provider-a", id: "workspace-a" },
          { externalId: "provider-b", id: "workspace-b" },
          { externalId: "provider-c", id: "workspace-c" },
          { externalId: null, id: "workspace-missing-b" },
          { externalId: "provider-missing", id: "workspace-missing-a" },
        ],
      })
    ).toEqual(["workspace-a", "workspace-b", "workspace-missing-a"]);
  });
});
