import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import "@/shared/polyfills/temporal";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// React DOM detects input events and Radix picks its layout-effect hook when
// they load, so the DOM must exist before either is imported.
registerWorkspaceComponentTestEnv();

const { act, cleanup, fireEvent, render, waitFor } = await import(
  "@testing-library/react"
);
const { Form, FormField, FormItem, FormLabel, FormMessage } = await import(
  "@/shared/components/ui/form"
);
const { FormDateInput, FormDateTimeInput, FormTimeInput } = await import(
  "./form-fields"
);

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

type Values = {
  readonly date: string;
  readonly dateTime: string;
  readonly time: string;
};

const errorText = "Synthetic field error";

function SchedulingForm({
  onForm,
}: {
  readonly onForm: (form: ReturnType<typeof useForm<Values>>) => void;
}) {
  const form = useForm<Values>({
    defaultValues: { date: "2099-06-10", dateTime: "", time: "09:00" },
  });
  useEffect(() => onForm(form), [form, onForm]);

  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Service date</FormLabel>
              <FormDateInput label="Service date" locale="en-US" {...field} />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="time"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Opening time</FormLabel>
              <FormTimeInput label="Opening time" {...field} />
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="dateTime"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Starts</FormLabel>
              <FormDateTimeInput
                dateLabel="Starts date"
                locale="en-US"
                timeLabel="Starts time"
                {...field}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

const renderForm = () => {
  let form: ReturnType<typeof useForm<Values>> | undefined;
  const view = render(
    <SchedulingForm
      onForm={(nextForm) => {
        form = nextForm;
      }}
    />
  );
  if (!form) throw new Error("The form did not mount.");
  return { form, view };
};

describe("date and time form fields", () => {
  test("the item's label names each control", () => {
    const { view } = renderForm();

    expect(view.getByRole("combobox", { name: "Service date" })).toBeTruthy();
    expect(view.getByLabelText("Opening time")).toBeTruthy();
    // A date-time's label names its date; the time keeps its own name.
    expect(view.getByRole("combobox", { name: "Starts" })).toBeTruthy();
    expect(view.getByLabelText("Starts time")).toBeTruthy();
  });

  test("a field error marks the control invalid and describes it", async () => {
    const { form, view } = renderForm();
    const controls = [
      view.getByRole("combobox", { name: "Service date" }),
      view.getByLabelText("Opening time"),
      view.getByRole("combobox", { name: "Starts" }),
      view.getByLabelText("Starts time"),
    ];
    for (const control of controls) {
      expect(control.getAttribute("aria-invalid")).toBe("false");
    }

    await act(async () => {
      for (const name of ["date", "time", "dateTime"] as const) {
        form.setError(name, { message: errorText });
      }
    });

    for (const control of controls) {
      expect(control.getAttribute("aria-invalid")).toBe("true");
      const described = (control.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent);
      expect(described).toContain(errorText);
    }
  });

  test("reports edits as field values and focuses the control on setFocus", async () => {
    const { form, view } = renderForm();
    const dateField = view.getByRole("combobox", {
      name: "Service date",
    }) as HTMLInputElement;

    fireEvent.change(dateField, { target: { value: "6/12/2099" } });
    fireEvent.focusOut(dateField);
    fireEvent.input(view.getByLabelText("Opening time"), {
      target: { value: "10:15" },
    });

    expect(form.getValues()).toEqual({
      date: "2099-06-12",
      dateTime: "",
      time: "10:15",
    });

    // React Hook Form focuses on the next task.
    form.setFocus("date");
    await waitFor(() => {
      expect(document.activeElement === dateField).toBe(true);
    });
  });
});
