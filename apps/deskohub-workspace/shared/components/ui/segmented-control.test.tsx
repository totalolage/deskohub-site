import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { SegmentedControl } = await import("./segmented-control");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const options = [
  { label: "Existing", value: "existing" },
  { label: "New", value: "new" },
] as const;

test("renders a named group of radios with the current value checked", () => {
  const view = render(
    <SegmentedControl
      label="Customer source"
      name="customer-source"
      onValueChange={() => undefined}
      options={options}
      value="existing"
    />
  );

  expect(view.getByRole("group", { name: "Customer source" })).toBeTruthy();
  expect(view.getByRole("radio", { name: "Existing" })).toHaveProperty(
    "checked",
    true
  );
  expect(view.getByRole("radio", { name: "New" })).toHaveProperty(
    "checked",
    false
  );
});

test("choosing a segment reports its value", () => {
  const chosen: string[] = [];
  const view = render(
    <SegmentedControl
      label="Customer source"
      name="customer-source"
      onValueChange={(value) => chosen.push(value)}
      options={options}
      value="existing"
    />
  );

  fireEvent.click(view.getByText("New"));
  expect(chosen).toEqual(["new"]);
});

test("disabling the control disables every segment", () => {
  const view = render(
    <SegmentedControl
      disabled
      label="Customer source"
      name="customer-source"
      onValueChange={() => undefined}
      options={options}
      value="new"
    />
  );
  for (const radio of view.getAllByRole("radio")) {
    expect(radio).toHaveProperty("disabled", true);
  }
});

test("the small size makes compact segments", () => {
  const view = render(
    <SegmentedControl
      label="Customer source"
      name="customer-source"
      onValueChange={() => undefined}
      options={options}
      size="sm"
      value="new"
    />
  );
  const segment = view.getByRole("radio", { name: "New" }).parentElement;
  expect(segment?.className.split(/\s+/)).toEqual(
    expect.arrayContaining(["h-7", "px-3"])
  );
  expect(segment?.className.split(/\s+/)).not.toContain("h-9");
});
