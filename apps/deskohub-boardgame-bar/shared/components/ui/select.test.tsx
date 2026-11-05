import { describe, expect, test } from "bun:test";
import * as SelectPrimitive from "@radix-ui/react-select";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import {
  SelectContent,
  SelectScrollDownButton,
  SelectScrollUpButton,
} from "./select";

const popperOffset = "data-[side=bottom]:translate-y-1";
const triggerSized = "h-[var(--radix-select-trigger-height)]";

const contentOf = (props: Parameters<typeof SelectContent>[0]) => {
  const tree = SelectContent(props);
  const [content] = findElementsOfType(tree, SelectPrimitive.Content);
  const [viewport] = findElementsOfType(tree, SelectPrimitive.Viewport);
  return {
    portals: findElementsOfType(tree, SelectPrimitive.Portal).length,
    position: content?.props.position,
    contentClasses: content?.props.className?.split(" "),
    viewportClasses: viewport?.props.className?.split(" "),
    viewportChildren: viewport?.props.children,
    scrollUp: findElementsOfType(tree, SelectScrollUpButton).length,
    scrollDown: findElementsOfType(tree, SelectScrollDownButton).length,
  };
};

describe("SelectContent", () => {
  test("opens as a popper sized to the trigger by default", () => {
    const content = contentOf({ children: "options", className: "w-60" });

    expect(content.portals).toBe(1);
    expect(content.position).toBe("popper");
    expect(content.contentClasses).toContain(popperOffset);
    expect(content.contentClasses).toContain("w-60");
    expect(content.viewportClasses).toContain(triggerSized);
    expect(content.viewportChildren).toBe("options");
    expect(content.scrollUp).toBe(1);
    expect(content.scrollDown).toBe(1);
  });

  test("drops the popper offset and sizing when aligned to the item", () => {
    const content = contentOf({
      children: "options",
      position: "item-aligned",
    });

    expect(content.position).toBe("item-aligned");
    expect(content.contentClasses).not.toContain(popperOffset);
    expect(content.viewportClasses).toEqual(["p-1"]);
  });
});
