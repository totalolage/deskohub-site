import "@/shared/testing/workspace-test-env";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import { getSearchParamsRecord } from "@/shared/utils/search-params";
import {
  parseAdministrationReservationExportSearchParams,
  parseAdministrationReservationListSearchParams,
} from "./page-data.server";

beforeEach(() => setSystemTime(new Date("2026-08-11T10:00:00Z")));
afterEach(() => setSystemTime());

// Next.js hands a page repeated keys as arrays; the export route reads the
// request URL. Both must reach the same list input.
const fromUrl = (query: string) =>
  getSearchParamsRecord(new URLSearchParams(query));

describe("reservation list search params", () => {
  test("gives the export the page's filters and order without the page", () => {
    const query =
      "customerId=dotypos-customer-1&status=complete&status=cancelled&type=office&sort=date&direction=asc&from=2026-08-31&to=2026-08-01&page=3";
    const page = parseAdministrationReservationListSearchParams({
      customerId: "dotypos-customer-1",
      direction: "asc",
      from: "2026-08-31",
      page: "3",
      sort: "date",
      status: ["complete", "cancelled"],
      to: "2026-08-01",
      type: "office",
    });

    expect(page).toEqual({
      customerId: "dotypos-customer-1",
      direction: "asc",
      from: "2026-08-01",
      page: 3,
      sort: "date",
      status: "complete",
      to: "2026-08-31",
      type: "office",
    });
    const { page: _, ...withoutPage } = page;
    expect(
      parseAdministrationReservationExportSearchParams(fromUrl(query))
    ).toEqual(withoutPage);
  });

  test("gives both the default date range from January 1 of the Workspace year", () => {
    expect(parseAdministrationReservationListSearchParams({})).toMatchObject({
      direction: "desc",
      from: "2026-01-01",
      page: 1,
      sort: "created",
    });
    expect(
      parseAdministrationReservationExportSearchParams(fromUrl(""))
    ).toEqual({
      customerId: undefined,
      direction: "desc",
      from: "2026-01-01",
      sort: "created",
      status: undefined,
      type: undefined,
    });
  });

  test("keeps a customer's complete history without a default range", () => {
    expect(
      parseAdministrationReservationExportSearchParams(
        fromUrl("customerId=dotypos-customer-1")
      )
    ).not.toHaveProperty("from");
  });
});
