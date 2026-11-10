import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { useForm, useWatch } from "react-hook-form";
import { type Locale, locales, m } from "@/features/i18n";
import {
  defaultReservationBillingSelection,
  emptyBusinessBillingSelection,
  type ReservationBillingSelectionInput,
  reservationBillingSelectionInputSchema,
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

const validatedBillingSchema = Schema.Struct({
  billing: reservationBillingSelectionInputSchema,
});

const businessBilling = (
  address: Partial<typeof emptyBusinessBillingSelection.buyer.address>
): ReservationBillingSelectionInput => ({
  ...emptyBusinessBillingSelection,
  buyer: {
    ...emptyBusinessBillingSelection.buyer,
    address: { ...emptyBusinessBillingSelection.buyer.address, ...address },
  },
});

const ValidatedHarness = ({
  billing,
  locale,
}: {
  readonly billing: ReservationBillingSelectionInput;
  readonly locale: Locale;
}) => {
  const form = useForm<{ billing: ReservationBillingSelectionInput }>({
    resolver: effectSchemaResolver(validatedBillingSchema, undefined, {
      raw: true,
    }),
    defaultValues: { billing },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(() => undefined)}>
        <ReservationBillingFields locale={locale} />
        <button type="submit">Submit</button>
      </form>
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

  test.each(locales)(
    "shows billing identity errors in the %s form's language",
    async (formLocale) => {
      const view = render(
        <ValidatedHarness
          billing={businessBilling({
            line1: "Street 1",
            city: "City",
            postalCode: "x",
          })}
          locale={formLocale}
        />
      );

      fireEvent.click(view.getByRole("button", { name: "Submit" }));

      expect(
        await view.findAllByText(
          m.reservationBillingFieldRequired({}, { locale: formLocale })
        )
      ).toHaveLength(2);
      expect(
        view.getByText(
          m.reservationBillingPostalCodeInvalid({}, { locale: formLocale })
        )
      ).toBeTruthy();
    }
  );

  test.each(locales)(
    "shows an unknown invoice country in the %s form's language",
    async (formLocale) => {
      const view = render(
        <ValidatedHarness
          billing={businessBilling({
            line1: "Street 1",
            city: "City",
            postalCode: "1",
            country: "XX",
          })}
          locale={formLocale}
        />
      );

      fireEvent.click(view.getByRole("button", { name: "Submit" }));

      expect(
        await view.findByText(
          m.reservationBillingCountryInvalid({}, { locale: formLocale })
        )
      ).toBeTruthy();
    }
  );
});
