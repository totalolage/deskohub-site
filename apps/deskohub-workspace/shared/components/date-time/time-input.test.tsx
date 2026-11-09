import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import "@/shared/polyfills/temporal";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { TimeInputProps } from "./time-input";

// React DOM detects input events when it loads, so the DOM must exist first.
registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { TimeInput } = await import("./time-input");
const { typeTimeAsBrowsers } = await import("./time-input.test-utils");

const timeLabel = "Start time";
const en = { locale: "en-US" } as const;

/** The texts that describe a field, through its aria-describedby ids. */
const describedText = (field: HTMLElement) =>
  (field.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const renderInForm = (props: Partial<TimeInputProps> = {}) => {
  const onSubmit = mock((_data: FormData) => undefined);
  const view = render(
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(new FormData(event.currentTarget));
      }}
    >
      <TimeInput label={timeLabel} locale="en-US" name="time" {...props} />
      <button type="button">Elsewhere</button>
    </form>
  );
  const form = view.container.querySelector("form") as HTMLFormElement;
  const editor = view.getByLabelText(timeLabel) as HTMLInputElement;
  const submitted = () => new FormData(form).getAll("time");
  const typeTime = (value: string) =>
    fireEvent.input(editor, { target: { value } });
  return { editor, form, onSubmit, submitted, typeTime, view };
};

/** Makes the editor report an unfinished segmented edit, as browsers do. */
const markUnfinished = (editor: HTMLInputElement, unfinished: boolean) =>
  Object.defineProperty(editor, "validity", {
    configurable: true,
    value: { ...editor.validity, badInput: unfinished, valid: !unfinished },
  });

