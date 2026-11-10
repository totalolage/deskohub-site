import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { useForm, useWatch } from "react-hook-form";
import { m } from "@/features/i18n";
import {
  defaultReservationBillingSelection,
  type ReservationBillingSelectionInput,
} from "@/features/reservation/reservation-billing";
import { Form } from "@/shared/components/ui/form";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// React DOM detects input events when it loads, so the DOM must exist first.
registerWorkspaceComponentTestEnv();
const { cleanup, fireEvent, render } = await import("@testing-library/react");
const { ReservationBillingFields } = await import(
  "./reservation-billing-fields"
);

const locale = "en-US";

const Harness = () => {
  const form = useForm<{ billing: ReservationBillingSelectionInput }>({
    defaultValues: { billing: defaultReservationBillingSelection },
  });
  const billing = useWatch({ control: form.control, name: "billing" });

  return (
    <Form {...form}>
      <ReservationBillingFields locale={locale} />
      <output data-testid="billing-value">{JSON.stringify(billing)}</output>
    </Form>
  );
};

describe("ReservationBillingFields", () => {
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
    expect(
      (view.getByRole("combobox", { name: "Country" }) as HTMLSelectElement)
        .value
    ).toBe("CZ");
    expect(view.getByRole("option", { name: "Czechia" })).toBeTruthy();
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

  test("leaves a blank optional field out and keeps a required one as typed", () => {
    const view = render(<Harness />);
    const billing = () =>
      JSON.parse(view.getByTestId("billing-value").textContent ?? "{}");
    const type = (label: string, value: string) =>
      fireEvent.change(view.getByLabelText(label, { exact: false }), {
        target: { value },
      });

    const vatIdLabel = m.reservationBillingVatIdLabel({}, { locale });
    fireEvent.click(
      view.getByRole("switch", {
        name: m.reservationPurposeBusinessLabel({}, { locale }),
      })
    );
    type(vatIdLabel, "CZ12345678");
    type(m.reservationBillingCompanyNameLabel({}, { locale }), "  ");
    expect(billing().buyer).toMatchObject({
      legalName: "  ",
      vatId: "CZ12345678",
    });

    type(vatIdLabel, "   ");
    expect(billing().buyer).not.toHaveProperty("vatId");
    expect(
      (view.getByLabelText(vatIdLabel, { exact: false }) as HTMLInputElement)
        .required
    ).toBe(false);
  });
});
