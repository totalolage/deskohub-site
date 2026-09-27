import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { DateTimeInput } = await import("./date-time-input");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const today = Temporal.Now.plainDateISO();
const dayInCurrentMonth = (day: number) => today.with({ day });

/** Finds a grid day button belonging to the currently displayed month. */
const currentMonthGridDay = (
  view: ReturnType<typeof renderDateTimeInput>["view"],
  day: number
) => {
  const month = today.toLocaleString("en-US", { month: "long" });
  const year = String(today.year);
  return [
    ...view.baseElement.querySelectorAll<HTMLButtonElement>(
      '[role="grid"] button'
    ),
  ].find(
    (button) =>
      button.textContent === String(day) &&
      (button.getAttribute("aria-label") ?? "").includes(month) &&
      (button.getAttribute("aria-label") ?? "").includes(year)
  );
};

const renderDateTimeInput = ({
  props = {},
  withName = true,
}: {
  readonly props?: Partial<Parameters<typeof DateTimeInput>[0]>;
  readonly withName?: boolean;
} = {}) => {
  const onChange = mock(() => undefined);
  const view = render(
    <form aria-label="Bound form">
      <DateTimeInput
        dateLabel="Start date"
        defaultValue={props?.defaultValue}
        id="startsAt"
        locale="en-US"
        maximum={props?.maximum}
        minimum={props?.minimum}
        name={withName ? "startsAt" : undefined}
        onChange={onChange}
        required={props?.required}
        timeLabel="Start time"
        timeStepMinutes={props?.timeStepMinutes}
        value={props?.value}
      />
    </form>
  );
  const form = view.getByRole("form", {
    name: "Bound form",
  }) as HTMLFormElement;
  const readHidden = () => [
    ...form.querySelectorAll<HTMLInputElement>('[name="startsAt"]'),
  ];
  return { form, onChange, readHidden, view };
};

const pickDate = async (
  view: ReturnType<typeof renderDateTimeInput>["view"],
  day: string
) => {
  fireEvent.click(view.getByRole("button", { name: "Start date" }));
  await view.findByRole("grid");
  const dayButton = [
    ...view.baseElement.querySelectorAll<HTMLButtonElement>(
      '[role="grid"] button'
    ),
  ].find((button) => button.textContent === day && !button.disabled);
  expect(dayButton).toBeDefined();
  fireEvent.click(dayButton!);
};

type DateTimeInputProps = Parameters<typeof DateTimeInput>[0];

/**
 * Stateful harness mirroring an owning form: the canonical value flows back
 * through onChange into controlled state, so the named submit field tracks
 * committed edits exactly like a real parent.
 */
const StatefulHarness = ({
  onValueChange,
  value: valueProp,
  ...props
}: Omit<DateTimeInputProps, "onChange"> & {
  readonly onValueChange?: (value: string | undefined) => void;
}) => {
  const [value, setValue] = useState<string | undefined>(valueProp);
  // Track the previous PROP with its own render-adjust state pair: only an
  // asserted prop change resets the editable state, so adoption through
  // onChange sticks (the owned value is not compared against the original
  // prop on every render).
  const [previousProp, setPreviousProp] = useState(valueProp);
  if (previousProp !== valueProp) {
    setPreviousProp(valueProp);
    setValue(valueProp);
  }
  return (
    <DateTimeInput
      {...props}
      onChange={(next) => {
        onValueChange?.(next);
        // A real owning form maps explicit clears to a controlled empty so
        // control ownership stays with the parent.
        setValue(next ?? "");
      }}
      value={value}
    />
  );
};

