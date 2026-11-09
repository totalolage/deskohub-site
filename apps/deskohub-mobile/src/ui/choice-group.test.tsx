import { describe, expect, mock, test } from "bun:test";
import { theme } from "../theme";
import { ChoiceGroup } from "./choice-group";
import {
  elementTree,
  find,
  findAll,
  type HostProps,
  hostTree,
} from "./testing/element-tree";

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
  const tree = hostTree(
    elementTree(ChoiceGroup<Value>, {
      label: "label",
      options,
      value: "b",
      onChange,
      disabled,
    })
  );
  return {
    group: find(tree, "View")?.props,
    label: find(tree, "Text")?.props,
    radios: findAll(tree, "Pressable").map((radio) => radio.props),
  };
};

/** A radio's handler prop; a missing one fails the test. */
const handler = (radio: HostProps | undefined, name: string) => {
  const prop = radio?.[name];
  if (typeof prop !== "function") throw new Error(`The radio has no ${name}`);
  return prop as (event?: unknown) => void;
};

const press = (radio: HostProps | undefined) => handler(radio, "onPress")();

/** Attaches a stand-in host instance to each radio, as a renderer would. */
const attach = (radios: ReadonlyArray<HostProps>) =>
  radios.map((radio) => {
    const instance = { focus: mock(() => undefined) };
    (radio.ref as (node: unknown) => void)(instance);
    return instance;
  });

const keyDown = (radio: HostProps | undefined, key: string) => {
  const event = { nativeEvent: { key }, preventDefault: mock(() => undefined) };
  handler(radio, "onKeyDown")(event);
  return event;
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

  test("pressing another option chooses it; pressing the chosen one doesn't", () => {
    const onChange = mock((_value: Value) => undefined);
    const { radios } = group({ onChange });
    press(radios[1]);
    expect(onChange).not.toHaveBeenCalled();
    press(radios[2]);
    expect(onChange).toHaveBeenCalledWith("c");
  });

  test("only the chosen option is a keyboard tab stop", () => {
    expect(group().radios.map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  test("an arrow key moves focus and the choice to the next option", () => {
    const onChange = mock((_value: Value) => undefined);
    const { radios } = group({ onChange });
    const instances = attach(radios);
    const event = keyDown(radios[1], "ArrowDown");
    expect(event.preventDefault).toHaveBeenCalled();
    expect(instances[2]?.focus).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("c");
  });

  test("Space chooses the focused option", () => {
    const onChange = mock((_value: Value) => undefined);
    const { radios } = group({ onChange });
    attach(radios);
    expect(keyDown(radios[0], " ").preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("a");
  });

  test("other keys are left alone", () => {
    const onChange = mock((_value: Value) => undefined);
    const { radios } = group({ onChange });
    attach(radios);
    expect(keyDown(radios[0], "Tab").preventDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a disabled group disables every option and ignores keys", () => {
    const onChange = mock((_value: Value) => undefined);
    const { radios } = group({ onChange, disabled: true });
    const instances = attach(radios);
    for (const radio of radios) {
      expect(radio.disabled).toBe(true);
      expect(radio["aria-disabled"]).toBe(true);
      expect(radio.tabIndex).toBe(-1);
    }
    keyDown(radios[1], "ArrowDown");
    expect(instances[2]?.focus).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
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
