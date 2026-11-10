import { describe, expect, test } from "bun:test";
import { type ComponentProps, createRef } from "react";
import type { TextInputInstance } from "react-native";
import { theme } from "../theme";
import { Button, TextField } from "./controls";
import { idleLiveRegionLayout } from "./notice-presentation";
import { elementTree, find, findAll, hostTree } from "./testing/element-tree";

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

/** The input and the error live region (its only Text with a role). */
const field = (props: Partial<ComponentProps<typeof TextField>> = {}) => {
  const tree = hostTree(elementTree(TextField, { label: "label", ...props }));
  return {
    input: find(tree, "TextInput")?.props,
    errorRegion: findAll(tree, "Text").find(
      (text) => text.props.role !== undefined
    )?.props,
  };
};

const styleEntries = (style: unknown) =>
  [style].flat().filter((entry) => typeof entry === "object" && !!entry);

describe("TextField", () => {
  test("without an error the field is valid and its live region idles out of the layout", () => {
    for (const error of [undefined, ""]) {
      const { input, errorRegion } = field({ error });
      expect(input?.["aria-invalid"]).toBe(false);
      expect(input?.accessibilityHint).toBeUndefined();
      expect(input?.["aria-describedby"]).toBeUndefined();
      expect(errorRegion).toBeDefined();
      expect(errorRegion?.style).toBe(idleLiveRegionLayout);
      expect(errorRegion?.children).toBe("");
    }
  });

  test("an error marks the input invalid and describes it", () => {
    const error = "x";
    const { input, errorRegion } = field({ error });
    expect(input?.["aria-invalid"]).toBe(true);
    expect(input?.accessibilityHint).toBe(error);
    expect(errorRegion?.id).toBeString();
    expect(input?.["aria-describedby"]).toBe(errorRegion?.id);
    expect(styleEntries(input?.style)).toContainEqual({
      borderColor: theme.colors.danger,
    });
    expect(errorRegion?.children).toBe(error);
    expect(errorRegion?.style).not.toBe(idleLiveRegionLayout);
  });

  test("the error region declares a polite live region, idle or shown", () => {
    for (const error of [undefined, "x"]) {
      const { errorRegion } = field({ error });
      expect(errorRegion?.role).toBe("status");
      expect(errorRegion?.["aria-live"]).toBe("polite");
      expect(errorRegion?.accessibilityLiveRegion).toBe("polite");
    }
  });

  test("the ref reaches the input, so a form can focus it", () => {
    const ref = createRef<TextInputInstance>();
    expect(field({ ref }).input?.ref).toBe(ref);
  });

  test("autoCapitalize stays off unless a caller sets it", () => {
    expect(field().input?.autoCapitalize).toBe("none");
    expect(field({ autoCapitalize: "words" }).input?.autoCapitalize).toBe(
      "words"
    );
  });
});
