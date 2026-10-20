import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runCommand } from "@/scripts/shared/command";
import { parseAdministrationCustomerListSearchParams } from "./page-data.server";

test("runs the overview request-sharing proof in an isolated RSC Bun process", async () => {
  const result = await runCommand(
    [
      process.execPath,
      "--conditions=react-server",
      "test",
      "--preload",
      "./shared/testing/workspace-test-env.ts",
      "--parallel=1",
      "--timeout",
      "30000",
      "./features/administration/page-data.server.rsc-fixture.ts",
    ],
    { cwd: fileURLToPath(new URL("../..", import.meta.url)) }
  );

  const output = `${result.stdout}${result.stderr}`;
  expect(result.exitCode).toBe(0);
  expect(output).toContain("3 pass");
  expect(output).toContain("RSC_PAGE_DATA_REQUEST_SHARING_PROOF");
});

describe("parseAdministrationCustomerListSearchParams", () => {
  test("defaults to every customer, newest activity first", () => {
    expect(parseAdministrationCustomerListSearchParams({})).toEqual({
      direction: "desc",
      marketingConsent: undefined,
      page: 1,
      sort: "activity",
    });
  });

  test("parses the reservation date range, consent filter, sort and page", () => {
    expect(
      parseAdministrationCustomerListSearchParams({
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
      parseAdministrationCustomerListSearchParams({
        from: "2026-10-31",
        to: "2026-10-01",
      })
    ).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    const onlyTo = parseAdministrationCustomerListSearchParams({
      to: "2026-10-31",
    });
    expect(onlyTo).toMatchObject({ to: "2026-10-31" });
    expect(onlyTo).not.toHaveProperty("from");
  });

  test("ignores invalid values", () => {
    const input = parseAdministrationCustomerListSearchParams({
      date: "2026-10-01",
      direction: "sideways",
      from: "2026-02-30",
      marketingConsent: "maybe",
      page: "-1",
      sort: "name",
      to: "tomorrow",
    });
    expect(input).toEqual({
      direction: "desc",
      marketingConsent: undefined,
      page: 1,
      sort: "activity",
    });
  });

  test("accepts every consent state", () => {
    for (const marketingConsent of ["granted", "withdrawn", "never"]) {
      expect(
        parseAdministrationCustomerListSearchParams({ marketingConsent })
          .marketingConsent
      ).toBe(marketingConsent);
    }
  });
});
