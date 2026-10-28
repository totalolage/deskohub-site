import { describe, expect, test } from "bun:test";
import { getSearchParamsRecord } from "@/shared/utils/search-params";
import { invoiceListQuery } from "./invoice-list-query";

const fromHref = (href: string) =>
  getSearchParamsRecord(
    new URL(href, "https://workspace.invalid").searchParams
  );

describe("invoiceListQuery", () => {
  test("leaves the order and page to the service by default", () => {
    expect(invoiceListQuery.parse({})).toEqual({});
  });

  test("reads the order and page", () => {
    expect(
      invoiceListQuery.parse({ direction: "asc", page: "3", sort: "total" })
    ).toEqual({ direction: "asc", page: 3, sort: "total" });
  });

  test("ignores invalid values", () => {
    for (const page of ["0", "-1", "1.5", "1e1", "two", ""]) {
      expect(invoiceListQuery.parse({ page })).toEqual({});
    }
    expect(
      invoiceListQuery.parse({ direction: "sideways", sort: "status" })
    ).toEqual({});
  });

  test("ignores a param the URL repeats", () => {
    expect(
      invoiceListQuery.parse(
        fromHref("/admin/invoices?sort=total&sort=source&direction=desc")
      )
    ).toEqual({ direction: "desc" });
    expect(
      invoiceListQuery.parse(
        fromHref("/admin/invoices?page=2&page=3&sort=total")
      )
    ).toEqual({ sort: "total" });
    expect(
      invoiceListQuery.parse({ direction: ["asc", "desc"], page: "2" })
    ).toEqual({ page: 2 });
  });

  test("links back to the same query, with the page only past the first", () => {
    const query = invoiceListQuery.parse({
      direction: "desc",
      page: "2",
      sort: "issuedAt",
    });

    expect(invoiceListQuery.href(query, { page: 2 })).toBe(
      "/admin/invoices?sort=issuedAt&direction=desc&page=2"
    );
    expect(
      invoiceListQuery.parse(
        fromHref(invoiceListQuery.href(query, { page: query.page }))
      )
    ).toEqual(query);
    expect(invoiceListQuery.href({}, { page: 1 })).toBe("/admin/invoices");
  });

  test("leaves the table unsorted without an order, and links headers to one", () => {
    expect(invoiceListQuery.tableSorting({}).sorting).toEqual([]);
    const { getSortHref, sorting } = invoiceListQuery.tableSorting(
      invoiceListQuery.parse({ page: "4", sort: "customer" })
    );

    expect(sorting).toEqual([{ desc: false, id: "customer" }]);
    expect(getSortHref("total", "desc")).toBe(
      "/admin/invoices?sort=total&direction=desc"
    );
  });
});
