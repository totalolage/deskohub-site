import { describe, expect, test } from "bun:test";
import { formatNamesWithNumericRanges } from "./number";

describe("formatNamesWithNumericRanges", () => {
  test("formats the required table-name example", () => {
    expect(
      formatNamesWithNumericRanges([
        "12",
        "10",
        "9",
        "11",
        "16",
        "15",
        "wallee",
        "gromice",
      ])
    ).toBe("9-12, 15, 16, wallee, gromice");
  });

  test("sorts numeric names regardless of their input order", () => {
    expect(formatNamesWithNumericRanges(["12", "2", "11", "4"])).toBe(
      "2, 4, 11, 12"
    );
  });

  test("compresses runs of three but leaves one- and two-item runs separate", () => {
    expect(formatNamesWithNumericRanges(["8"])).toBe("8");
    expect(formatNamesWithNumericRanges(["5", "4"])).toBe("4, 5");
    expect(formatNamesWithNumericRanges(["3", "1", "2"])).toBe("1-3");
  });

  test("deduplicates trimmed numeric and ordinary names", () => {
    expect(
      formatNamesWithNumericRanges([" 3 ", "2", "1", "3", " cafe ", "cafe"])
    ).toBe("1-3, cafe");
  });

  test("omits missing and blank names", () => {
    expect(
      formatNamesWithNumericRanges([undefined, "", "  ", null, " name "])
    ).toBe("name");
    expect(formatNamesWithNumericRanges([undefined, " "])).toBe("");
  });

  test("recognizes zero as a canonical numeric name", () => {
    expect(formatNamesWithNumericRanges(["2", "0", "1"])).toBe("0-2");
  });

  test("keeps noncanonical and unsafe numeric-looking names in input order", () => {
    expect(
      formatNamesWithNumericRanges([
        "01",
        "9007199254740991",
        "2",
        "alpha2",
        "9007199254740992",
        "+3",
        "1.5",
        "-4",
        "10",
      ])
    ).toBe(
      "2, 10, 9007199254740991, 01, alpha2, 9007199254740992, +3, 1.5, -4"
    );
  });
});
