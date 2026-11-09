import { describe, expect, test } from "bun:test";
import { screenPathPattern } from "./screen-path";

describe("screenPathPattern", () => {
  test("the root screen is /", () => {
    expect(screenPathPattern([])).toBe("/");
    expect(screenPathPattern(["index"])).toBe("/");
  });

  test("keeps dynamic segments as their pattern", () => {
    expect(
      screenPathPattern(["(account)", "reservations", "[orderId]", "access"])
    ).toBe("/reservations/[orderId]/access");
  });

  test("drops group and index segments", () => {
    expect(
      screenPathPattern(["(account)", "reservations", "[orderId]", "index"])
    ).toBe("/reservations/[orderId]");
    expect(screenPathPattern(["(account)", "account", "index"])).toBe(
      "/account"
    );
    expect(screenPathPattern(["(account)"])).toBe("/");
  });

  test("drops nested groups such as the tabs", () => {
    expect(
      screenPathPattern([
        "(account)",
        "(tabs)",
        "reservations",
        "[orderId]",
        "index",
      ])
    ).toBe("/reservations/[orderId]");
    expect(screenPathPattern(["(account)", "(tabs)", "account", "legal"])).toBe(
      "/account/legal"
    );
  });

  test("leaves ungrouped routes as they are", () => {
    expect(screenPathPattern(["auth", "callback"])).toBe("/auth/callback");
    expect(screenPathPattern(["sign-in"])).toBe("/sign-in");
  });
});
