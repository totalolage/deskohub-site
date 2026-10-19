import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { useState } from "react";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ReservationDatePickerProps } from "./reservation-date-picker";

// React DOM detects input events and Radix picks its layout-effect hook when
// they load, so the DOM must exist before either is imported.
registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { ReservationDatePicker } = await import("./reservation-date-picker");

function ControlledPicker({
  initialValue = "",
  onValue,
  ...props
}: Partial<ReservationDatePickerProps> & {
  readonly initialValue?: string;
  readonly onValue?: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <ReservationDatePicker
      ariaLabel="Reservation date"
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

describe("ReservationDatePicker typed date", () => {
  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("labels the text field and describes its formats", () => {
    const { description, input, view } = renderPicker({ ariaRequired: true });

    expect(input.getAttribute("aria-label")).toBe("Reservation date");
    expect(input.required).toBe(true);
    expect(input.getAttribute("aria-haspopup")).toBe("dialog");
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(input.placeholder).toBe("MM/DD/YYYY");
    expect(description()).toBe("Format: MM/DD/YYYY or YYYY-MM-DD");
    expect(
      view.getByRole("button", {
        name: "Reservation date: choose from the calendar",
      })
    ).not.toBeNull();
  });

  test("takes its name from a visible label when one is given", () => {
    const view = render(
      <>
        <span id="visible-label">Office reservation start date</span>
        <ReservationDatePicker
          ariaLabel="Office reservation start date"
          ariaLabelledBy="visible-label"
          ariaRequired
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
      <ReservationDatePicker
        ariaLabel="Reservation date"
        locale="en-US"
        value="2099-06-10"
      />
    );
    const input = view.getByRole("combobox") as HTMLInputElement;

    expect(input.value).toBe("6/10/2099");
    expect(view.getByText("June 10, 2099")).not.toBeNull();

    view.rerender(
      <ReservationDatePicker
        ariaLabel="Reservation date"
        locale="en-US"
        value="2099-07-01"
      />
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
      "Format: MM/DD/YYYY or YYYY-MM-DD June 12, 2099 isn't available. Choose another date."
    );
    // The error is the field's feedback; form validation waits for a date.
    expect(onBlur).not.toHaveBeenCalled();

    typeDate("6/13/2099");
    expect(hiddenInput()).toBe("2099-06-13");
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(description()).toBe("Format: MM/DD/YYYY or YYYY-MM-DD");
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
    expect(description()).toContain("Choose a date on or after June 5, 2099.");

    typeDate("2099-07-01");
    expect(hiddenInput()).toBe("");
    expect(description()).toContain(
      "Choose a date on or before June 30, 2099."
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
        "June 10, 2099 isn't available. Choose another date."
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
    expect(description()).toContain("Choose a date on or after June 11, 2099.");
  });

  test("explains the format for text that is no date", () => {
    const { description, hiddenInput, input, typeDate } = renderPicker({
      initialValue: "2099-06-10",
    });

    typeDate("next friday");

    expect(hiddenInput()).toBe("");
    expect(input.value).toBe("next friday");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description()).toContain(
      "Enter the date as MM/DD/YYYY or YYYY-MM-DD."
    );
  });

  test("words errors in Czech for a Czech visitor", () => {
    const { description, typeDate } = renderPicker({
      isDateDisabled: (date) => date.toString() === "2099-06-12",
      locale: "cs-CZ",
    });

    typeDate("12. 6. 2099");
    expect(description()).toBe(
      "Formát: DD. MM. RRRR nebo RRRR-MM-DD Termín 12. června 2099 není k dispozici. Vyber jiné datum."
    );

    typeDate("zítra");
    expect(description()).toContain(
      "Zadej datum ve formátu DD. MM. RRRR nebo RRRR-MM-DD."
    );
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
        name: "Reservation date: choose from the calendar",
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
    expect(document.activeElement).toBe(input);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    const nextDay = await openFromField();
    act(() => {
      nextDay.click();
    });
    await waitFor(() => {
      expect(input.getAttribute("aria-expanded")).toBe("false");
    });
    expect(input.value).toBe("6/18/2099");
    expect(document.activeElement).toBe(input);
  });

  test("names the calendar's months and weekdays in the visitor's language", async () => {
    const { view } = renderPicker({
      ariaLabel: "Datum rezervace",
      initialValue: "2099-06-10",
      locale: "cs-CZ",
    });

    fireEvent.click(
      view.getByRole("button", {
        name: "Datum rezervace: vybrat v kalendáři",
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
