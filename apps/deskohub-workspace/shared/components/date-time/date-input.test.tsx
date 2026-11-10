import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import "@/shared/polyfills/temporal";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { DateInputProps } from "./date-input";

const dateLabel = "Reservation date";
const en = { locale: "en-US" } as const;
const cs = { locale: "cs-CZ" } as const;
const calendarButtonLabel = m.dateInputCalendarButtonLabel(
  { field: dateLabel },
  en
);
// The numeric formats are the field's input syntax, not prose.
const enFormatParts = { format: "MM/DD/YYYY", isoFormat: "YYYY-MM-DD" };
const csFormatParts = { format: "DD. MM. RRRR", isoFormat: "RRRR-MM-DD" };
const enFormat = m.dateInputFormat(enFormatParts, en);

// React DOM detects input events and Radix picks its layout-effect hook when
// they load, so the DOM must exist before either is imported.
registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { DateInput } = await import("./date-input");

function ControlledPicker({
  initialValue = "",
  onValue,
  ...props
}: Partial<DateInputProps> & {
  readonly initialValue?: string;
  readonly onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <DateInput
      label={dateLabel}
      locale="en-US"
      name="date"
      onChange={(nextValue) => {
        setValue(nextValue);
        onValue?.(nextValue);
      }}
      value={value}
      {...props}
    />
  );
}

