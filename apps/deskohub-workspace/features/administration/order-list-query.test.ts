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
import { orderListQuery } from "./order-list-query";

beforeEach(() => setSystemTime(new Date("2026-08-11T10:00:00Z")));
afterEach(() => setSystemTime());

const fromHref = (href: string) =>
  getSearchParamsRecord(
    new URL(href, "https://workspace.invalid").searchParams
  );

describe("orderListQuery", () => {
  test("shows the last week in Nexi's Prague day bounds", () => {
    expect(orderListQuery.parse({})).toEqual({
      from: "2026-08-04",
      fromTime: "2026-08-03T22:00:00Z",
      to: "2026-08-11",
      toTime: "2026-08-11T22:00:00Z",
    });
  });

  test("orders reversed dates and caps the range at one month", () => {
    expect(
      orderListQuery.parse({ from: "2026-07-31", to: ["2026-05-01", "x"] })
    ).toMatchObject({ from: "2026-05-01", to: "2026-05-31" });
  });

  test("ignores invalid dates", () => {
    expect(orderListQuery.parse({ from: "2026-02-30", to: "soon" })).toEqual(
      orderListQuery.parse({})
    );
  });

  test("links back to the same range", () => {
    const query = orderListQuery.parse({
      from: "2026-07-01",
      to: "2026-07-08",
    });

    expect(orderListQuery.href(query)).toBe(
      "/admin/orders?from=2026-07-01&to=2026-07-08"
    );
    expect(orderListQuery.parse(fromHref(orderListQuery.href(query)))).toEqual(
      query
    );
  });

  test("fills the filter form from the query and accepts its values", () => {
    const values = orderListQuery.formValues(orderListQuery.parse({}));

    expect(values).toEqual({ from: "2026-08-04", to: "2026-08-11" });
    expect(orderListQuery.formSchema["~standard"].validate(values)).toEqual({
      value: values,
    });
    expect(
      orderListQuery.formSchema["~standard"].validate({ from: "", to: "" })
    ).toEqual({ value: { from: "", to: "" } });
  });
});
