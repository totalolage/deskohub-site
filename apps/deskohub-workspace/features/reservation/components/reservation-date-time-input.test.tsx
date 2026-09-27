import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { ReservationDateTimeInput } = await import(
  "./reservation-date-time-input"
);

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

type DateTimeInputProps = Parameters<typeof ReservationDateTimeInput>[0];

/**
 * Stateful harness mirroring how react-hook-form feeds the canonical value
 * back through `onChange`, so the named submit field reflects committed
 * edits exactly like the reservation forms do.
 */
const Harness = (props: DateTimeInputProps) => {
  const [value, setValue] = useState<string | undefined>(props.value);

  return (
    <ReservationDateTimeInput
      dateLabel="Start date"
      locale="en-US"
      name="startDateTime"
      timeLabel="Start time"
      {...props}
      onChange={(next) => {
        props.onChange?.(next);
        setValue(next);
      }}
      value={value}
    />
  );
};

const renderDateTimeInput = ({
  props = {},
}: {
  readonly props?: Partial<DateTimeInputProps>;
} = {}) => {
  const onChange = mock(() => undefined);
  const view = render(<Harness {...props} onChange={onChange} />);
  const readHidden = () =>
    [
      ...view.container.querySelectorAll<HTMLInputElement>(
        '[name="startDateTime"]'
      ),
    ][0];
  const rerenderWith = (nextProps: Partial<DateTimeInputProps>) =>
    view.rerender(<Harness {...props} {...nextProps} onChange={onChange} />);
  return { onChange, readHidden, rerenderWith, view };
};

const openCalendar = async (
  view: ReturnType<typeof renderDateTimeInput>["view"],
  triggerName = /Start date/
) => {
  fireEvent.click(view.getByRole("button", { name: triggerName }));
  await view.findByRole("grid");
};

const pickEnabledGridDay = async (
  view: ReturnType<typeof renderDateTimeInput>["view"],
  day: string,
  triggerName?: RegExp
) => {
  await openCalendar(view, triggerName);
  const dayButton = [
    ...view.baseElement.querySelectorAll<HTMLButtonElement>(
      '[role="grid"] button'
    ),
  ].find((button) => button.textContent === day && !button.disabled);
  expect(dayButton).toBeDefined();
  fireEvent.click(dayButton!);
};

