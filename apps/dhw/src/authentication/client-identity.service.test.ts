import { describe, expect, test } from "bun:test";
import { makeDefaultClientName } from "./client-identity.service";

describe("makeDefaultClientName", () => {
  test("identifies the CLI by machine name", () => {
    expect(makeDefaultClientName("office-mac.local")).toBe(
      "dhw on office-mac.local"
    );
  });

  test("fits the API client-name boundary", () => {
    expect(makeDefaultClientName("a".repeat(100))).toHaveLength(80);
  });

  test("falls back when the machine name is unavailable", () => {
    expect(makeDefaultClientName("   ")).toMatch(/^dhw /);
  });
});