const renderPicker = (props: Parameters<typeof ControlledPicker>[0] = {}) => {
  const onValue = mock((_value: string) => undefined);
  const onBlur = mock(() => undefined);
  const view = render(
    <ControlledPicker onBlur={onBlur} onValue={onValue} {...props} />
  );
  const input = view.getByRole("combobox") as HTMLInputElement;
  const hiddenInput = () =>
    view.container.querySelector<HTMLInputElement>('input[name="date"]')?.value;
  const typeDate = (text: string) => {
    fireEvent.change(input, { target: { value: text } });
    fireEvent.focusOut(input);
  };
  const description = () =>
    (input.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .filter(Boolean)
      .join(" ");

  return { description, hiddenInput, input, onBlur, onValue, typeDate, view };
};

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

describe("DateInput typed date", () => {
  afterEach(() => {
    cleanup();
  });

  test("labels the text field and describes its formats", () => {
    const { description, input, view } = renderPicker({ required: true });

    expect(input.getAttribute("aria-label")).toBe("Reservation date");
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-haspopup")).toBe("dialog");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.placeholder).toBe("MM/DD/YYYY");
    expect(description()).toBe(enFormat);
    expect(
      view.getByRole("button", {
        name: calendarButtonLabel,
      })
    ).not.toBeNull();
  });

  test("takes its name from a visible label when one is given", () => {
    const view = render(
      <>
        <span id="visible-label">Office reservation start date</span>
        <DateInput
          label="Office reservation start date"
          aria-labelledby="visible-label"
          required
          locale="en-US"
          value="2099-06-10"
        />
      </>
    );
    const input = view.getByRole("combobox", {
      name: "Office reservation start date",
    }) as HTMLInputElement;

    expect(input.hasAttribute("aria-label")).toBe(false);
    expect(input.required).toBe(true);
  });

  test("prefills the text field from an initial or restored value", () => {
    const view = render(
      <DateInput label="Reservation date" locale="en-US" value="2099-06-10" />
    );
    const input = view.getByRole("combobox") as HTMLInputElement;

    expect(input.value).toBe("6/10/2099");
    expect(view.getByText("June 10, 2099")).not.toBeNull();

    view.rerender(
      <DateInput label="Reservation date" locale="en-US" value="2099-07-01" />
    );
    expect(input.value).toBe("7/1/2099");
  });

  test("prefills the text field in the Czech numeric form", () => {
    const { input } = renderPicker({
      initialValue: "2099-06-10",
      locale: "cs-CZ",
    });

    expect(input.value).toBe("10. 6. 2099");
    expect(input.placeholder).toBe("DD. MM. RRRR");
  });

  test("accepts a typed ISO date", () => {
    const { hiddenInput, input, onBlur, onValue, typeDate } = renderPicker();

    typeDate("2099-06-12");

    expect(onValue).toHaveBeenLastCalledWith("2099-06-12");
    expect(hiddenInput()).toBe("2099-06-12");
    expect(input.value).toBe("6/12/2099");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(onBlur).toHaveBeenCalled();
  });

  test("accepts a typed en-US date", () => {
    const { hiddenInput, typeDate } = renderPicker();

    typeDate("6/12/2099");

    expect(hiddenInput()).toBe("2099-06-12");
  });

  test("accepts a typed cs-CZ date with or without spaces", () => {
    const { hiddenInput, input, typeDate } = renderPicker({ locale: "cs-CZ" });

    typeDate("12.6.2099");
    expect(hiddenInput()).toBe("2099-06-12");
    expect(input.value).toBe("12. 6. 2099");

    typeDate("3. 7. 2099");
    expect(hiddenInput()).toBe("2099-07-03");
  });

  test("clears the date when the text is emptied", () => {
    const { hiddenInput, input, onBlur, onValue, typeDate } = renderPicker({
      initialValue: "2099-06-10",
    });

    typeDate("  ");

    expect(onValue).toHaveBeenLastCalledWith("");
    expect(hiddenInput()).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("keeps an available prefilled date when its text is left unchanged", () => {
    const { hiddenInput, input, onBlur, onValue } = renderPicker({
      initialValue: "2099-06-10",
      minimum: "2099-06-01",
    });

    fireEvent.focusOut(input);

    expect(onValue).not.toHaveBeenCalled();
    expect(hiddenInput()).toBe("2099-06-10");
    expect(input.value).toBe("6/10/2099");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  test("commits typed text on Enter, before the form submits", () => {
    const { hiddenInput, input, onValue } = renderPicker();

    fireEvent.change(input, { target: { value: "6/14/2099" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onValue).toHaveBeenLastCalledWith("2099-06-14");
    expect(hiddenInput()).toBe("2099-06-14");
  });

  test("rejects a disabled date with an inline error and clears the value", () => {
    const { description, hiddenInput, input, onBlur, onValue, typeDate } =
      renderPicker({
        initialValue: "2099-06-10",
        isDateDisabled: (date) => date.toString() === "2099-06-12",
      });

    typeDate("6/12/2099");

    expect(onValue).toHaveBeenLastCalledWith("");
    expect(hiddenInput()).toBe("");
    expect(input.value).toBe("6/12/2099");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description()).toBe(
      `${enFormat} ${m.dateInputUnavailable({ date: "June 12, 2099" }, en)}`
    );
    // The error is the field's feedback; form validation waits for a date.
    expect(onBlur).not.toHaveBeenCalled();

    typeDate("6/13/2099");
    expect(hiddenInput()).toBe("2099-06-13");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(description()).toBe(enFormat);
  });

  test("rejects dates outside the minimum and maximum", () => {
    const { description, hiddenInput, input, typeDate } = renderPicker({
      initialValue: "2099-06-10",
      maximum: "2099-06-30",
      minimum: () => "2099-06-05",
    });

    typeDate("6/4/2099");
    expect(hiddenInput()).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description()).toContain(
      m.dateInputBeforeMinimum({ date: "June 5, 2099" }, en)
    );

    typeDate("2099-07-01");
    expect(hiddenInput()).toBe("");
    expect(description()).toContain(
      m.dateInputAfterMaximum({ date: "June 30, 2099" }, en)
    );
  });

  test("rejects an unavailable prefilled date when its text is confirmed unchanged", () => {
    for (const confirm of ["blur", "Enter"] as const) {
      const { description, hiddenInput, input, onBlur } = renderPicker({
        initialValue: "2099-06-10",
        isDateDisabled: (date) => date.toString() === "2099-06-10",
      });

      if (confirm === "blur") fireEvent.focusOut(input);
      else fireEvent.keyDown(input, { key: "Enter" });

      expect({ confirm, value: hiddenInput() }).toEqual({ confirm, value: "" });
      expect(input.value).toBe("6/10/2099");
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(description()).toContain(
        m.dateInputUnavailable({ date: "June 10, 2099" }, en)
      );
      expect(onBlur).not.toHaveBeenCalled();
      cleanup();
    }
  });

  test("rejects a committed date that new bounds leave out of range", () => {
    const { description, hiddenInput, input, view } = renderPicker({
      initialValue: "2099-06-10",
    });

    view.rerender(
      <ControlledPicker initialValue="2099-06-10" minimum="2099-06-11" />
    );
    fireEvent.focusOut(input);

    expect(hiddenInput()).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description()).toContain(
      m.dateInputBeforeMinimum({ date: "June 11, 2099" }, en)
    );
  });

  test("explains the format for text that is no date", () => {
    const { description, hiddenInput, input, typeDate } = renderPicker({
      initialValue: "2099-06-10",
    });

    typeDate("next friday");

    expect(hiddenInput()).toBe("");
    expect(input.value).toBe("next friday");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description()).toContain(m.dateInputInvalid(enFormatParts, en));
  });

  test("words errors in Czech for a Czech visitor", () => {
    const { description, typeDate } = renderPicker({
      isDateDisabled: (date) => date.toString() === "2099-06-12",
      locale: "cs-CZ",
    });

    typeDate("12. 6. 2099");
    expect(description()).toBe(
      `${m.dateInputFormat(csFormatParts, cs)} ${m.dateInputUnavailable(
        { date: "12. června 2099" },
        cs
      )}`
    );

    typeDate("zítra");
    expect(description()).toContain(m.dateInputInvalid(csFormatParts, cs));
  });

  test("keeps the error region mounted while it is empty", () => {
    const { input } = renderPicker();
    const errorId = (input.getAttribute("aria-describedby") ?? "").split(
      " "
    )[1];
    const errorRegion = errorId ? document.getElementById(errorId) : null;

    expect(errorRegion?.getAttribute("aria-live")).toBe("polite");
    expect(errorRegion?.getAttribute("role")).toBeNull();
    expect(errorRegion?.textContent).toBe("");
  });

  test("a calendar pick updates the typed text", async () => {
    const { hiddenInput, input, view } = renderPicker({
      initialValue: "2099-06-10",
    });

    fireEvent.click(
      view.getByRole("button", {
        name: calendarButtonLabel,
      })
    );
    const day = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-day="2099-06-18"] button'
      );
      if (!button) throw new Error("calendar did not open");
      return button;
    });
    act(() => {
      day.click();
    });

    expect(hiddenInput()).toBe("2099-06-18");
    expect(input.value).toBe("6/18/2099");
  });

  test("keeps the date when the calendar's selected day is picked again", async () => {
    const { hiddenInput, input, onValue, view } = renderPicker({
      initialValue: "2099-06-10",
    });

    fireEvent.click(
      view.getByRole("button", {
        name: calendarButtonLabel,
      })
    );
    const selectedDay = await waitFor(() => {
      const button = document.querySelector<HTMLButtonElement>(
        '[data-day="2099-06-10"] button'
      );
      if (!button) throw new Error("calendar did not open");
      return button;
    });
    act(() => {
      selectedDay.click();
    });

    expect(onValue).not.toHaveBeenCalled();
    expect(hiddenInput()).toBe("2099-06-10");
    expect(input.getAttribute("aria-expanded")).toBe("true");
  });

  test("Down Arrow opens the calendar on the typed date", async () => {
    const { hiddenInput, input } = renderPicker({
      initialValue: "2099-06-10",
    });

    fireEvent.change(input, { target: { value: "8/20/2099" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });

    expect(hiddenInput()).toBe("2099-08-20");
    const selectedDay = await waitFor(() => {
      const cell = document.querySelector('[data-day="2099-08-20"]');
      if (!cell) throw new Error("calendar did not open on August");
      return cell;
    });
    expect(selectedDay.getAttribute("data-selected")).toBe("true");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(
      document.getElementById(input.getAttribute("aria-controls") ?? "")
    ).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(selectedDay.querySelector("button"));
    });
  });

  // Without a date, the calendar opens on a month it offers days in rather
  // than on a month the bounds leave entirely out.
  for (const [bound, props, offeredDay] of [
    ["a later minimum", { minimum: "2099-12-01" }, "2099-12-01"],
    ["an earlier maximum", { maximum: "2001-03-15" }, "2001-03-15"],
  ] as const) {
    test(`opens an empty field's calendar on the month of ${bound}`, async () => {
      const { input } = renderPicker(props);

      fireEvent.keyDown(input, { key: "ArrowDown" });

      const offered = await waitFor(() => {
        const cell = document.querySelector(`[data-day="${offeredDay}"]`);
        if (!cell) throw new Error(`calendar did not open on ${offeredDay}`);
        return cell;
      });
      expect(offered.querySelector("button")?.disabled).toBe(false);
    });
  }

  test("closing the calendar with Escape or a pick returns focus to the typed field", async () => {
    const { input } = renderPicker({ initialValue: "2099-06-10" });
    const openFromField = () =>
      waitFor(() => {
        const day = document.querySelector<HTMLButtonElement>(
          '[data-day="2099-06-18"] button'
        );
        if (!day) throw new Error("calendar did not open");
        return day;
      });

    input.focus();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const day = await openFromField();
    await waitFor(() => {
      expect(document.activeElement?.closest("[data-day]")).not.toBeNull();
    });
    fireEvent.keyDown(document.activeElement ?? day, { key: "Escape" });
    await waitFor(() => {
      expect(input.getAttribute("aria-expanded")).toBe("false");
    });
    expect(document.activeElement === input).toBe(true);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const nextDay = await openFromField();
    act(() => {
      nextDay.click();
    });
    await waitFor(() => {
      expect(input.getAttribute("aria-expanded")).toBe("false");
    });
    expect(input.value).toBe("6/18/2099");
    expect(document.activeElement === input).toBe(true);
  });

  test("names the calendar's months and weekdays in the visitor's language", async () => {
    const { view } = renderPicker({
      label: "Datum rezervace",
      initialValue: "2099-06-10",
      locale: "cs-CZ",
    });

    fireEvent.click(
      view.getByRole("button", {
        name: m.dateInputCalendarButtonLabel({ field: "Datum rezervace" }, cs),
      })
    );
    const grid = await waitFor(() => view.getByRole("grid"));

    expect(grid.getAttribute("aria-label")).toBe("červen 2099");
    expect(
      document
        .querySelector('[data-day="2099-06-10"]')
        ?.getAttribute("data-selected")
    ).toBe("true");
  });
});

