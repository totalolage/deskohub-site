import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import {
  formatPhoneNumber,
  getPhoneLink,
  normalizePhoneNumber,
} from "./phone-formatting";

describe("normalizePhoneNumber", () => {
  test("stores a Czech national number in E.164", () => {
    expect(normalizePhoneNumber(" 777 060 478 ")).toBe("+420777060478");
  });

  test("parses a national number for the given country", () => {
    expect(normalizePhoneNumber("(202) 555-0143", "US")).toBe("+12025550143");
  });

  test("keeps an international number that isn't valid for the given country", () => {
    expect(normalizePhoneNumber("+1 202 555 0143", "CZ")).toBe("+12025550143");
  });

  test("returns null for missing, blank, or invalid input", () => {
    expect(normalizePhoneNumber(null)).toBeNull();
    expect(normalizePhoneNumber(undefined)).toBeNull();
    expect(normalizePhoneNumber("")).toBeNull();
    expect(normalizePhoneNumber("   ")).toBeNull();
    expect(normalizePhoneNumber("+420 123")).toBeNull();
    expect(normalizePhoneNumber("not a phone")).toBeNull();
  });

  describe("when the input can't be read", () => {
    afterEach(() => mock.restore());

    test("warns and returns null", () => {
      const warn = spyOn(console, "warn").mockImplementation(() => undefined);
      const unreadable = {
        trim: () => {
          throw new Error("unreadable");
        },
      } as unknown as string;

      expect(normalizePhoneNumber(unreadable)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});

describe("formatPhoneNumber", () => {
  test("uses the national format for a number from the locale's country", () => {
    expect(formatPhoneNumber("+420777060478", "cs-CZ")).toBe("777 060 478");
  });

  test("uses the international format for a number from another country", () => {
    expect(formatPhoneNumber("+420777060478", "en-US")).toBe(
      "+420 777 060 478"
    );
  });

  test("reads the country from an underscore locale", () => {
    expect(formatPhoneNumber("+420777060478", "cs_cz")).toBe("777 060 478");
  });

  test("uses the international format when the locale names no two-letter country", () => {
    expect(formatPhoneNumber("+420777060478", "cs")).toBe("+420 777 060 478");
    expect(formatPhoneNumber("+420777060478", "es-419")).toBe(
      "+420 777 060 478"
    );
    expect(formatPhoneNumber("+420777060478", "!!")).toBe("+420 777 060 478");
    expect(formatPhoneNumber("+420777060478", "x_abc")).toBe(
      "+420 777 060 478"
    );
  });

  test("returns a number it can't parse unchanged", () => {
    expect(formatPhoneNumber("777060478", "cs-CZ")).toBe("777060478");
    expect(formatPhoneNumber("call us", "cs-CZ")).toBe("call us");
  });
});

describe("getPhoneLink", () => {
  test("keeps only digits and the plus sign", () => {
    expect(getPhoneLink("+420 777-060 (478)")).toBe("+420777060478");
  });
});
