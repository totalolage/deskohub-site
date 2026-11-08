import { describe, expect, mock, test } from "bun:test";
import { theme } from "../theme";
import { ChoiceGroup } from "./choice-group";
import { elementTree, find, findAll } from "./testing/element-tree";

type Value = "a" | "b" | "c";

const options = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
] as const;

const group = ({
  onChange = () => undefined,
  disabled,
}: {
  readonly onChange?: (value: Value) => void;
  readonly disabled?: boolean;
} = {}) => {
  const tree = elementTree(ChoiceGroup<Value>, {
    label: "label",
    options,
    value: "b",
    onChange,
    disabled,
  });
  return {
    group: find(tree, "View")?.props,
    label: find(tree, "Text")?.props,
    radios: findAll(tree, "Pressable").map((radio) => radio.props),
  };
};

describe("ChoiceGroup", () => {
  test("its visible label names the radio group", () => {
    const { group: radioGroup, label } = group();
    expect(radioGroup?.role).toBe("radiogroup");
    expect(label?.id).toBeString();
    expect(radioGroup?.["aria-labelledby"]).toBe(label?.id);
  });

  test("each option is a radio and only the chosen one is checked", () => {
    const { radios } = group();
    expect(radios.map((radio) => radio.role)).toEqual([
      "radio",
      "radio",
      "radio",
    ]);
    expect(radios.map((radio) => radio["aria-checked"])).toEqual([
      false,
      true,
      false,
    ]);
  });

  test("pressing an option chooses its value", () => {
    const onChange = mock((_value: Value) => undefined);
    const { radios } = group({ onChange });
    const onPress = radios[2]?.onPress;
    expect(onPress).toBeInstanceOf(Function);
    (onPress as () => void)();
    expect(onChange).toHaveBeenCalledWith("c");
  });

  test("a disabled group disables every option", () => {
    for (const radio of group({ disabled: true }).radios) {
      expect(radio.disabled).toBe(true);
      expect(radio["aria-disabled"]).toBe(true);
    }
    for (const radio of group().radios) {
      expect(radio.disabled).toBe(false);
    }
  });

  test("every option is at least a touch target tall", () => {
    for (const radio of group().radios) {
      const style = (radio.style as (state: { pressed: boolean }) => unknown)({
        pressed: false,
      });
      expect(
        [style]
          .flat()
          .some(
            (entry) =>
              typeof entry === "object" &&
              entry !== null &&
              "minHeight" in entry &&
              typeof entry.minHeight === "number" &&
              entry.minHeight >= theme.touchTarget
          )
      ).toBe(true);
    }
  });
});