describe("DateInput in a form", () => {
  afterEach(() => {
    cleanup();
  });

  const renderInForm = (
    props: Partial<DateInputProps> = {},
    onSubmit = mock((_data: FormData) => undefined)
  ) => {
    const view = render(
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
      >
        <DateInput label={dateLabel} locale="en-US" name="date" {...props} />
        <button type="submit">Save</button>
      </form>
    );
    const form = view.container.querySelector("form") as HTMLFormElement;
    const input = view.getByRole("combobox") as HTMLInputElement;
    const submitted = () => new FormData(form).getAll("date");
    return { form, input, onSubmit, submitted, view };
  };

  test("submits one canonical date when uncontrolled and resets to its default", () => {
    const onChange = mock((_value: string) => undefined);
    const { form, input, submitted } = renderInForm({
      defaultValue: "2099-06-10",
      onChange,
    });

    expect(input.value).toBe("6/10/2099");
    expect(submitted()).toEqual(["2099-06-10"]);

    fireEvent.change(input, { target: { value: "6/12/2099" } });
    fireEvent.focusOut(input);
    expect(onChange).toHaveBeenLastCalledWith("2099-06-12");
    expect(submitted()).toEqual(["2099-06-12"]);

    act(() => form.reset());
    expect(input.value).toBe("6/10/2099");
    expect(submitted()).toEqual(["2099-06-10"]);
  });

  test("a form reset drops typed text the field could not take", () => {
    const { form, input, submitted } = renderInForm();

    fireEvent.change(input, { target: { value: "next friday" } });
    fireEvent.focusOut(input);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    act(() => form.reset());
    expect(input.value).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(submitted()).toEqual([""]);
  });

  test("shows an empty field for a value that is no canonical date", () => {
    const { input, submitted } = renderInForm({ value: "2099-06-10T09:00" });

    expect(input.value).toBe("");
    expect(submitted()).toEqual([""]);
  });

  test("submits nothing while disabled, and neither types nor opens", () => {
    const { input, submitted, view } = renderInForm({
      defaultValue: "2099-06-10",
      disabled: true,
    });

    expect(input.disabled).toBe(true);
    expect(
      (
        view.getByRole("button", {
          name: calendarButtonLabel,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(submitted()).toEqual([]);
  });

  test("passes the owner's description and invalid state to the field", () => {
    const { input } = renderInForm({
      "aria-describedby": "owner-message",
      "aria-invalid": true,
    });

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect((input.getAttribute("aria-describedby") ?? "").split(" ")).toContain(
      "owner-message"
    );
  });

  test("keeps a form from submitting text that is no date, even without validation", () => {
    const { form, input, onSubmit, submitted } = renderInForm({
      defaultValue: "2099-06-10",
    });

    // Typed without leaving the field, then submitted.
    fireEvent.change(input, { target: { value: "next friday" } });
    fireEvent.submit(form);

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement === input).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(submitted()).toEqual([""]);

    fireEvent.change(input, { target: { value: "6/11/2099" } });
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]?.[0].getAll("date")).toEqual(["2099-06-11"]);
  });

  test("doesn't hold up the form from a disabled fieldset", () => {
    const onSubmit = mock(() => undefined);
    const view = render(
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset disabled>
          <DateInput label={dateLabel} locale="en-US" name="date" />
        </fieldset>
      </form>
    );
    const form = view.container.querySelector("form") as HTMLFormElement;

    fireEvent.change(view.getByRole("combobox"), {
      target: { value: "next friday" },
    });
    fireEvent.submit(form);

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  test("submits an emptied field as an empty date", () => {
    const { form, input, onSubmit } = renderInForm({
      defaultValue: "2099-06-10",
    });

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.submit(form);

    expect(onSubmit.mock.calls[0]?.[0].getAll("date")).toEqual([""]);
  });

  test("Clear in the calendar empties the date and returns focus to the field", async () => {
    const onChange = mock((_value: string) => undefined);
    const { input, submitted, view } = renderInForm({
      defaultValue: "2099-06-10",
      onChange,
    });

    fireEvent.click(view.getByRole("button", { name: calendarButtonLabel }));
    const dialog = await waitFor(() => view.getByRole("dialog"));
    const clear = Array.from(dialog.querySelectorAll("button")).find(
      (button) => button.textContent === m.dateInputClear({}, en)
    );
    if (!clear) throw new Error("The calendar has no clear button.");
    fireEvent.click(clear);

    await waitFor(() => {
      expect(input.getAttribute("aria-expanded")).toBe("false");
    });
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(input.value).toBe("");
    expect(submitted()).toEqual([""]);
    expect(document.activeElement === input).toBe(true);
  });
});
