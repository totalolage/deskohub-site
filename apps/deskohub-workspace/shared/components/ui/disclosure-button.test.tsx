import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { DisclosureButton } = await import("./disclosure-button");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test.each([true, false])(
  "announces expanded=%s and the region it controls",
  (expanded) => {
    const view = render(
      <DisclosureButton
        controls="edit-row"
        expanded={expanded}
        variant="secondary"
      >
        Edit
      </DisclosureButton>
    );
    const button = view.getByRole("button", { name: "Edit" });

    expect(button.getAttribute("aria-expanded")).toBe(String(expanded));
    expect(button.getAttribute("aria-controls")).toBe("edit-row");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.hasAttribute("aria-pressed")).toBe(false);
  }
);

test("expanded wins over a stray aria-expanded prop", () => {
  const view = render(
    <DisclosureButton aria-expanded={false} expanded>
      Details
    </DisclosureButton>
  );
  expect(view.getByRole("button").getAttribute("aria-expanded")).toBe("true");
});
