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
import { bookingListQuery } from "./booking-list-query";

beforeEach(() => setSystemTime(new Date("2026-08-11T10:00:00Z")));
afterEach(() => setSystemTime());

const fromHref = (href: string) =>
  getSearchParamsRecord(
    new URL(href, "https://workspace.invalid").searchParams
  );

describe("bookingListQuery", () => {
  test("shows today's bookings in booking order", () => {
    expect(bookingListQuery.parse({})).toEqual({
      date: "2026-08-11",
      direction: "asc",
      page: 1,
      sort: "booking",
    });
  });

  test("reads the day, order and page", () => {
    expect(
      bookingListQuery.parse({
        date: ["2026-08-14", "2026-08-15"],
        direction: "desc",
        page: "2",
        sort: "status",
      })
    ).toEqual({
      date: "2026-08-14",
      direction: "desc",
      page: 2,
      sort: "status",
    });
  });

  test("ignores invalid values", () => {
    expect(
      bookingListQuery.parse({
        date: "2026-02-30",
        direction: "sideways",
        page: "0",
        sort: "table",
      })
    ).toEqual({
      date: "2026-08-11",
      direction: "asc",
      page: 1,
      sort: "booking",
    });
  });

  test("links back to the same query, with the page only past the first", () => {
    const query = bookingListQuery.parse({
      date: "2026-08-14",
      direction: "desc",
      page: "2",
      sort: "status",
    });

    expect(bookingListQuery.href(query, { page: 2 })).toBe(
      "/admin/bookings?date=2026-08-14&direction=desc&sort=status&page=2"
    );
    expect(
      bookingListQuery.parse(
        fromHref(bookingListQuery.href(query, { page: query.page }))
      )
    ).toEqual(query);
  });

  test("sorts the table by the list's order and keeps the day first in header links", () => {
    const { getSortHref, sorting } = bookingListQuery.tableSorting(
      bookingListQuery.parse({ date: "2026-08-14" })
    );

    expect(sorting).toEqual([{ desc: false, id: "booking" }]);
    expect(getSortHref("status", "asc")).toBe(
      "/admin/bookings?date=2026-08-14&sort=status&direction=asc"
    );
  });

  test("fills the filter form from the query and accepts its values", () => {
    const values = bookingListQuery.formValues(bookingListQuery.parse({}));

    expect(values).toEqual({
      date: "2026-08-11",
      direction: "asc",
      sort: "booking",
    });
    expect(bookingListQuery.formSchema["~standard"].validate(values)).toEqual({
      value: values,
    });
    expect(
      bookingListQuery.formSchema["~standard"].validate({ ...values, date: "" })
    ).toHaveProperty("issues");
  });
});
