import { describe, expect, test } from "bun:test";
import {
  listRowAccessibleLabel,
  listRowPresentation,
} from "./list-row-presentation";

describe("listRowPresentation", () => {
  test("a row without a press handler is plain content", () => {
    expect(
      listRowPresentation({ pressable: false, kind: "navigation" })
    ).toEqual({ role: undefined, chevron: false });
    expect(listRowPresentation({ pressable: false, kind: "action" })).toEqual({
      role: undefined,
      chevron: false,
    });
  });

  test("a pressable navigation row is a link with a chevron", () => {
    expect(
      listRowPresentation({ pressable: true, kind: "navigation" })
    ).toEqual({ role: "link", chevron: true });
  });

  test("a pressable action row is a button without a chevron", () => {
    expect(listRowPresentation({ pressable: true, kind: "action" })).toEqual({
      role: "button",
      chevron: false,
    });
  });
});

describe("listRowAccessibleLabel", () => {
  test("is the label alone when nothing else is shown", () => {
    expect(listRowAccessibleLabel({ label: "A" })).toBe("A");
  });

  test("reads the label, then the value, then the description", () => {
    expect(
      listRowAccessibleLabel({ label: "A", value: "B", description: "C" })
    ).toBe("A, B, C");
    expect(listRowAccessibleLabel({ label: "A", description: "C" })).toBe(
      "A, C"
    );
  });

  test("skips empty parts", () => {
    expect(
      listRowAccessibleLabel({ label: "A", value: "", description: "C" })
    ).toBe("A, C");
  });
});