describe("ReservationDateTimeInput", () => {
  test("submits the complete canonical datetime under the field name", () => {
    const { readHidden, view } = renderDateTimeInput({
      props: { value: "2099-06-10T16:00" },
    });

    expect(readHidden().value).toBe("2099-06-10T16:00");
    expect(readHidden().getAttribute("type")).toBe("hidden");
    expect(
      view.container.querySelectorAll('[name="startDateTime"]')
    ).toHaveLength(1);
    expect(view.getByRole("button", { name: /Start date/ })).toBeDefined();
    expect(view.getByLabelText(/Start time/)).toBeDefined();
  });

  test("applies the reservation default start time when a date is picked without a time", async () => {
    const { onChange, readHidden, view } = renderDateTimeInput();

    await pickEnabledGridDay(view, "15");

    expect(onChange).toHaveBeenCalledWith(expect.stringMatching(/T10:00$/));
    expect(readHidden().value).toBe(onChange.mock.calls[0]?.[0]);
  });

  test("prevents selecting a time before the same-day minimum", () => {
    let minimum = "2099-06-10T15:00";
    const onChange = mock(() => undefined);
    const view = render(
      <Harness
        dateLabel="Start date"
        minimum={() => minimum}
        onChange={onChange}
        timeLabel="Start time"
        value="2099-06-10T16:00"
      />
    );
    const timeInput = view.getByLabelText(/Start time/) as HTMLInputElement;

    minimum = "2099-06-10T17:00";
    fireEvent.input(timeInput, { target: { value: "16:00" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(timeInput.value).toBe("16:00");
  });

  test("labels both interactive controls as required and rejects partial hours", () => {
    const onChange = mock(() => undefined);
    const view = render(
      <Harness
        dateLabel="Meeting room start date"
        locale="en-US"
        onChange={onChange}
        required
        timeLabel="Meeting room start time"
        timeStepMinutes={60}
        value="2099-06-10T16:00"
      />
    );

    expect(
      view.getByRole("button", { name: "Meeting room start date, required" })
    ).toBeDefined();
    const timeInput = view.getByLabelText("Meeting room start time, required");
    expect(timeInput).toBeDefined();

    fireEvent.input(timeInput, { target: { value: "17:00" } });
    expect(onChange).toHaveBeenCalledWith("2099-06-10T17:00");

    onChange.mockClear();
    fireEvent.input(timeInput, { target: { value: "17:30" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("17:00");

    fireEvent.input(timeInput, { target: { value: "" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("17:00");
  });

  test("shows only the selected date in the date control", () => {
    const view = render(
      <Harness
        dateLabel="Start date"
        locale="en-US"
        timeLabel="Start time"
        value="2099-06-10T16:00"
      />
    );

    const dateButton = view.getByRole("button", { name: "Start date" });
    expect(dateButton.textContent).toContain("June 10, 2099");
    expect(dateButton.textContent).not.toContain("16:00");

    cleanup();
    const czechView = render(
      <Harness
        dateLabel="Datum začátku"
        locale="cs-CZ"
        timeLabel="Čas začátku"
        value="2099-06-10T16:00"
      />
    );
    expect(
      czechView.getByRole("button", { name: "Datum začátku" }).textContent
    ).toContain("10. června 2099");
  });

  test("accepts a time before the date and keeps it pending", () => {
    const { onChange, rerenderWith, view } = renderDateTimeInput();
    const timeInput = view.getByLabelText(/Start time/) as HTMLInputElement;

    expect(timeInput.disabled).toBe(false);
    fireEvent.input(timeInput, { target: { value: "17:00" } });
    expect(timeInput.value).toBe("17:00");
    expect(onChange).not.toHaveBeenCalled();

    rerenderWith({});
    expect((view.getByLabelText(/Start time/) as HTMLInputElement).value).toBe(
      "17:00"
    );
  });

  test("accepts minute-level values by default", () => {
    const { onChange, view } = renderDateTimeInput({
      props: { value: "2099-06-10T16:00" },
    });
    const timeInput = view.getByLabelText(/Start time/);

    fireEvent.input(timeInput, { target: { value: "17:30" } });
    expect(onChange).toHaveBeenCalledWith("2099-06-10T17:30");
  });

  test("does not mutate controlled state when the minimum moves forward", () => {
    const { onChange, rerenderWith } = renderDateTimeInput({
      props: { minimum: "2099-06-10T15:00", value: "2099-06-10T16:00" },
    });

    rerenderWith({ minimum: "2099-06-10T17:00" });

    expect(onChange).not.toHaveBeenCalled();
  });

  test("clamps the pending clock to the same-day minimum when the date moves", async () => {
    const today = Temporal.Now.plainDateISO();
    const otherDay = today.add({ days: 2 });
    let minimum = `${today.toString()}T15:00`;
    const { onChange, rerenderWith, view } = renderDateTimeInput({
      props: { minimum: () => minimum },
    });

    fireEvent.input(view.getByLabelText(/Start time/), {
      target: { value: "16:00" },
    });
    await pickEnabledGridDay(view, otherDay.day.toString());
    expect(onChange).toHaveBeenCalledWith(`${otherDay.toString()}T16:00`);

    onChange.mockClear();
    minimum = `${today.toString()}T17:00`;
    rerenderWith({ minimum: () => minimum });
    await pickEnabledGridDay(view, today.day.toString());
    expect(onChange).toHaveBeenCalledWith(`${today.toString()}T17:00`);
  });

  test("hides time without mutating the selected date-time", () => {
    const { onChange, view } = renderDateTimeInput({
      props: {
        minimum: "2099-06-10T15:00",
        showTime: false,
        value: "2099-06-10T16:00",
      },
    });

    expect(view.queryByLabelText(/Start time/)).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("restores the preserved clock when time is shown again", () => {
    const { onChange, rerenderWith, view } = renderDateTimeInput({
      props: { showTime: false, value: "2099-06-11T16:00" },
    });

    expect(onChange).not.toHaveBeenCalled();
    rerenderWith({ showTime: true });

    expect((view.getByLabelText(/Start time/) as HTMLInputElement).value).toBe(
      "16:00"
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  test("clearing the date empties the canonical field without fabricating a time", async () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: { value: "2099-06-10T16:00" },
    });

    await openCalendar(view);
    const clearButton = [
      ...view.baseElement.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent === "Clear");
    expect(clearButton).toBeDefined();
    act(() => {
      fireEvent.click(clearButton!);
    });

    expect(onChange).toHaveBeenCalledWith(undefined);
    expect(readHidden().value).toBe("");
  });
});
