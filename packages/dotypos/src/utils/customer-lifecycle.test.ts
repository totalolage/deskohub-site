import { describe, expect, test } from "bun:test";
import { customerLifecycle } from "./customer-lifecycle";

const now = new Date("2026-11-04T12:00:00.000Z");

describe("customerLifecycle", () => {
  test.each([
    [{ deleted: false }, "active"],
    [{ deleted: false, expireDate: null }, "active"],
    [{ deleted: false, expireDate: "2026-11-04T12:00:00.001Z" }, "active"],
    [{ deleted: false, expireDate: "2026-11-04T12:00:00.000Z" }, "expired"],
    [{ deleted: false, expireDate: "2026-11-03T12:00:00.000Z" }, "expired"],
    [{ deleted: false, expireDate: "not a date" }, "active"],
    [{ deleted: true, expireDate: null }, "deleted"],
    [{ deleted: true, expireDate: "2026-11-03T12:00:00.000Z" }, "deleted"],
  ] as const)("classifies %o as %p", (customer, expected) => {
    expect(customerLifecycle(customer, now)).toBe(expected);
  });

  test("lets the same record expire as time passes", () => {
    const customer = { deleted: false, expireDate: "2026-11-05T00:00:00Z" };

    expect(customerLifecycle(customer, now)).toBe("active");
    expect(customerLifecycle(customer, new Date("2026-11-05T00:00:00Z"))).toBe(
      "expired"
    );
  });
});
