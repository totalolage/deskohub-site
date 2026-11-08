import { describe, expect, test } from "bun:test";
import { Button } from "./controls";

const button = (accessibilityLabel?: string) =>
  Button({ label: "label", onPress: () => undefined, accessibilityLabel });

describe("Button", () => {
  test("an accessible label names the pressable", () => {
    expect(button("named").props["aria-label"]).toBe("named");
  });

  test("without one, the pressable is named by its visible label", () => {
    expect(button().props["aria-label"]).toBeUndefined();
  });
});
