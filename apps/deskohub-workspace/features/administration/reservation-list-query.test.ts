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
import { reservationListQuery } from "./reservation-list-query";

beforeEach(() => setSystemTime(new Date("2026-08-11T10:00:00Z")));
afterEach(() => setSystemTime());

// Next.js hands a page repeated keys as arrays; links and the export route
// read a URL. Both must reach the same query.
const fromHref = (href: string) =>
  getSearchParamsRecord(
    new URL(href, "https://workspace.invalid").searchParams
  );

describe("reservationListQuery", () => {
  test("reads filters, order and page, keeping the first of repeated values", () => {
    expect(
      reservationListQuery.parse({
        customerId: "dotypos-customer-1",
        direction: "asc",
        from: "2026-08-31",
        page: "3",
        sort: "date",
        status: ["complete", "cancelled"],
        to: "2026-08-01",
        type: "office",
      })
    ).toEqual({
      customerId: "dotypos-customer-1" as never,
      direction: "asc",
      from: "2026-08-01",
      page: 3,
      sort: "date",
      status: "complete",
      to: "2026-08-31",
      type: "office",
    });
  });

  test("starts the list on January 1 of the Workspace year, newest first", () => {
    expect(reservationListQuery.parse({})).toEqual({
      direction: "desc",
      from: "2026-01-01",
      page: 1,
      sort: "created",
    });
  });

  test("keeps a customer's complete history and the whole refund queue", () => {
    expect(
      reservationListQuery.parse({ customerId: "dotypos-customer-1" })
    ).not.toHaveProperty("from");
    expect(
      reservationListQuery.parse({ status: "needs_refund" })
    ).not.toHaveProperty("from");
  });

  test("reads the legacy single date as a one-day range", () => {
    expect(reservationListQuery.parse({ date: "2026-03-04" })).toMatchObject({
      from: "2026-03-04",
      to: "2026-03-04",
    });
  });

  test("ignores invalid values", () => {
    expect(
      reservationListQuery.parse({
        customerId: " ",
        direction: "sideways",
        from: "2026-02-30",
        page: "-1",
        sort: "name",
        status: "attention",
        type: "desk",
      })
    ).toEqual({
      direction: "desc",
      from: "2026-01-01",
      page: 1,
      sort: "created",
    });
  });

  test("links back to the same query, with the page only past the first", () => {
    const query = reservationListQuery.parse({
      customerId: "dotypos-customer-1",
      direction: "asc",
      from: "2026-08-01",
      page: "3",
      sort: "date",
      status: "complete",
      to: "2026-08-31",
      type: "office",
    });

    expect(reservationListQuery.href(query, { page: 3 })).toBe(
      "/admin/reservations?customerId=dotypos-customer-1&direction=asc&from=2026-08-01&sort=date&status=complete&to=2026-08-31&type=office&page=3"
    );
    expect(
      reservationListQuery.parse(
        fromHref(reservationListQuery.href(query, { page: query.page }))
      )
    ).toEqual(query);
    expect(reservationListQuery.href(query, { page: 1 })).toBe(
      reservationListQuery.href(query)
    );

    const defaults = reservationListQuery.parse({});
    expect(reservationListQuery.href(defaults)).toBe(
      "/admin/reservations?direction=desc&from=2026-01-01&sort=created"
    );
    expect(
      reservationListQuery.parse(fromHref(reservationListQuery.href(defaults)))
    ).toEqual(defaults);
  });

  test("exports the list's filters and order without the page", () => {
    const query = reservationListQuery.parse({
      page: "2",
      status: "cancelled",
      to: "2026-08-31",
    });
    const href = reservationListQuery.exportHref(query);

    expect(href).toBe(
      "/admin/reservations/export?direction=desc&sort=created&status=cancelled&to=2026-08-31"
    );
    const { page: _, ...withoutPage } = query;
    expect(reservationListQuery.parseExport(fromHref(href))).toEqual(
      withoutPage
    );
    expect(
      reservationListQuery.parseExport(
        fromHref(reservationListQuery.href(query, { page: 2 }))
      )
    ).toEqual(withoutPage);
  });

  test("sorts the table by the list's order and links each header to a new one", () => {
    const query = reservationListQuery.parse({
      page: "2",
      status: "complete",
    });
    const { getSortHref, sorting } = reservationListQuery.tableSorting(query);

    expect(sorting).toEqual([{ desc: true, id: "created" }]);
    expect(getSortHref("date", "asc")).toBe(
      "/admin/reservations?direction=asc&from=2026-01-01&sort=date&status=complete"
    );
  });

  test("fills the filter form from the query and accepts its values", () => {
    const query = reservationListQuery.parse({
      customerId: "dotypos-customer-1",
      status: "needs_refund",
    });
    const values = reservationListQuery.formValues(query);

    expect(values).toEqual({
      customerId: "dotypos-customer-1",
      direction: "desc",
      from: "",
      sort: "created",
      status: "needs_refund",
      to: "",
      type: "",
    });
    expect(
      reservationListQuery.formSchema["~standard"].validate(values)
    ).toEqual({ value: values });
    expect(
      reservationListQuery.formSchema["~standard"].validate({
        ...values,
        from: "2026-02-30",
      })
    ).toHaveProperty("issues");
  });
});
