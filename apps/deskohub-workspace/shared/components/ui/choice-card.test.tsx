import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { ChoiceCard } = await import("./choice-card");
const { Checkbox } = await import("./checkbox");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("clicking the card checks its native radio", () => {
  const view = render(
    <fieldset>
      <ChoiceCard>
        <input name="audience" type="radio" value="one" />
        <span>Single customer</span>
      </ChoiceCard>
      <ChoiceCard>
        <input name="audience" type="radio" value="all" />
        <span>Everyone</span>
      </ChoiceCard>
    </fieldset>
  );

  fireEvent.click(view.getByText("Everyone"));
  expect(view.getByRole("radio", { name: "Everyone" })).toHaveProperty(
    "checked",
    true
  );
  expect(view.getByRole("radio", { name: "Single customer" })).toHaveProperty(
    "checked",
    false
  );
});

test("clicking the card toggles the shared Checkbox", () => {
  const view = render(
    <ChoiceCard tone="warning">
      <Checkbox />
      <span>I agree to the payment terms</span>
    </ChoiceCard>
  );
  const checkbox = view.getByRole("checkbox", {
    name: "I agree to the payment terms",
  });

  expect(checkbox.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(view.getByText("I agree to the payment terms"));
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
});

test("the card styles checked, focus and disabled states from its control", () => {
  const view = render(
    <ChoiceCard>
      <input type="checkbox" />
      Paid
    </ChoiceCard>
  );
  const card = view.getByText("Paid");

  expect(card.tagName).toBe("LABEL");
  expect(card.className).toEqual(
    expect.stringContaining("has-checked:border-burned-orange")
  );
  expect(card.className).toContain("has-aria-checked:border-burned-orange");
  expect(card.className).toContain("has-focus-visible:outline-2");
  expect(card.className).toContain("has-disabled:cursor-not-allowed");
  expect(card.className).toContain("accent-burned-orange");
});
