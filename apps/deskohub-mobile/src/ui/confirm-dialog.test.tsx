import { describe, expect, test } from "bun:test";
import { Children, createElement, isValidElement, type ReactNode } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { elementTree, find } from "./testing/element-tree";

const dialog = (children?: ReactNode) =>
  elementTree(ConfirmDialog, {
    visible: true,
    title: "title",
    body: "body",
    confirmLabel: "confirm",
    cancelLabel: "cancel",
    onConfirm: () => undefined,
    onCancel: () => undefined,
    children,
  });

describe("ConfirmDialog", () => {
  test("its content follows the body inside the scroll area", () => {
    const content = createElement("DialogContent");
    const scroll = find(dialog(content), "ScrollView");
    const copy = Children.toArray(scroll?.props.children);
    expect(copy).toHaveLength(3);
    expect(isValidElement(copy[2]) && copy[2].type).toBe("DialogContent");
  });

  test("without content the scroll area holds the title and body only", () => {
    const scroll = find(dialog(), "ScrollView");
    expect(Children.toArray(scroll?.props.children)).toHaveLength(2);
  });
});
