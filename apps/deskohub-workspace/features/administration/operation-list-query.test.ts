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
import { operationListQuery } from "./operation-list-query";

beforeEach(() => setSystemTime(new Date("2026-08-11T10:00:00Z")));
afterEach(() => setSystemTime());

const fromHref = (href: string) =>
  getSearchParamsRecord(
    new URL(href, "https://workspace.invalid").searchParams
  );

describe("operationListQuery", () => {
  test("shows every operation of the last week", () => {
    expect(operationListQuery.parse({})).toEqual({
      channel: undefined,
      from: "2026-08-04",
      fromTime: "2026-08-03T22:00:00Z",
      operationType: undefined,
      to: "2026-08-11",
      toTime: "2026-08-11T22:00:00Z",
    });
  });

  test("reads provider filters case-insensitively and drops unknown ones", () => {
    expect(
      operationListQuery.parse({
        channel: " backoffice ",
        operationType: ["refund", "capture"],
      })
    ).toMatchObject({ channel: "BACKOFFICE", operationType: "REFUND" });
    expect(
      operationListQuery.parse({ channel: "phone", operationType: "" })
    ).toMatchObject({ channel: undefined, operationType: undefined });
  });

  test("keeps a range longer than a month, unlike orders", () => {
    expect(
      operationListQuery.parse({ from: "2026-08-01", to: "2026-05-01" })
    ).toMatchObject({ from: "2026-05-01", to: "2026-08-01" });
  });

  test("links back to the same query", () => {
    const query = operationListQuery.parse({
      channel: "ecommerce",
      from: "2026-07-01",
      operationType: "CAPTURE",
      to: "2026-07-08",
    });

    expect(operationListQuery.href(query)).toBe(
      "/admin/operations?channel=ECOMMERCE&from=2026-07-01&operationType=CAPTURE&to=2026-07-08"
    );
    expect(
      operationListQuery.parse(fromHref(operationListQuery.href(query)))
    ).toEqual(query);
  });

  test("fills the filter form from the query and accepts its values", () => {
    const values = operationListQuery.formValues(
      operationListQuery.parse({ channel: "POS" })
    );

    expect(values).toEqual({
      channel: "POS",
      from: "2026-08-04",
      operationType: "",
      to: "2026-08-11",
    });
    expect(operationListQuery.formSchema["~standard"].validate(values)).toEqual(
      { value: values }
    );
    expect(
      operationListQuery.formSchema["~standard"].validate({
        ...values,
        channel: "pos",
      })
    ).toHaveProperty("issues");
  });
});
