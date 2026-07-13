import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { DateTimePicker } from "./date-time-picker";

describe("DateTimePicker", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("prevents selecting a time before the same-day minimum", () => {
    const onChange = mock(() => undefined);
    let minimum = "2099-06-10T15:00";
    const minimumProps = { minimum: () => minimum };
    const view = render(
      <DateTimePicker
        {...minimumProps}
        onChange={onChange}
        value="2099-06-10T16:00"
      />
    );
    const timeInput =
      view.container.querySelector<HTMLInputElement>('input[type="time"]');

    expect(timeInput).not.toBeNull();
    expect(timeInput?.min).toBe("15:00");

    minimum = "2099-06-10T17:00";
    fireEvent.change(timeInput!, { target: { value: "16:00" } });

    expect(onChange).not.toHaveBeenCalled();
  });
});
