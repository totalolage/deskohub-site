import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useForm, useWatch } from "react-hook-form";
import {
  defaultReservationBillingSelection,
  type ReservationBillingSelectionInput,
} from "@/features/reservation/reservation-billing";
import { Form } from "@/shared/components/ui/form";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { ReservationBillingFields } from "./reservation-billing-fields";

const Harness = () => {
  const form = useForm<{ billing: ReservationBillingSelectionInput }>({
    defaultValues: { billing: defaultReservationBillingSelection },
  });
  const billing = useWatch({ control: form.control, name: "billing" });

  return (
    <Form {...form}>
      <ReservationBillingFields locale="en-US" />
      <output data-testid="billing-value">{JSON.stringify(billing)}</output>
    </Form>
  );
};

describe("ReservationBillingFields", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  afterEach(cleanup);
  afterAll(unregisterWorkspaceComponentTestEnv);

  test("models personal invoice choice and mandatory business invoicing", () => {
    const view = render(<Harness />);

    expect(
      (view.getByRole("radio", { name: /Personal use/ }) as HTMLInputElement)
        .checked
    ).toBe(true);
    expect(view.queryByLabelText("Address")).toBeNull();

    fireEvent.click(view.getByRole("checkbox", { name: "Send me an invoice" }));
    expect((view.getByLabelText("Address") as HTMLInputElement).required).toBe(
      true
    );
    fireEvent.change(view.getByLabelText("Address"), {
      target: { value: "Private street 1" },
    });

    fireEvent.click(view.getByRole("radio", { name: /Business use/ }));
    expect(
      view.getByText("A business reservation always includes an invoice.")
    ).toBeTruthy();
    expect(
      (view.getByLabelText("Legal company name") as HTMLInputElement).required
    ).toBe(true);
    expect(
      view.queryByRole("checkbox", { name: "Send me an invoice" })
    ).toBeNull();
    expect(view.getByTestId("billing-value").textContent).not.toContain(
      "Private street 1"
    );
  });
});
