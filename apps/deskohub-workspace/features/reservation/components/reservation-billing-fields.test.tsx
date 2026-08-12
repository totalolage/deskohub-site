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

    const businessUse = view.getByRole("switch", { name: "Business use" });
    const createInvoice = view.getByRole("checkbox", {
      name: "Create invoice",
    });

    expect(businessUse.getAttribute("data-state")).toBe("unchecked");
    expect(createInvoice.getAttribute("data-state")).toBe("unchecked");
    expect((createInvoice as HTMLButtonElement).disabled).toBe(false);
    expect(
      view.getByRole("button", {
        name: "Different EU regulations apply to us as the supplier for business use.",
      })
    ).toBeTruthy();
    expect(view.queryByLabelText("Address")).toBeNull();

    fireEvent.click(createInvoice);
    expect((view.getByLabelText("Address") as HTMLInputElement).required).toBe(
      true
    );
    fireEvent.change(view.getByLabelText("Address"), {
      target: { value: "Private street 1" },
    });

    fireEvent.click(businessUse);
    expect(
      (view.getByLabelText("Legal company name") as HTMLInputElement).required
    ).toBe(true);
    expect(createInvoice.getAttribute("data-state")).toBe("checked");
    expect((createInvoice as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByTestId("billing-value").textContent).not.toContain(
      "Private street 1"
    );
  });
});
