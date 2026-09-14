import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

beforeAll(registerWorkspaceComponentTestEnv);
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test.each([
  ["en-US", "This feature is coming in the future."],
  ["cs-CZ", "Tato funkce bude k dispozici v budoucnu."],
] as const)(
  "focuses the wrapper, localizes the tooltip, and preserves the disabled child for %s",
  async (locale, message) => {
    const { FutureFeatureTooltip } = await import("./future-feature-tooltip");
    let activationCount = 0;
    const view = render(
      <FutureFeatureTooltip locale={locale}>
        <button
          aria-label="Disabled action"
          disabled
          onClick={() => {
            activationCount += 1;
          }}
          type="button"
        >
          <span aria-hidden="true">Icon</span>
        </button>
      </FutureFeatureTooltip>
    );
    const child = view.getByRole("button", { name: "Disabled action" });
    const trigger = view.container.querySelector<HTMLElement>('[tabindex="0"]');

    expect(trigger).not.toBeNull();
    expect(trigger?.tagName).toBe("SPAN");
    expect(trigger?.getAttribute("role")).toBe("group");
    const childLabelId = trigger?.getAttribute("aria-labelledby");
    expect(childLabelId).not.toBeNull();
    expect(childLabelId).toBe(child.id);
    expect(document.getElementById(childLabelId ?? "")).toBe(child);
    expect(child.parentElement?.className).toContain("pointer-events-none");
    expect(child.parentElement?.className).toContain("contents");
    expect(trigger?.className).toContain("inline-flex");
    expect(trigger?.className).toContain("min-w-0");
    expect(trigger?.className).toContain("max-w-full");
    expect(trigger?.classList.contains("w-full")).toBe(false);
    expect(trigger?.className).toContain("focus-visible:ring-2");
    expect(view.getByRole("group", { name: "Disabled action" })).toBe(trigger);
    expect((child as HTMLButtonElement).disabled).toBe(true);
    const documentView = within(view.baseElement);
    expect(documentView.queryByRole("tooltip")).toBeNull();

    await act(async () => {
      trigger?.focus();
    });

    expect(document.activeElement).toBe(trigger);
    const tooltip = await waitFor(() => documentView.getByRole("tooltip"));
    expect(tooltip.textContent).toBe(message);
    expect(tooltip.className).toContain("w-[min(20rem,calc(100vw-2rem))]");
    expect(tooltip.className).toContain("max-w-[320px]");
    expect(tooltip.className).toContain("break-words");
    expect(tooltip.className).toContain("whitespace-normal");
    expect(trigger?.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(
      view.getByRole("group", { description: message, name: "Disabled action" })
    ).toBe(trigger);

    await act(async () => {
      fireEvent.keyDown(trigger as HTMLElement, { key: "Escape" });
    });
    await waitFor(() => expect(documentView.queryByRole("tooltip")).toBeNull());

    fireEvent.click(child);
    fireEvent.click(trigger as HTMLElement);
    fireEvent.keyDown(trigger as HTMLElement, { key: "Enter" });
    fireEvent.keyDown(trigger as HTMLElement, { key: " " });
    expect((child as HTMLButtonElement).disabled).toBe(true);
    expect(activationCount).toBe(0);
  }
);

test("merges an optional wrapper class with the default trigger classes", async () => {
  const { FutureFeatureTooltip } = await import("./future-feature-tooltip");
  const view = render(
    <FutureFeatureTooltip className="w-full" locale="en-US">
      <button disabled type="button">
        Full-width action
      </button>
    </FutureFeatureTooltip>
  );
  const trigger = view.container.querySelector<HTMLElement>('[tabindex="0"]');

  expect(trigger?.classList.contains("w-full")).toBe(true);
  expect(trigger?.className).toContain("inline-flex");
  expect(trigger?.className).toContain("min-w-0");
  expect(trigger?.className).toContain("max-w-full");
  expect(trigger?.className).toContain("focus-visible:ring-2");
});

test("keeps the tooltip available across pointer leaves and dismisses with Escape", async () => {
  const { FutureFeatureTooltip } = await import("./future-feature-tooltip");
  const view = render(
    <FutureFeatureTooltip locale="en-US">
      <button disabled type="button">
        Hover target
      </button>
    </FutureFeatureTooltip>
  );
  const trigger = view.container.querySelector<HTMLElement>('[tabindex="0"]');
  if (!trigger) throw new Error("Future-feature trigger was not rendered");
  const documentView = within(view.baseElement);

  fireEvent.pointerMove(trigger, { pointerType: "mouse" });
  const tooltip = await waitFor(() => documentView.getByRole("tooltip"));
  expect(tooltip.textContent).toBe("This feature is coming in the future.");
  expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
  expect(
    view.getByRole("group", {
      description: "This feature is coming in the future.",
    })
  ).toBe(trigger);

  fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
  expect(documentView.getByRole("tooltip")).toBe(tooltip);
  expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);

  fireEvent.pointerLeave(tooltip, { pointerType: "mouse" });
  await act(async () => {
    fireEvent.keyDown(document, { key: "Escape" });
  });
  await waitFor(() => expect(documentView.queryByRole("tooltip")).toBeNull());
  expect(trigger.getAttribute("aria-describedby")).toBeNull();
});

test("uses rendered text as the named group content", async () => {
  const { FutureFeatureTooltip } = await import("./future-feature-tooltip");
  const view = render(
    <FutureFeatureTooltip locale="en-US">
      <button disabled type="button">
        Disabled text action
      </button>
    </FutureFeatureTooltip>
  );
  const child = view.getByRole("button", { name: "Disabled text action" });
  const trigger = child.closest<HTMLElement>('[tabindex="0"]');

  expect(trigger).not.toBeNull();
  expect(view.getByRole("group", { name: "Disabled text action" })).toBe(
    trigger
  );
  expect((child as HTMLButtonElement).disabled).toBe(true);
});
