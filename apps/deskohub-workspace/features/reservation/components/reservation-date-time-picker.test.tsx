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
import { ReservationDateTimePicker } from "./reservation-date-time-picker";

describe("ReservationDateTimePicker", () => {
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
      <ReservationDateTimePicker
        dateLabel="Start date"
        {...minimumProps}
        onChange={onChange}
        timeLabel="Start time"
        value="2099-06-10T16:00"
      />
    );
    const timeInput =
      view.container.querySelector<HTMLInputElement>('input[type="time"]');

    expect(timeInput).not.toBeNull();
    expect(timeInput?.min).toBe("15:00");

    minimum = "2099-06-10T17:00";
    fireEvent.input(timeInput!, { target: { value: "16:00" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(timeInput?.value).toBe("16:00");
  });

  test("labels both interactive controls and rejects partial hours", () => {
    const onChange = mock(() => undefined);
    const view = render(
      <ReservationDateTimePicker
        dateLabel="Meeting room start date"
        onChange={onChange}
        timeStepMinutes={60}
        timeLabel="Meeting room start time"
        value="2099-06-10T16:00"
      />
    );

    expect(
      view.getByRole("button", { name: "Meeting room start date" })
    ).toBeDefined();
    const timeInput = view.getByLabelText("Meeting room start time");
    expect(timeInput.getAttribute("step")).toBe("3600");

    fireEvent.input(timeInput, { target: { value: "17:00" } });
    expect(onChange).toHaveBeenCalledWith("2099-06-10T17:00");

    onChange.mockClear();
    fireEvent.input(timeInput, { target: { value: "17:30" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");

    fireEvent.input(timeInput, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");
  });

  test("accepts minute-level values by default", () => {
    const onChange = mock(() => undefined);
    const view = render(
      <ReservationDateTimePicker
        dateLabel="Start date"
        onChange={onChange}
        timeLabel="Start time"
        value="2099-06-10T16:00"
      />
    );
    const timeInput = view.getByLabelText("Start time");

    expect(timeInput.getAttribute("step")).toBe("60");
    fireEvent.input(timeInput, { target: { value: "17:30" } });
    expect(onChange).toHaveBeenCalledWith("2099-06-10T17:30");
  });

  test("clamps an existing value when the minimum moves forward", () => {
    const onChange = mock(() => undefined);
    const view = render(
      <ReservationDateTimePicker
        dateLabel="Start date"
        minimum="2099-06-10T15:00"
        onChange={onChange}
        timeLabel="Start time"
        value="2099-06-10T16:00"
      />
    );

    view.rerender(
      <ReservationDateTimePicker
        dateLabel="Start date"
        minimum="2099-06-10T17:00"
        onChange={onChange}
        timeLabel="Start time"
        value="2099-06-10T16:00"
      />
    );

    expect(onChange).toHaveBeenCalledWith("2099-06-10T17:00");
  });
});
