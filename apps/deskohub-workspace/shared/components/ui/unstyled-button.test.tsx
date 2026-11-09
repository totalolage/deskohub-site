import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { UnstyledButton } = await import("./unstyled-button");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("defaults to a non-submitting button with only a focus outline", () => {
  const view = render(
    <form>
      <UnstyledButton aria-label="Show slide 2" className="size-8" />
    </form>
  );
  const button = view.getByRole("button", { name: "Show slide 2" });

  expect(button.getAttribute("type")).toBe("button");
  expect(button.className).toContain("focus-visible:outline-2");
  expect(button.className).toContain("size-8");
  expect(button.className).not.toContain("shadow-button-raised");
  expect(button.className).not.toContain("bg-");
});

test("keeps an explicit submit type", () => {
  const view = render(<UnstyledButton type="submit">Send</UnstyledButton>);
  expect(view.getByRole("button").getAttribute("type")).toBe("submit");
});
