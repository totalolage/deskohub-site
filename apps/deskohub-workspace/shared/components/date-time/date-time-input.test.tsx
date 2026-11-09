import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import "@/shared/polyfills/temporal";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { DateTimeInputProps } from "./date-time-input";

// React DOM detects input events and Radix picks its layout-effect hook when
// they load, so the DOM must exist before either is imported.
registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { DateTimeInput } = await import("./date-time-input");
const { typeTimeAsBrowsers } = await import("./time-input.test-utils");

const dateLabel = "Valid from";
const timeLabel = "Valid from time";
const en = { locale: "en-US" } as const;

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const renderInForm = (props: Partial<DateTimeInputProps> = {}) => {
  const onSubmit = mock((_data: FormData) => undefined);
  const onChange = mock((_value: string) => undefined);
  const onPartialDraftChange = mock((_isPartial: boolean) => undefined);
  const view = render(
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      <DateTimeInput
        dateLabel={dateLabel}
        id="valid-from"
        locale="en-US"
        name="validFrom"
        onChange={onChange}
        onPartialDraftChange={onPartialDraftChange}
        timeLabel={timeLabel}
        {...props}
      />
    </form>
  );
  const form = view.container.querySelector("form") as HTMLFormElement;
  const dateField = view.getByRole("combobox") as HTMLInputElement;
  const timeField = view.getByLabelText(timeLabel) as HTMLInputElement;
  const submitted = () => new FormData(form).getAll("validFrom");
  const typeDate = (text: string) => {
    fireEvent.change(dateField, { target: { value: text } });
    fireEvent.focusOut(dateField);
  };
  const typeTime = (value: string) =>
    fireEvent.input(timeField, { target: { value } });
  const describedText = (field: HTMLElement) =>
    (field.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
  return {
    dateField,
    describedText,
    form,
    onChange,
    onPartialDraftChange,
    onSubmit,
    submitted,
    timeField,
    typeDate,
    typeTime,
    view,
  };
};

describe("DateTimeInput", () => {
  test("submits one canonical date-time when uncontrolled and resets to its default", () => {
    const { dateField, form, onChange, submitted, timeField, typeDate } =
      renderInForm({ defaultValue: "2099-06-10T09:00" });

    expect(dateField.value).toBe("6/10/2099");
    expect(timeField.value).toBe("09:00");
    expect(submitted()).toEqual(["2099-06-10T09:00"]);

    typeDate("6/12/2099");
    expect(onChange).toHaveBeenLastCalledWith("2099-06-12T09:00");
    expect(submitted()).toEqual(["2099-06-12T09:00"]);

    act(() => form.reset());
    expect(dateField.value).toBe("6/10/2099");
    expect(timeField.value).toBe("09:00");
    expect(submitted()).toEqual(["2099-06-10T09:00"]);
  });

  test("follows a controlled value", () => {
    function Controlled() {
      const [value, setValue] = useState("2099-06-10T09:00");
      return (
        <form>
          <DateTimeInput
            dateLabel={dateLabel}
            locale="en-US"
            name="validFrom"
            onChange={setValue}
            timeLabel={timeLabel}
            value={value}
          />
          <output>{value}</output>
          <button onClick={() => setValue("2099-07-01T18:00")} type="button">
            Restore
          </button>
        </form>
      );
    }
    const view = render(<Controlled />);
    const timeField = view.getByLabelText(timeLabel) as HTMLInputElement;
    const output = () => view.container.querySelector("output")?.textContent;

    fireEvent.input(timeField, { target: { value: "10:30" } });
    expect(output()).toBe("2099-06-10T10:30");

    fireEvent.click(view.getByRole("button", { name: "Restore" }));
    expect((view.getByRole("combobox") as HTMLInputElement).value).toBe(
      "7/1/2099"
    );
    expect(timeField.value).toBe("18:00");
  });

  test("never submits half a value: a date alone blocks the form until a time completes it", () => {
    const {
      describedText,
      form,
      onChange,
      onPartialDraftChange,
      onSubmit,
      submitted,
      timeField,
      typeDate,
      typeTime,
    } = renderInForm();

    typeDate("6/10/2099");
    expect(onChange).not.toHaveBeenCalled();
    expect(onPartialDraftChange).toHaveBeenLastCalledWith(true);
    expect(submitted()).toEqual([""]);

    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement === timeField).toBe(true);
    expect(timeField.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(timeField)).toContain(
      m.dateTimeInputIncomplete({}, en)
    );

    typeTime("14:00");
    expect(onChange).toHaveBeenLastCalledWith("2099-06-10T14:00");
    expect(onPartialDraftChange).toHaveBeenLastCalledWith(false);
    // Finishing the draft takes its error away.
    expect(timeField.getAttribute("aria-invalid")).toBe("false");
    expect(describedText(timeField)).not.toContain(
      m.dateTimeInputIncomplete({}, en)
    );

    fireEvent.submit(form);
    expect(onSubmit.mock.calls[0]?.[0].getAll("validFrom")).toEqual([
      "2099-06-10T14:00",
    ]);
  });

  test("a time alone blocks the form and sends focus to the date", () => {
    const { dateField, form, onSubmit, submitted, typeTime } = renderInForm();

    typeTime("14:00");
    expect(submitted()).toEqual([""]);

    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement === dateField).toBe(true);
  });

  test("keeps the committed value while a partial draft is on screen", () => {
    const { onChange, submitted, typeTime } = renderInForm({
      defaultValue: "2099-06-10T09:00",
    });

    typeTime("");

    // The time was cleared but the date stays: the field submits nothing.
    expect(onChange).not.toHaveBeenCalled();
    expect(submitted()).toEqual([""]);
  });

  test("clearing the date clears the whole value", () => {
    const { onChange, onSubmit, form, submitted, timeField, typeDate } =
      renderInForm({ defaultValue: "2099-06-10T09:00" });

    typeDate("");

    expect(onChange).toHaveBeenLastCalledWith("");
    expect(timeField.value).toBe("");
    expect(submitted()).toEqual([""]);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("a default time completes the value from a date alone", () => {
    const { onChange, onPartialDraftChange, timeField, typeDate, typeTime } =
      renderInForm({ defaultTime: "08:00" });

    expect(timeField.value).toBe("08:00");
    // A time chosen before the date is no partial draft with a default time.
    typeTime("09:00");
    expect(onPartialDraftChange).not.toHaveBeenCalled();

    typeDate("6/10/2099");
    expect(onChange).toHaveBeenLastCalledWith("2099-06-10T09:00");
  });

  test("moves a time before the minimum's time up to it on the minimum's day", () => {
    const { onChange, timeField, typeDate } = renderInForm({
      defaultTime: "08:00",
      minimum: () => "2099-06-10T09:30",
      stepMinutes: 60,
    });

    typeDate("6/10/2099");
    expect(onChange).toHaveBeenLastCalledWith("2099-06-10T10:00");
    expect(timeField.min).toBe("10:00");

    typeDate("6/11/2099");
    expect(onChange).toHaveBeenLastCalledWith("2099-06-11T10:00");
    expect(timeField.min).toBe("");

    typeDate("6/9/2099");
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  test("names each field and wires the owner's description to both", () => {
    const view = render(
      <>
        <span id="visible-label">Starts</span>
        <DateTimeInput
          aria-describedby="owner-message"
          aria-invalid
          aria-labelledby="visible-label"
          dateLabel={dateLabel}
          id="starts"
          locale="en-US"
          required
          timeLabel={timeLabel}
        />
      </>
    );
    const dateField = view.getByRole("combobox", { name: "Starts" });
    const timeField = view.getByLabelText(timeLabel);

    expect(dateField.id).toBe("starts");
    expect(timeField.id).toBe("starts-time");
    for (const field of [dateField, timeField]) {
      expect(field.getAttribute("aria-invalid")).toBe("true");
      expect(
        (field.getAttribute("aria-describedby") ?? "").split(" ")
      ).toContain("owner-message");
      expect((field as HTMLInputElement).required).toBe(true);
    }
  });

  test("submits nothing while disabled", () => {
    const { dateField, submitted, timeField } = renderInForm({
      defaultValue: "2099-06-10T09:00",
      disabled: true,
    });

    expect(dateField.disabled).toBe(true);
    expect(timeField.disabled).toBe(true);
    expect(submitted()).toEqual([]);
  });

  test("shows empty fields for a value with seconds", () => {
    const { dateField, submitted, timeField } = renderInForm({
      value: "2099-06-10T09:00:30",
    });

    expect(dateField.value).toBe("");
    expect(timeField.value).toBe("");
    expect(submitted()).toEqual([""]);
  });

  test("a restored value replaces a blocked partial draft and its error", () => {
    const onPartialDraftChange = mock((_isPartial: boolean) => undefined);
    const onSubmit = mock(() => undefined);
    function Controlled() {
      const [value, setValue] = useState("");
      return (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DateTimeInput
            dateLabel={dateLabel}
            locale="en-US"
            name="validFrom"
            onChange={setValue}
            onPartialDraftChange={onPartialDraftChange}
            timeLabel={timeLabel}
            value={value}
          />
          <button onClick={() => setValue("2099-07-01T18:00")} type="button">
            Restore
          </button>
        </form>
      );
    }
    const view = render(<Controlled />);
    const dateField = view.getByRole("combobox") as HTMLInputElement;
    const timeField = view.getByLabelText(timeLabel) as HTMLInputElement;

    fireEvent.change(dateField, { target: { value: "6/10/2099" } });
    fireEvent.focusOut(dateField);
    fireEvent.submit(view.container.querySelector("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(timeField.getAttribute("aria-invalid")).toBe("true");
    expect(onPartialDraftChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(view.getByRole("button", { name: "Restore" }));
    expect(timeField.value).toBe("18:00");
    expect(timeField.getAttribute("aria-invalid")).toBe("false");
    expect(onPartialDraftChange).toHaveBeenLastCalledWith(false);
  });

  // Pressing a submit button moves focus out of the time field before the
  // form submits.
  for (const [bound, rejected] of [
    ["before the minimum", "07:00"],
    ["after the maximum", "21:00"],
  ] as const) {
    test(`keeps a time ${bound} on screen after blur and submits no value`, async () => {
      const { form, onSubmit, submitted, timeField } = renderInForm({
        defaultValue: "2099-06-10T16:00",
        maximum: "2099-06-10T20:00",
        minimum: "2099-06-10T16:00",
        stepMinutes: 60,
      });

      await typeTimeAsBrowsers(timeField, rejected);
      fireEvent.blur(timeField);

      expect(timeField.value).toBe(rejected);
      expect(submitted()).toEqual([""]);
      expect(timeField.getAttribute("aria-invalid")).toBe("true");

      fireEvent.submit(form);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(document.activeElement === timeField).toBe(true);

      await typeTimeAsBrowsers(timeField, "18:00");
      fireEvent.submit(form);
      expect(onSubmit.mock.calls[0]?.[0].getAll("validFrom")).toEqual([
        "2099-06-10T18:00",
      ]);
    });
  }

  test("clearing the date drops a time kept on screen", async () => {
    const { form, onSubmit, timeField, typeDate, view } = renderInForm({
      defaultValue: "2099-06-10T16:00",
      minimum: "2099-06-10T16:00",
    });

    await typeTimeAsBrowsers(timeField, "07:00");
    fireEvent.blur(timeField);
    typeDate("");

    const clearedTime = view.getByLabelText(timeLabel) as HTMLInputElement;
    expect(clearedTime.value).toBe("");
    expect(clearedTime.getAttribute("aria-invalid")).toBe("false");
    fireEvent.submit(form);
    expect(onSubmit.mock.calls[0]?.[0].getAll("validFrom")).toEqual([""]);
  });

  test("a form reset drops a partial draft", () => {
    const { form, onPartialDraftChange, submitted, timeField, typeDate } =
      renderInForm({ defaultValue: "2099-06-10T09:00" });

    typeDate("6/12/2099");
    fireEvent.input(timeField, { target: { value: "" } });
    expect(onPartialDraftChange).toHaveBeenLastCalledWith(true);

    act(() => form.reset());
    expect(onPartialDraftChange).toHaveBeenLastCalledWith(false);
    expect(timeField.value).toBe("09:00");
    expect(submitted()).toEqual(["2099-06-10T09:00"]);
  });
});
