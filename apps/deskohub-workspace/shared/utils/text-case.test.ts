import { describe, expect, test } from "bun:test";
import { upperCaseFirst } from "./text-case";

describe("upperCaseFirst", () => {
  test("upper-cases only the first character", () => {
    expect(upperCaseFirst("every Monday at 10:00", "en-US")).toBe(
      "Every Monday at 10:00"
    );
    expect(upperCaseFirst("čtvrtek", "cs-CZ")).toBe("Čtvrtek");
  });

  test("leaves text without a cased first character unchanged", () => {
    expect(upperCaseFirst("2. úterý", "cs-CZ")).toBe("2. úterý");
    expect(upperCaseFirst("", "en-US")).toBe("");
  });
});