const renderStateful = (
  props: Partial<Parameters<typeof StatefulHarness>[0]> = {}
) => {
  const onValueChange = mock(() => undefined);
  const baseProps = {
    dateLabel: "Start date",
    id: "startsAt",
    locale: "en-US",
    name: "startsAt",
    onValueChange,
    timeLabel: "Start time",
    ...props,
  } as Parameters<typeof StatefulHarness>[0];
  const view = render(
    <form aria-label="Bound form">
      <StatefulHarness {...baseProps} />
    </form>
  );
  const form = view.getByRole("form", {
    name: "Bound form",
  }) as HTMLFormElement;
  const readHidden = () =>
    form.querySelector<HTMLInputElement>('[name="startsAt"]')!;
  const rerender = (
    nextProps: Partial<Parameters<typeof StatefulHarness>[0]> = {}
  ) =>
    view.rerender(
      <form aria-label="Bound form">
        <StatefulHarness {...baseProps} {...nextProps} />
      </form>
    );
  return { form, onValueChange, readHidden, rerender, view };
};

describe("DateTimeInput", () => {
  test("constructs a value from a controlled-empty state and reports explicit clears", async () => {
    const target = dayInCurrentMonth(15);
    // The parent owns a controlled empty and adopts every emitted value, so
    // construction from empty exercises the controlled adoption path.
    const { form, onValueChange, view } = renderStateful({ value: "" });

    // Controlled-empty: selecting a date is a visible partial draft that
    // submits nothing and keeps the form blocked.
    await pickDate(view, "15");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(new FormData(form).get("startsAt")).toBe("");
    expect(form.checkValidity()).toBe(false);

    // Completing the draft emits the canonical value; the parent adopts it,
    // and both the canonical FormData value and the visible controls follow
    // the adopted controlled value.
    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });
    const complete = `${target.toString()}T10:30`;
    expect(onValueChange).toHaveBeenLastCalledWith(complete);
    expect(new FormData(form).get("startsAt")).toBe(complete);
    expect(form.checkValidity()).toBe(true);
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      "10:30"
    );
    expect(
      (
        view.getByRole("button", { name: "Start date" }).textContent ?? ""
      ).trim()
    ).not.toBe("Pick a date");

    // Clearing the time leaves a date-only partial draft that reports
    // nothing while it blocks submission. Clearing the date then reports an
    // explicit clear, which the parent maps back to a controlled empty.
    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "" },
    });
    expect(onValueChange).toHaveBeenLastCalledWith(complete);
    expect(new FormData(form).get("startsAt")).toBe("");
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      ""
    );
    expect(form.checkValidity()).toBe(false);
    fireEvent.click(view.getByRole("button", { name: "Start date" }));
    fireEvent.click(
      await view.findByRole("button", { name: "Clear Start date" })
    );
    expect(onValueChange).toHaveBeenLastCalledWith(undefined);
    expect(new FormData(form).get("startsAt")).toBe("");

    // Re-entering a full value works from the cleared controlled state.
    await pickDate(view, "15");
    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });
    expect(onValueChange).toHaveBeenLastCalledWith(complete);
    expect(new FormData(form).get("startsAt")).toBe(complete);
  });

  test("follows the parent resetting the controlled value", async () => {
    const target = dayInCurrentMonth(15);
    const { onValueChange, readHidden, rerender, view } = renderStateful();

    await pickDate(view, "15");
    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });
    expect(readHidden().value).toBe(`${target.toString()}T10:30`);

    rerender({ value: "2099-06-10T16:00" });
    expect(readHidden().value).toBe("2099-06-10T16:00");
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      "16:00"
    );

    // The parent clearing back to empty keeps the control constructible.
    rerender({ value: undefined });
    expect(readHidden().value).toBe("");
    await pickDate(view, "15");
    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });
    expect(onValueChange).toHaveBeenLastCalledWith(
      `${target.toString()}T10:30`
    );
  });

  test("blocks optional submission while a date-only draft remains", async () => {
    const { form, onValueChange, view } = renderStateful();

    await pickDate(view, "15");

    expect(new FormData(form).get("startsAt")).toBe("");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(form.checkValidity()).toBe(false);
  });

  test("blocks optional submission while a time-only draft remains", () => {
    const { form, onValueChange, view } = renderStateful();

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });

    expect(new FormData(form).get("startsAt")).toBe("");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(form.checkValidity()).toBe(false);
  });

  test("keeps the prior committed draft visible while a partial draft blocks submission", async () => {
    const { form, onValueChange, readHidden, view } = renderStateful({
      defaultValue: "2099-06-10T16:00",
    });

    // Clearing only the date leaves a time-only draft: the untouched clock
    // keeps the committed time while the canonical field is emptied and
    // blocked; nothing partial can be saved.
    fireEvent.click(view.getByRole("button", { name: "Start date" }));
    fireEvent.click(
      await view.findByRole("button", { name: "Clear Start date" })
    );

    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      "16:00"
    );
    expect(new FormData(form).get("startsAt")).toBe("");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(form.checkValidity()).toBe(false);
    expect(readHidden().required).toBe(true);
  });

  test("validates unnamed required controls without naming them", () => {
    const view = render(
      <form aria-label="Bound form">
        <DateTimeInput
          dateLabel="Start date"
          id="startsAt"
          locale="en-US"
          required
          timeLabel="Start time"
        />
      </form>
    );
    const form = view.getByRole("form", {
      name: "Bound form",
    }) as HTMLFormElement;
    const canonical = form.querySelector<HTMLInputElement>(
      'input[type="datetime-local"]'
    )!;

    expect(canonical.name).toBe("");
    expect(canonical.required).toBe(true);
    expect(form.checkValidity()).toBe(false);
    expect(new FormData(form).get("startsAt")).toBeNull();

    // A valid time without a date still blocks an unnamed required control.
    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });
    expect(form.checkValidity()).toBe(false);
  });

  test("treats malformed and non-canonical prop values as empty", () => {
    const { form, view } = renderDateTimeInput({
      props: { value: "not-a-datetime" },
    });
    expect(new FormData(form).get("startsAt")).toBe("");

    view.rerender(
      <form aria-label="Bound form">
        <DateTimeInput
          dateLabel="Start date"
          locale="en-US"
          name="startsAt"
          timeLabel="Start time"
          value="2099-06-10T16:00:00"
        />
      </form>
    );
    expect(new FormData(form).get("startsAt")).toBe("");

    view.rerender(
      <form aria-label="Bound form">
        <DateTimeInput
          dateLabel="Start date"
          locale="en-US"
          name="startsAt"
          timeLabel="Start time"
          value="2099-06-10T99:99"
        />
      </form>
    );
    expect(new FormData(form).get("startsAt")).toBe("");
    expect(view.getByRole("button", { name: "Start date" }).textContent).toBe(
      "Pick a date"
    );
  });

  test("treats seconds-bearing values as empty instead of truncating to minutes", () => {
    const { form, readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00:30" },
    });

    expect(new FormData(form).get("startsAt")).toBe("");
    expect(readHidden()[0]!.value).toBe("");
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      ""
    );
  });

  test("anchors editor and canonical step sequence at the minimum across dates", async () => {
    const minimumDay = dayInCurrentMonth(10);
    const minimum = `${minimumDay.toString()}T09:30`;
    const { form, onChange, readHidden, view } = renderDateTimeInput({
      props: {
        defaultValue: minimum,
        minimum,
        timeStepMinutes: 60,
      },
    });

    await pickDate(view, "11");
    const laterDay = dayInCurrentMonth(11);
    // The complete date move emits on-sequence 09:30 for the later day.
    expect(onChange).toHaveBeenLastCalledWith(`${laterDay.toString()}T09:30`);
    const timeInput = view.getByLabelText("Start time");

    // Off-sequence relative to the 09:30 minimum anchor: the editor and the
    // canonical field must agree that 10:00 is a step mismatch even though
    // the same-day lower bound dropped out for the later date.
    onChange.mockClear();
    fireEvent.input(timeInput, { target: { value: "10:00" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("09:30");
    expect(readHidden()[0]!.value).toBe(`${laterDay.toString()}T09:30`);

    // On-sequence: accepted by the editor and valid on the canonical field.
    fireEvent.input(timeInput, { target: { value: "10:30" } });
    expect(onChange).toHaveBeenLastCalledWith(`${laterDay.toString()}T10:30`);
    expect(readHidden()[0]!.value).toBe(`${laterDay.toString()}T10:30`);
    expect(form.checkValidity()).toBe(true);
  });

  test("rejects a time edit whose draft date a dynamic minimum moved past without a rerender", () => {
    let minimum = "2099-06-10T09:30";
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: {
        defaultValue: "2099-06-10T16:00",
        minimum: () => minimum,
      },
    });
    const timeInput = view.getByLabelText("Start time");

    // The minimum advances to the next day while the selected date stays
    // June 10: the clock change would emit a stale-date datetime.
    minimum = "2099-06-11T09:30";
    fireEvent.input(timeInput, { target: { value: "18:00" } });

    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");
    expect(readHidden()[0]!.value).toBe("2099-06-10T16:00");
  });
  test("disables calendar days outside datetime-shaped bounds", async () => {
    const minimumDay = dayInCurrentMonth(5);
    const { view } = renderDateTimeInput({
      props: {
        defaultValue: `${dayInCurrentMonth(10).toString()}T16:00`,
        minimum: `${minimumDay.toString()}T09:30`,
      },
    });

    fireEvent.click(view.getByRole("button", { name: "Start date" }));
    await view.findByRole("grid");

    for (const day of [1, 2, 3, 4]) {
      expect(currentMonthGridDay(view, day)!.disabled).toBe(true);
    }
    expect(currentMonthGridDay(view, 6)!.disabled).toBe(false);
  });

  test("rejects a calendar day a datetime callback minimum advanced past without a rerender", async () => {
    const day10 = dayInCurrentMonth(10);
    const day13 = dayInCurrentMonth(13);
    let minimum = `${day10.toString()}T09:30`;
    const onChange = mock(() => undefined);
    const renderComposite = () => (
      <form aria-label="Bound form">
        <DateTimeInput
          dateLabel="Start date"
          defaultValue={`${day10.toString()}T16:00`}
          locale="en-US"
          minimum={() => minimum}
          name="startsAt"
          onChange={onChange}
          timeLabel="Start time"
        />
      </form>
    );
    const view = render(renderComposite());
    const readHidden = () =>
      [
        ...view.container.querySelectorAll<HTMLInputElement>(
          '[name="startsAt"]'
        ),
      ][0]!;

    fireEvent.click(view.getByRole("button", { name: "Start date" }));
    await view.findByRole("grid");
    expect(currentMonthGridDay(view, 12)!.disabled).toBe(false);

    // The minimum advances past day 12 while the calendar stays open: the
    // stale day click is rejected by the calendar's event-time bound check,
    // so nothing is emitted, the popover stays open instead of closing over
    // an accepted selection, and the displayed date never becomes the
    // rejected day.
    minimum = `${day13.toString()}T09:30`;
    fireEvent.click(currentMonthGridDay(view, 12)!);
    expect(onChange).not.toHaveBeenCalled();
    expect(view.queryByRole("grid")).not.toBeNull();
    expect(readHidden().value).toBe(`${day10.toString()}T16:00`);
    expect(
      view.getByRole("button", { name: "Start date" }).textContent
    ).toContain(day10.toLocaleString("en-US", { dateStyle: "long" }));

    // After a rerender the stale day renders disabled in the calendar: the
    // calendar reloads its day flags when the popover is reopened.
    view.rerender(renderComposite());
    fireEvent.keyDown(view.getByRole("button", { name: "Start date" }), {
      key: "Escape",
    });
    fireEvent.click(view.getByRole("button", { name: "Start date" }));
    await view.findByRole("grid");
    expect(currentMonthGridDay(view, 12)!.disabled).toBe(true);
  });

  test("anchors the step sequence at a freshly resolved callback minimum", async () => {
    const day10 = dayInCurrentMonth(10);
    let minimum = `${day10.toString()}T09:30`;
    const { form, onValueChange, readHidden, view } = renderStateful({
      defaultValue: `${day10.toString()}T09:30`,
      minimum: () => minimum,
      timeStepMinutes: 60,
    });
    const timeInput = view.getByLabelText("Start time");

    // The minimum advances 09:30 → 10:00 without a rerender: 11:00 is now
    // on-sequence and must be accepted.
    minimum = `${day10.toString()}T10:00`;
    fireEvent.input(timeInput, { target: { value: "11:00" } });
    expect(onValueChange).toHaveBeenLastCalledWith(`${day10.toString()}T11:00`);
    expect(readHidden().value).toBe(`${day10.toString()}T11:00`);
    expect(form.checkValidity()).toBe(true);

    // 11:30 is 90 minutes past the fresh 10:00 anchor: off-sequence, so the
    // editor rejects it and the emitted value stays step-aligned.
    fireEvent.input(timeInput, { target: { value: "11:30" } });
    expect(onValueChange).not.toHaveBeenCalledTimes(2);
    expect((timeInput as HTMLInputElement).value).toBe("11:00");
    expect(readHidden().value).toBe(`${day10.toString()}T11:00`);
    expect(form.checkValidity()).toBe(true);
  });

  test("restores the committed parts when a controlled parent rejects a completed edit", async () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: { value: "2099-06-10T16:00" },
    });
    const trigger = view.getByRole("button", { name: "Start date" });

    await pickDate(view, "15");

    expect(onChange).toHaveBeenCalledWith(
      `${dayInCurrentMonth(15).toString()}T16:00`
    );
    // The parent never adopted the edit: both interactive controls show the
    // authoritative committed parts and the named field keeps the old value.
    expect(trigger.textContent).toContain("June 10, 2099");
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      "16:00"
    );
    expect(readHidden()[0]!.value).toBe("2099-06-10T16:00");
  });

  test("restores the empty controlled state when the parent rejects a completed edit", async () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: { value: "" },
    });

    await pickDate(view, "15");
    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });

    expect(onChange).toHaveBeenCalledWith(
      `${dayInCurrentMonth(15).toString()}T10:30`
    );
    expect(view.getByRole("button", { name: "Start date" }).textContent).toBe(
      "Pick a date"
    );
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      ""
    );
    expect(readHidden()[0]!.value).toBe("");
  });

  test("renders exactly one named submit field and both controls", () => {
    const { readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00" },
    });

    expect(readHidden()).toHaveLength(1);
    expect(readHidden()[0].getAttribute("type")).toBe("datetime-local");
    expect(readHidden()[0].value).toBe("2099-06-10T16:00");
    expect(view.getByRole("button", { name: "Start date" })).toBeDefined();
    expect(view.getByLabelText("Start time")).toBeDefined();
    expect(
      view.baseElement.querySelectorAll(
        'input[type="time"]:not([aria-hidden="true"])'
      )
    ).toHaveLength(1);
  });

  test("renders no submit field when unnamed", () => {
    const { form } = renderDateTimeInput({ withName: false });

    expect(
      form.querySelectorAll<HTMLInputElement>('[name="startsAt"]')
    ).toHaveLength(0);
  });

  test("submits a complete canonical datetime through FormData", async () => {
    const target = dayInCurrentMonth(15);
    const { form, onChange, readHidden, view } = renderDateTimeInput();

    expect(new FormData(form).get("startsAt")).toBe("");

    await pickDate(view, "15");
    expect(readHidden()[0].value).toBe("");
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });

    const complete = `${target.toString()}T10:30`;
    expect(readHidden()[0].value).toBe(complete);
    expect(new FormData(form).get("startsAt")).toBe(complete);
    expect(onChange).toHaveBeenCalledWith(complete);
  });

  test("required blocks submission while incomplete", async () => {
    const { form, view } = renderDateTimeInput({ props: { required: true } });

    expect(
      (
        form.querySelector<HTMLInputElement>(
          '[name="startsAt"]'
        ) as HTMLInputElement
      ).required
    ).toBe(true);
    expect(form.checkValidity()).toBe(false);

    await pickDate(view, "15");
    expect(form.checkValidity()).toBe(false);

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });
    expect(form.checkValidity()).toBe(true);
  });

  test("passes date and same-day time bounds down", () => {
    const { readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00", minimum: "2099-06-10T15:00" },
    });

    expect(readHidden()[0].getAttribute("min")).toBe("2099-06-10T15:00");
    const timeInput = view.getByLabelText("Start time");
    expect(timeInput.getAttribute("min")).toBeNull();
    const dateTrigger = view.getByRole("button", { name: "Start date" });
    expect(dateTrigger).toBeDefined();
  });

  test("rejects same-day times before the minimum", () => {
    const { onChange, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00", minimum: "2099-06-10T15:00" },
    });
    const timeInput = view.getByLabelText("Start time");

    fireEvent.input(timeInput, { target: { value: "14:00" } });

    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");
  });

  test("controlled value ignores edits until rerendered", () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: { value: "2099-06-10T16:00" },
    });

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "17:30" },
    });
    expect(onChange).toHaveBeenCalledWith("2099-06-10T17:30");
    expect(readHidden()[0].value).toBe("2099-06-10T16:00");

    view.rerender(
      <form aria-label="Bound form">
        <DateTimeInput
          dateLabel="Start date"
          locale="en-US"
          name="startsAt"
          onChange={onChange}
          timeLabel="Start time"
          value="2099-06-10T17:30"
        />
      </form>
    );
    expect(readHidden()[0].value).toBe("2099-06-10T17:30");
  });

  test("returns to the default when the form resets", async () => {
    const { form, readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00" },
    });

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "18:00" },
    });
    expect(readHidden()[0].value).toBe("2099-06-10T18:00");

    act(() => {
      form.reset();
    });

    expect(readHidden()[0].value).toBe("2099-06-10T16:00");
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      "16:00"
    );
  });

  test("clears the time to an incomplete state without emitting a value", () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00" },
    });

    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "" },
    });

    expect(readHidden()[0].value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      ""
    );
  });

  test("keeps a controlled-empty parent authoritative across an edit", async () => {
    const target = dayInCurrentMonth(15);
    // The parent holds value="" and rejects the edit by never adopting the
    // reported change.
    const { form, onChange, readHidden, view } = renderDateTimeInput({
      props: { value: "" },
    });

    await pickDate(view, "15");
    fireEvent.input(view.getByLabelText("Start time"), {
      target: { value: "10:30" },
    });

    expect(onChange).toHaveBeenCalledWith(`${target.toString()}T10:30`);
    // The parent never adopted the edit: the submit field and internal
    // committed state keep the controlled empty value.
    expect(new FormData(form).get("startsAt")).toBe("");
    expect(readHidden()[0]!.value).toBe("");
  });

  test("explicit empty controlled value overrides a non-empty default", () => {
    const { form, readHidden, view } = renderDateTimeInput({
      props: { defaultValue: "2099-06-10T16:00", value: "" },
    });

    expect(new FormData(form).get("startsAt")).toBe("");
    expect(readHidden()[0]!.value).toBe("");
    expect(view.getByRole("button", { name: "Start date" }).textContent).toBe(
      "Pick a date"
    );
    expect((view.getByLabelText("Start time") as HTMLInputElement).value).toBe(
      ""
    );
  });

  test("applies time steps", () => {
    const { onChange, readHidden, view } = renderDateTimeInput({
      props: {
        defaultValue: "2099-06-10T16:00",
        timeStepMinutes: 60,
      },
    });
    const timeInput = view.getByLabelText("Start time");

    expect(readHidden()[0].getAttribute("step")).toBe("3600");
    fireEvent.input(timeInput, { target: { value: "17:30" } });
    expect(onChange).not.toHaveBeenCalled();
    expect((timeInput as HTMLInputElement).value).toBe("16:00");
  });
});
