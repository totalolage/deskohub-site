import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { type UseFormReturn, useForm } from "react-hook-form";
import { m } from "@/features/i18n";
import type {
  ReservationContactValues,
  ReservationExistingCustomerForm,
} from "@/features/reservation/reservation-existing-customer";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const testEmailAddressForAda = testEmailAddress("ada");

// React DOM detects input events when it loads, so the DOM must exist first.
registerWorkspaceComponentTestEnv();
const { cleanup, fireEvent, render } = await import(
  "@testing-library/react/pure"
);
const { Form } = await import("@/shared/components/ui/form");
const {
  ReservationCustomerFields,
  ReservationCustomerSection,
  useReservationCustomer,
} = await import("./reservation-customer-fields");

function Harness() {
  const form = useForm<{ email: string; name: string; phone: string }>({
    defaultValues: { email: "", name: "", phone: "" },
  });

  return (
    <Form {...form}>
      <form>
        <ReservationCustomerFields locale="en-US" />
      </form>
    </Form>
  );
}

describe("ReservationCustomerFields", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("renders contact fields without a message input or textarea", () => {
    const view = render(<Harness />);

    expect(view.container.querySelector("textarea")).toBeNull();
    expect(view.container.querySelector('input[name="message"]')).toBeNull();

    expect(view.container.querySelector('input[name="email"]')).not.toBeNull();
    expect(view.container.querySelector('input[name="phone"]')).not.toBeNull();
    expect(view.container.querySelector('input[name="name"]')).not.toBeNull();
  });

  test("marks the phone input as a telephone field for autofill", () => {
    const view = render(<Harness />);
    const phone = view.container.querySelector('input[name="phone"]');

    expect(phone?.getAttribute("type")).toBe("tel");
    expect(phone?.getAttribute("autocomplete")).toBe("tel");
  });
});

const existingCustomer: ReservationExistingCustomerForm = {
  contact: {
    name: "Ada Lovelace",
    email: testEmailAddressForAda,
    phone: "+420777777777",
  },
  hasMarketingConsent: false,
  initialMode: "account",
  otherContact: {
    name: "Grace Hopper",
    email: testEmailAddress("grace"),
    phone: "+420606060606",
  },
};

function SectionHarness({
  customer,
  onForm,
  showSection = true,
}: {
  readonly customer: ReservationExistingCustomerForm;
  readonly onForm: (form: UseFormReturn<ReservationContactValues>) => void;
  readonly showSection?: boolean;
}) {
  const form = useForm<ReservationContactValues>({
    defaultValues: {
      name: customer.contact.name,
      email: customer.contact.email,
      phone: customer.contact.phone ?? "",
    },
  });
  const reservationCustomer = useReservationCustomer(customer);
  onForm(form);

  return (
    <Form {...form}>
      <form>
        {showSection && (
          <ReservationCustomerSection
            checkoutCustomer={{
              status: "linked",
              existingCustomer: customer,
              replacesTypedContact: false,
            }}
            customer={reservationCustomer}
            locale="en-US"
          />
        )}
      </form>
    </Form>
  );
}

const renderSection = (customer = existingCustomer) => {
  let form: UseFormReturn<ReservationContactValues> | undefined;
  const harness = (showSection: boolean) => (
    <SectionHarness
      customer={customer}
      onForm={(current) => {
        form = current;
      }}
      showSection={showSection}
    />
  );
  const view = render(harness(true));
  const getFormValues = () => {
    if (!form) throw new Error("form was not rendered");
    return form.getValues() as ReservationContactValues & {
      readonly emailConfirmation?: string;
    };
  };
  // The contact the reservation books, without its repeated email.
  const getValues = () => {
    const { emailConfirmation: _, ...contact } = getFormValues();
    return contact;
  };
  const remountSection = () => {
    view.rerender(harness(false));
    view.rerender(harness(true));
  };
  return { getFormValues, getValues, remountSection, view };
};

describe("ReservationCustomerSection", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("keeps each mode's contact across switches", () => {
    const { getFormValues, getValues, view } = renderSection();

    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationBookForSomeoneElse({}, { locale: "en-US" }),
      })
    );
    expect(view.queryByRole("region", { name: "Booking as" })).toBeNull();
    expect(getValues()).toEqual(existingCustomer.otherContact);
    // A contact carried in from a link or a restored checkout opens
    // confirmed; the account card asks for no repeated email.
    expect(getFormValues().emailConfirmation).toBe(
      existingCustomer.otherContact.email
    );

    const name = view.container.querySelector(
      'input[name="name"]'
    ) as HTMLInputElement;
    fireEvent.input(name, { target: { value: "Katherine Johnson" } });

    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationUseAccountDetails({}, { locale: "en-US" }),
      })
    );
    expect(getValues()).toEqual({
      name: "Ada Lovelace",
      email: testEmailAddressForAda,
      phone: "+420777777777",
    });

    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationBookForSomeoneElse({}, { locale: "en-US" }),
      })
    );
    expect(getValues()).toEqual({
      ...existingCustomer.otherContact,
      name: "Katherine Johnson",
    });
  });

  test("keeps focus on the toggle across switches", () => {
    const { view } = renderSection();
    const toggle = view.getByRole("button", {
      name: m.reservationBookForSomeoneElse({}, { locale: "en-US" }),
    });

    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(
      view.getByRole("button", {
        name: m.reservationUseAccountDetails({}, { locale: "en-US" }),
      })
    );

    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(
      view.getByRole("button", {
        name: m.reservationBookForSomeoneElse({}, { locale: "en-US" }),
      })
    );
  });

  test("keeps the phone typed for an account without one", () => {
    const { getValues, view } = renderSection({
      ...existingCustomer,
      contact: { ...existingCustomer.contact, phone: null },
    });

    fireEvent.input(
      view.container.querySelector('input[name="phone"]') as HTMLInputElement,
      { target: { value: "+420111222333" } }
    );
    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationBookForSomeoneElse({}, { locale: "en-US" }),
      })
    );
    expect(getValues().phone).toBe(existingCustomer.otherContact.phone);

    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationUseAccountDetails({}, { locale: "en-US" }),
      })
    );
    expect(getValues().phone).toBe("+420111222333");
  });

  test("keeps both modes' drafts while a submission unmounts the section", () => {
    const { getValues, remountSection, view } = renderSection({
      ...existingCustomer,
      contact: { ...existingCustomer.contact, phone: null },
    });

    fireEvent.input(
      view.container.querySelector('input[name="phone"]') as HTMLInputElement,
      { target: { value: "+420111222333" } }
    );
    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationBookForSomeoneElse({}, { locale: "en-US" }),
      })
    );
    fireEvent.input(
      view.container.querySelector('input[name="name"]') as HTMLInputElement,
      { target: { value: "Katherine Johnson" } }
    );
    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationUseAccountDetails({}, { locale: "en-US" }),
      })
    );

    remountSection();

    expect(view.getByRole("region", { name: "Booking as" })).not.toBeNull();
    expect(getValues().phone).toBe("+420111222333");
    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationBookForSomeoneElse({}, { locale: "en-US" }),
      })
    );
    expect(getValues()).toEqual({
      ...existingCustomer.otherContact,
      name: "Katherine Johnson",
    });
    fireEvent.click(
      view.getByRole("button", {
        name: m.reservationUseAccountDetails({}, { locale: "en-US" }),
      })
    );
    expect(getValues().phone).toBe("+420111222333");
  });
});
