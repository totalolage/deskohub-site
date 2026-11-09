import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { buttonVariants } = await import("./button");
const { Sheet, SheetContent, SheetDescription, SheetTitle } = await import(
  "./sheet"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("the close action is a muted ghost icon Button named for the locale", () => {
  const openChanges: boolean[] = [];
  const view = render(
    <Sheet onOpenChange={(open) => openChanges.push(open)} open>
      <SheetContent locale="cs-CZ">
        <SheetTitle>Menu</SheetTitle>
        <SheetDescription>Navigace webu.</SheetDescription>
      </SheetContent>
    </Sheet>
  );
  const close = view.getByRole("button", {
    name: m.closeDialogLabel({}, { locale: "cs-CZ" }),
  });

  expect(close.getAttribute("type")).toBe("button");
  expect(close.className.split(" ")).toEqual(
    expect.arrayContaining(
      buttonVariants({
        size: "icon-sm",
        tone: "muted",
        variant: "ghost",
      }).split(" ")
    )
  );

  fireEvent.click(close);
  expect(openChanges).toEqual([false]);
});
