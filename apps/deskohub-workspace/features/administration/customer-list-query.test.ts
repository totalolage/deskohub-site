import { describe, expect, test } from "bun:test";
import { getSearchParamsRecord } from "@/shared/utils/search-params";
import { customerListQuery } from "./customer-list-query";

const fromHref = (href: string) =>
  getSearchParamsRecord(
    new URL(href, "https://workspace.invalid").searchParams
  );

describe("customerListQuery", () => {
  test("defaults to every customer, newest activity first", () => {
    expect(customerListQuery.parse({})).toEqual({
      direction: "desc",
      page: 1,
      sort: "activity",
    });
  });

  test("reads the reservation date range, consent filter, order and page", () => {
    expect(
      customerListQuery.parse({
        direction: "asc",
        from: "2026-10-01",
        marketingConsent: "withdrawn",
        page: "2",
        sort: "reservations",
        to: ["2026-10-31", "2026-11-30"],
      })
    ).toEqual({
      direction: "asc",
      from: "2026-10-01",
      marketingConsent: "withdrawn",
      page: 2,
      sort: "reservations",
      to: "2026-10-31",
    });
  });

  test("normalizes reversed bounds and keeps a one-sided range", () => {
    expect(
      customerListQuery.parse({ from: "2026-10-31", to: "2026-10-01" })
    ).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    const onlyTo = customerListQuery.parse({ to: "2026-10-31" });
    expect(onlyTo).toMatchObject({ to: "2026-10-31" });
    expect(onlyTo).not.toHaveProperty("from");
  });

  test("ignores invalid values", () => {
    expect(
      customerListQuery.parse({
        date: "2026-10-01",
        direction: "sideways",
        from: "2026-02-30",
        marketingConsent: "maybe",
        page: "-1",
        sort: "name",
        to: "tomorrow",
      })
    ).toEqual({ direction: "desc", page: 1, sort: "activity" });
  });

  test("accepts every current consent state", () => {
    for (const marketingConsent of ["active", "withdrawn", "absent"]) {
      expect(
        customerListQuery.parse({ marketingConsent }).marketingConsent
      ).toBe(marketingConsent);
    }
  });

  test("maps legacy consent filters to the current state in generated links", () => {
    for (const [legacy, current] of [
      ["granted", "active"],
      ["never", "absent"],
    ] as const) {
      const query = customerListQuery.parse(
        fromHref(`/admin/customers?marketingConsent=${legacy}`)
      );
      expect(query.marketingConsent).toBe(current);
      expect(customerListQuery.href(query)).toContain(
        `marketingConsent=${current}`
      );
    }
  });

  test("links back to the same query, with the page only past the first", () => {
    const query = customerListQuery.parse({
      direction: "asc",
      from: "2026-10-01",
      marketingConsent: "active",
      page: "4",
      sort: "reservations",
      to: "2026-10-31",
    });

    expect(customerListQuery.href(query, { page: 4 })).toBe(
      "/admin/customers?direction=asc&from=2026-10-01&marketingConsent=active&sort=reservations&to=2026-10-31&page=4"
    );
    expect(
      customerListQuery.parse(
        fromHref(customerListQuery.href(query, { page: query.page }))
      )
    ).toEqual(query);

    const defaults = customerListQuery.parse({});
    expect(customerListQuery.href(defaults)).toBe(
      "/admin/customers?direction=desc&sort=activity"
    );
    expect(
      customerListQuery.parse(fromHref(customerListQuery.href(defaults)))
    ).toEqual(defaults);
  });

  test("exports the list's filters and order without the page", () => {
    const query = customerListQuery.parse({
      marketingConsent: "absent",
      page: "3",
    });
    const href = customerListQuery.exportHref(query);

    expect(href).toBe(
      "/admin/customers/export?direction=desc&marketingConsent=absent&sort=activity"
    );
    const { page: _, ...withoutPage } = query;
    expect(customerListQuery.parseExport(fromHref(href))).toEqual(withoutPage);
  });

  test("sorts the table by the list's order and links each header to a new one", () => {
    const { getSortHref, sorting } = customerListQuery.tableSorting(
      customerListQuery.parse({ marketingConsent: "active" })
    );

    expect(sorting).toEqual([{ desc: true, id: "activity" }]);
    expect(getSortHref("reservations", "asc")).toBe(
      "/admin/customers?direction=asc&marketingConsent=active&sort=reservations"
    );
  });

  test("fills the filter form from the query and accepts its values", () => {
    const values = customerListQuery.formValues(
      customerListQuery.parse({ from: "2026-10-01" })
    );

    expect(values).toEqual({
      direction: "desc",
      from: "2026-10-01",
      marketingConsent: "",
      sort: "activity",
      to: "",
    });
    expect(customerListQuery.formSchema["~standard"].validate(values)).toEqual({
      value: values,
    });
  });
});
