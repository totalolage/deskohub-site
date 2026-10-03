import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form, FormField, FormItem } from "@/shared/components/ui/form";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { ReservationFormDateInput } = await import("./reservation-date-input");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const Harness = (props: {
  readonly dateInputProps?: Partial<
    Omit<Parameters<typeof ReservationFormDateInput>[0], "ariaLabel">
  >;
}) => {
  const form = useForm<{ date: string }>({ defaultValues: { date: "" } });

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="date"
        render={({ field }) => (
          <FormItem>
            <ReservationFormDateInput
              ariaLabel="Reservation date"
              locale="en-US"
              {...props.dateInputProps}
              name={field.name}
              onChange={field.onChange}
              value={field.value}
            />
          </FormItem>
        )}
      />
    </Form>
  );
};

describe("ReservationFormDateInput", () => {
  test("announces the field as required and wires the form field", () => {
    const view = render(<Harness />);

    const trigger = view.getByRole("button", {
      name: "Reservation date, required",
    });

    expect(trigger).toBeDefined();
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(
      view.container.querySelector<HTMLInputElement>('input[name="date"]')
        ?.required
    ).toBe(true);
  });

  test("keeps dynamic minimum bounds as callbacks", () => {
    let minimum = "2099-06-10";
    const onChange = mock(() => undefined);
    const view = render(
      <Harness dateInputProps={{ minimum: () => minimum, onChange }} />
    );
    const readHidden = () =>
      view.container.querySelector<HTMLInputElement>('input[name="date"]');

    expect(readHidden()?.getAttribute("min")).toBe("2099-06-10");

    minimum = "2099-07-01";
    view.rerender(
      <Harness dateInputProps={{ minimum: () => minimum, onChange }} />
    );
    expect(readHidden()?.getAttribute("min")).toBe("2099-07-01");
  });
});
