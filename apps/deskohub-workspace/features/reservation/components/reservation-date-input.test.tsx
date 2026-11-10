import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { useForm } from "react-hook-form";
import "@/shared/polyfills/temporal";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ReservationFormDateInputProps } from "./reservation-date-input";

// React DOM detects input events and Radix picks its layout-effect hook when
// they load, so the DOM must exist before either is imported.
registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);
const { Form, FormField, FormItem, FormLabel, FormMessage } = await import(
  "@/shared/components/ui/form"
);
const { ReservationFormDateInput } = await import("./reservation-date-input");

const label = "Reservation date";
const en = { locale: "en-US" } as const;

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

/** The date field in a React Hook Form item, as the reservation forms lay it out. */
const renderDate = (
  props: Partial<Omit<ReservationFormDateInputProps, "onChange">> = {}
) => {
  const onChange = mock((_value: string) => undefined);

  function DateForm() {
    const form = useForm<{ date: string }>({
      defaultValues: { date: props.value ?? "" },
    });

    return (
      <Form {...form}>
        <form noValidate>
          <FormField
            control={form.control}
            name="date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{label}</FormLabel>
                <ReservationFormDateInput
                  {...field}
                  label={label}
                  locale="en-US"
                  onChange={(next) => {
                    onChange(next);
                    field.onChange(next);
                  }}
                  {...props}
                  value={field.value}
                />
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    );
  }

  const view = render(<DateForm />);
  const form = view.container.querySelector("form") as HTMLFormElement;
  const field = view.getByRole("combobox") as HTMLInputElement;
  const typeDate = (text: string) => {
    fireEvent.change(field, { target: { value: text } });
    fireEvent.focusOut(field);
  };
  const changes = () => onChange.mock.calls.map(([next]) => next);
  const submitted = () => new FormData(form).getAll("date");
  const describedText = () =>
    (field.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");

  return { changes, describedText, field, submitted, typeDate, view };
};

describe("ReservationFormDateInput", () => {
  test("is a required date named by the item's label", () => {
    const { field, submitted, view } = renderDate({ value: "2099-06-10" });

    expect(field.getAttribute("aria-labelledby")).toBe(
      view.getByText(label).id
    );
    expect(field.required).toBe(true);
    expect(submitted()).toEqual(["2099-06-10"]);
  });

  test("keeps an unavailable typed date out and says why", () => {
    const { changes, describedText, field, submitted, typeDate } = renderDate({
      unavailableDates: new Set(["2099-06-11"]),
      value: "2099-06-10",
    });

    typeDate("6/11/2099");

    expect(changes()).toEqual([""]);
    expect(submitted()).toEqual([""]);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(describedText()).toContain(
      m.dateInputUnavailable({ date: "June 11, 2099" }, en)
    );

    typeDate("6/12/2099");
    expect(changes()).toEqual(["", "2099-06-12"]);
  });

  test("the calendar doesn't offer unavailable dates or dates before the minimum", async () => {
    let minimum = "2099-06-09";
    const { view } = renderDate({
      minimum: () => minimum,
      unavailableDates: new Set(["2099-06-11"]),
      value: "2099-06-10",
    });
    // The minimum is read when the calendar draws, without a re-render.
    minimum = "2099-06-10";

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.dateInputCalendarButtonLabel({ field: label }, en),
        })
      );
    });
    const calendar = await within(document.body).findByRole("dialog");
    const day = (date: string) =>
      calendar.querySelector<HTMLButtonElement>(`[data-day="${date}"] button`);

    expect(day("2099-06-09")?.disabled).toBe(true);
    expect(day("2099-06-10")?.disabled).toBe(false);
    expect(day("2099-06-11")?.disabled).toBe(true);
    expect(day("2099-06-12")?.disabled).toBe(false);
  });

  test("keeps dates after the maximum out", () => {
    const { changes, typeDate } = renderDate({
      maximum: "2099-06-20",
      minimum: "2099-06-01",
    });
    typeDate("6/21/2099");
    typeDate("6/20/2099");
    expect(changes()).toEqual(["2099-06-20"]);
  });
});
