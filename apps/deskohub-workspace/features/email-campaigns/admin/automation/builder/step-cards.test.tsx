import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { FlowStepValue } from "./automation-flow-form";
import {
  campaignOperationInputs,
  isValidFlow,
  resetCampaignOperations,
  stubCampaignOperations,
} from "./flow-builder.test-utils";

mock.module("../../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

registerWorkspaceComponentTestEnv();
// React DOM and Radix detect the DOM when they load, so they load after it.
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { WaitStepCard } = await import("./step-cards");

beforeEach(stubCampaignOperations);
afterEach(cleanup);
afterAll(async () => {
  resetCampaignOperations();
  await unregisterWorkspaceComponentTestEnv();
});

type WaitStep = Extract<FlowStepValue, { _tag: "Wait" }>;

const locale = "en-US";
const durationWait: WaitStep = {
  _tag: "Wait",
  id: "wait-1",
  wait: { _tag: "Duration", count: 2, unit: "hour" },
};
const calendarWait: WaitStep = {
  _tag: "Wait",
  id: "wait-1",
  wait: { _tag: "Calendar", expression: { hours: [10] } },
};

/** The one step a card emitted, checked as a wait the admin API takes. */
const emittedStep = (calls: readonly (readonly [WaitStep])[]) => {
  expect(calls).toHaveLength(1);
  const [next] = calls[0] ?? [];
  if (!next) throw new Error("Expected a step");
  expect(
    isValidFlow({
      trigger: { _tag: "AccountCreated" },
      steps: [next, { _tag: "Send", id: "send" }],
    })
  ).toBe(true);
  return next;
};

const renderWait = (
  step: WaitStep,
  errorAt: (field: string) => string | undefined = () => undefined
) => {
  const onChange = mock((_step: WaitStep) => undefined);
  const view = render(
    <RouteLocaleProvider locale={locale}>
      <WaitStepCard
        step={step}
        number={1}
        onChange={onChange}
        menu={null}
        errorAt={errorAt}
        initialPreview={undefined}
      />
    </RouteLocaleProvider>
  );
  const mode = (value: WaitStep["wait"]["_tag"]) =>
    view
      .getAllByRole("radio")
      .find((radio) => radio.getAttribute("value") === value) as HTMLElement;
  const count = () =>
    view.queryByRole("spinbutton", {
      name: m.emailAutomationFlowWaitCountLabel({}, { locale }),
    });
  const unit = () =>
    view.queryByRole("combobox", {
      name: m.emailAutomationFlowWaitUnitLabel({}, { locale }),
    });
  const hours = () =>
    view.queryByRole("group", {
      name: m.emailAutomationFlowCalendarPart({ part: "hours" }, { locale }),
    });
  return { view, onChange, mode, count, unit, hours };
};

test("a duration wait shows its count and unit, not a calendar", () => {
  const { count, unit, hours } = renderWait(durationWait);

  expect(count()).not.toBeNull();
  expect(unit()).not.toBeNull();
  expect(hours()).toBeNull();
});

test("editing the count keeps the duration's unit", () => {
  const { onChange, count } = renderWait(durationWait);

  act(() => {
    fireEvent.change(count() as HTMLElement, { target: { value: "3" } });
  });

  expect(onChange.mock.calls).toEqual([
    [{ ...durationWait, wait: { _tag: "Duration", count: 3, unit: "hour" } }],
  ]);
});

test("switching to a calendar emits a calendar wait and previews it", () => {
  const { onChange, mode } = renderWait(durationWait);

  act(() => {
    fireEvent.click(mode("Calendar"));
  });

  const next = emittedStep(onChange.mock.calls);
  expect(next.id).toBe(durationWait.id);
  if (next.wait._tag !== "Calendar") throw new Error("Expected a calendar");
  expect(campaignOperationInputs("previewCalendarExpression")).toEqual([
    { expression: next.wait.expression, usage: "wait", locale },
  ]);
});

test("a calendar wait shows the calendar editor, not a count", () => {
  const { count, unit, hours } = renderWait(calendarWait);

  expect(hours()).not.toBeNull();
  expect(count()).toBeNull();
  expect(unit()).toBeNull();
});

test("editing the calendar emits the new expression and previews it", () => {
  const { onChange, hours } = renderWait(calendarWait);

  act(() => {
    fireEvent.click(
      within(hours() as HTMLElement).getByRole("button", { name: "11:00" })
    );
  });

  const expression = { hours: [10, 11] };
  expect(onChange.mock.calls).toEqual([
    [{ ...calendarWait, wait: { _tag: "Calendar", expression } }],
  ]);
  expect(campaignOperationInputs("previewCalendarExpression")).toEqual([
    { expression, usage: "wait", locale },
  ]);
});

test("switching back to a duration emits a duration wait", () => {
  const { onChange, mode } = renderWait(calendarWait);

  act(() => {
    fireEvent.click(mode("Duration"));
  });

  const next = emittedStep(onChange.mock.calls);
  expect(next.id).toBe(calendarWait.id);
  expect(next.wait._tag).toBe("Duration");
  expect(campaignOperationInputs("previewCalendarExpression")).toEqual([]);
});

test("an invalid count is described by its mounted error", () => {
  const valid = renderWait(durationWait);
  const alert = valid.view.getByRole("alert");
  expect(alert.textContent).toBe("");
  expect(valid.count()?.getAttribute("aria-invalid")).toBe("false");
  expect(valid.count()?.hasAttribute("aria-describedby")).toBe(false);
  cleanup();

  const invalid = renderWait(
    { ...durationWait, wait: { _tag: "Duration", count: 0, unit: "hour" } },
    (field) => (field === "count" ? "Expected a positive count" : undefined)
  );
  const count = invalid.count() as HTMLElement;
  expect(count.getAttribute("aria-invalid")).toBe("true");
  const error = invalid.view.getByRole("alert");
  expect(count.getAttribute("aria-describedby")).toBe(error.id);
  expect(error.textContent).not.toBe("");
});
