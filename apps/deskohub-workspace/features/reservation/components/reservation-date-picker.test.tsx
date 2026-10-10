import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { ReservationDatePicker } from "./reservation-date-picker";

describe("ReservationDatePicker", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("reports a blur when the calendar closes so onBlur validation runs", () => {
    const onBlur = mock(() => undefined);
    const view = render(
      <ReservationDatePicker
        ariaLabel="Date"
        onBlur={onBlur}
        value="2099-06-10"
      />
    );
    const trigger = view.getByRole("button", { name: "Date" });

    act(() => {
      fireEvent.click(trigger);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(onBlur).not.toHaveBeenCalled();

    act(() => {
      fireEvent.click(trigger);
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