describe("TimeInput", () => {
  test("submits one canonical time when uncontrolled and resets to its default", () => {
    const onChange = mock((_value: string) => undefined);
    const { editor, form, submitted, typeTime } = renderInForm({
      defaultValue: "09:00",
      onChange,
    });

    expect(editor.value).toBe("09:00");
    expect(submitted()).toEqual(["09:00"]);

    typeTime("10:15");
    expect(onChange).toHaveBeenLastCalledWith("10:15");
    expect(submitted()).toEqual(["10:15"]);

    act(() => form.reset());
    expect(editor.value).toBe("09:00");
    expect(submitted()).toEqual(["09:00"]);
  });

  test("follows a controlled value and keeps it when the parent rejects an edit", () => {
    const onChange = mock((_value: string) => undefined);
    const { editor, submitted, typeTime, view } = renderInForm({
      onChange,
      value: "09:00",
    });

    typeTime("10:00");
    expect(onChange).toHaveBeenLastCalledWith("10:00");
    // The parent did not take it: the value stays and the edit goes back.
    expect(submitted()).toEqual(["09:00"]);
    fireEvent.blur(editor);
    expect(editor.value).toBe("09:00");

    view.rerender(
      <form>
        <TimeInput label={timeLabel} name="time" value="11:00" />
      </form>
    );
    expect(editor.value).toBe("11:00");
  });

  test("clears to an empty value", () => {
    const onChange = mock((_value: string) => undefined);
    const { submitted, typeTime } = renderInForm({
      defaultValue: "09:00",
      onChange,
    });

    typeTime("");

    expect(onChange).toHaveBeenLastCalledWith("");
    expect(submitted()).toEqual([""]);
  });

  test("takes only times inside the bounds and on the step", () => {
    const onChange = mock((_value: string) => undefined);
    // Function bounds are read at each edit, so they can move after render.
    let minimum = "09:30";
    let maximum = "23:00";
    const { editor, submitted, typeTime } = renderInForm({
      defaultValue: "12:00",
      maximum: () => maximum,
      minimum: () => minimum,
      onChange,
      stepMinutes: 60,
    });

    // The editor counts steps from its minimum, so it starts on the hour.
    expect(editor.min).toBe("10:00");
    expect(editor.max).toBe("23:00");
    expect(editor.step).toBe("3600");

    minimum = "11:00";
    maximum = "17:00";
    for (const rejected of ["10:30", "10:00", "18:00"]) {
      typeTime(rejected);
      expect({ rejected, value: submitted() }).toEqual({
        rejected,
        value: ["12:00"],
      });
    }
    expect(onChange).not.toHaveBeenCalled();
    // A rejected time stays on screen, even once the field loses focus.
    expect(editor.value).toBe("18:00");
    fireEvent.blur(editor);
    expect(editor.value).toBe("18:00");
    expect(submitted()).toEqual([""]);

    typeTime("17:00");
    expect(onChange).toHaveBeenLastCalledWith("17:00");
  });

  test("keeps an unfinished edit without a value until it is finished", () => {
    const onBlur = mock(() => undefined);
    const onChange = mock((_value: string) => undefined);
    const { editor, form, onSubmit, submitted, typeTime } = renderInForm({
      defaultValue: "09:00",
      onBlur,
      onChange,
    });

    markUnfinished(editor, true);
    typeTime("");
    expect(onChange).not.toHaveBeenCalled();
    expect(submitted()).toEqual(["09:00"]);

    // The form doesn't submit while the editor shows the unfinished edit.
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement === editor).toBe(true);
    expect(editor.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(editor)).toContain(m.timeInputIncomplete({}, en));

    fireEvent.blur(editor);
    expect(onBlur).toHaveBeenCalledTimes(1);

    markUnfinished(editor, false);
    typeTime("09:00");
    expect(editor.getAttribute("aria-invalid")).toBe("false");
    fireEvent.submit(form);
    expect(onSubmit.mock.calls[0]?.[0].getAll("time")).toEqual(["09:00"]);
  });

  test("blocks submission while a rejected time is on screen", () => {
    const { editor, form, onSubmit, typeTime } = renderInForm({
      defaultValue: "09:00",
      stepMinutes: 30,
    });

    typeTime("09:10");
    fireEvent.submit(form);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement === editor).toBe(true);
    expect(editor.getAttribute("aria-invalid")).toBe("true");
    expect(describedText(editor)).toContain(m.timeInputUnavailable({}, en));

    typeTime("09:30");
    expect(editor.getAttribute("aria-invalid")).toBe("false");
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // Pressing a submit button moves focus out of the field before the form
  // submits, so leaving the field must not swap the entry for the old time.
  for (const [bound, rejected] of [
    ["before the minimum", "10:00"],
    ["after the maximum", "18:00"],
  ] as const) {
    test(`keeps a time ${bound} on screen after blur, without a value, and blocks submission`, async () => {
      const onChange = mock((_value: string) => undefined);
      const { editor, form, onSubmit, submitted } = renderInForm({
        defaultValue: "12:00",
        maximum: "17:00",
        minimum: "11:00",
        onChange,
      });

      await typeTimeAsBrowsers(editor, rejected);
      fireEvent.blur(editor);

      expect(editor.value).toBe(rejected);
      expect(submitted()).toEqual([""]);
      expect(onChange).toHaveBeenLastCalledWith("");
      expect(editor.getAttribute("aria-invalid")).toBe("true");

      fireEvent.submit(form);
      expect(onSubmit).not.toHaveBeenCalled();
      expect(document.activeElement === editor).toBe(true);

      await typeTimeAsBrowsers(editor, "12:00");
      expect(editor.getAttribute("aria-invalid")).toBe("false");
      fireEvent.submit(form);
      expect(onSubmit.mock.calls[0]?.[0].getAll("time")).toEqual(["12:00"]);
    });
  }

  test("keeps an unfinished edit on screen after blur, without a value, and blocks submission", () => {
    const { editor, form, onSubmit, submitted, typeTime } = renderInForm({
      defaultValue: "09:00",
    });

    markUnfinished(editor, true);
    typeTime("");
    fireEvent.blur(editor);

    expect(submitted()).toEqual([""]);
    expect(editor.getAttribute("aria-invalid")).toBe("true");
    fireEvent.submit(form);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement === editor).toBe(true);
  });

  test("a value set from outside drops a kept edit's problem for good", async () => {
    const onSubmit = mock((_data: FormData) => undefined);
    function Controlled() {
      const [value, setValue] = useState("12:00");
      return (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(new FormData(event.currentTarget));
          }}
        >
          <TimeInput
            label={timeLabel}
            minimum="11:00"
            name="time"
            onChange={setValue}
            value={value}
          />
          <button onClick={() => setValue("15:00")} type="button">
            Pick
          </button>
          <button onClick={() => setValue("")} type="button">
            Clear
          </button>
        </form>
      );
    }
    const view = render(<Controlled />);
    const editor = view.getByLabelText(timeLabel) as HTMLInputElement;

    await typeTimeAsBrowsers(editor, "10:00");
    fireEvent.blur(editor);
    expect(editor.getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(view.getByRole("button", { name: "Pick" }));
    expect(editor.value).toBe("15:00");
    fireEvent.click(view.getByRole("button", { name: "Clear" }));
    expect(editor.getAttribute("aria-invalid")).toBe("false");
    fireEvent.submit(view.container.querySelector("form") as HTMLFormElement);
    expect(onSubmit.mock.calls[0]?.[0].getAll("time")).toEqual([""]);
  });

  test("blocks submission of a prefilled time that the bounds no longer allow", () => {
    let minimum = "08:00";
    const { editor, form, onSubmit } = renderInForm({
      defaultValue: "08:00",
      minimum: () => minimum,
    });

    minimum = "09:00";
    fireEvent.submit(form);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement === editor).toBe(true);
    expect(describedText(editor)).toContain(m.timeInputUnavailable({}, en));
  });

  test("a changed value replaces an unfinished edit", () => {
    const { editor, view } = renderInForm({ value: "09:00" });

    markUnfinished(editor, true);
    fireEvent.input(editor, { target: { value: "" } });
    view.rerender(
      <form>
        <TimeInput label={timeLabel} name="time" value="11:00" />
      </form>
    );

    expect(editor.value).toBe("11:00");
  });

  test("passes disabled, required, and the owner's error state to the editor", () => {
    const { editor, submitted, view } = renderInForm({
      "aria-describedby": "owner-message",
      "aria-invalid": true,
      defaultValue: "09:00",
      required: true,
    });

    expect(editor.required).toBe(true);
    expect(editor.getAttribute("aria-invalid")).toBe("true");
    expect(editor.getAttribute("aria-describedby")).toBe("owner-message");

    view.rerender(
      <form>
        <TimeInput
          defaultValue="09:00"
          disabled
          label={timeLabel}
          name="time"
        />
      </form>
    );
    expect(editor.disabled).toBe(true);
    expect(editor.getAttribute("aria-invalid")).toBe("false");
    expect(submitted()).toEqual([]);
  });

  test("takes its name from a visible label when one is given", () => {
    const view = render(
      <>
        <span id="visible-time-label">Opening time</span>
        <TimeInput aria-labelledby="visible-time-label" label={timeLabel} />
      </>
    );

    const editor = view.getByLabelText("Opening time");
    expect(editor.hasAttribute("aria-label")).toBe(false);
  });

  test("shows an empty field for a value that is no canonical time", () => {
    const { editor, submitted } = renderInForm({ value: "9:00:30" });

    expect(editor.value).toBe("");
    expect(submitted()).toEqual([""]);
  });
});

describe("TimeInput as a controlled field", () => {
  test("a parent that takes edits stays in step with the editor", () => {
    function Controlled() {
      const [value, setValue] = useState("08:00");
      return (
        <>
          <TimeInput label={timeLabel} onChange={setValue} value={value} />
          <output>{value}</output>
        </>
      );
    }
    const view = render(<Controlled />);
    const editor = view.getByLabelText(timeLabel) as HTMLInputElement;

    fireEvent.input(editor, { target: { value: "08:45" } });

    expect(view.container.querySelector("output")?.textContent).toBe("08:45");
    expect(editor.value).toBe("08:45");
  });
});
