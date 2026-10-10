import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { type UseFormReturn, useForm } from "react-hook-form";
import type {
  ReservationContactValues,
  ReservationExistingCustomerForm,
} from "@/features/reservation/reservation-existing-customer";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

// React DOM detects input events when it loads, so the DOM must exist first.
registerWorkspaceComponentTestEnv();
const { cleanup, fireEvent, render, within } = await import(
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
});

const existingCustomer: ReservationExistingCustomerForm = {
  contact: {
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+420777777777",
  },
  initialMode: "account",
  otherContact: {
    name: "Grace Hopper",
    email: "grace@example.com",
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
            customer={reservationCustomer}
            existingCustomer={customer}
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
  const getValues = () => {
    if (!form) throw new Error("form was not rendered");
    return form.getValues();
  };
  const remountSection = () => {
    view.rerender(harness(false));
    view.rerender(harness(true));
  };
  return { getValues, remountSection, view };
};

describe("ReservationCustomerSection", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(cleanup);

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("lists the account details instead of the contact inputs", () => {
    const { view } = renderSection();
    const card = within(
      view.getByRole("region", { name: "Booking as" })
    ).getByText;

    expect(card("Ada Lovelace")).not.toBeNull();
    expect(card("ada@example.com")).not.toBeNull();
    expect(card("+420777777777")).not.toBeNull();
    expect(view.container.querySelector("input")).toBeNull();
  });

  test("asks for a phone the account does not have", () => {
    const { view } = renderSection({
      ...existingCustomer,
      contact: { ...existingCustomer.contact, phone: null },
    });

    expect(view.container.querySelector('input[name="phone"]')).not.toBeNull();
    expect(view.container.querySelector('input[name="name"]')).toBeNull();
    expect(view.container.querySelector('input[name="email"]')).toBeNull();
  });

  test("keeps each mode's contact across switches", () => {
    const { getValues, view } = renderSection();

    fireEvent.click(
      view.getByRole("button", { name: "Book for someone else" })
    );
    expect(view.queryByRole("region", { name: "Booking as" })).toBeNull();
    expect(getValues()).toEqual(existingCustomer.otherContact);

    const name = view.container.querySelector(
      'input[name="name"]'
    ) as HTMLInputElement;
    fireEvent.input(name, { target: { value: "Katherine Johnson" } });

    fireEvent.click(
      view.getByRole("button", { name: "Use my account details" })
    );
    expect(getValues()).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+420777777777",
    });

    fireEvent.click(
      view.getByRole("button", { name: "Book for someone else" })
    );
    expect(getValues()).toEqual({
      ...existingCustomer.otherContact,
      name: "Katherine Johnson",
    });
  });

  test("keeps focus on the toggle across switches", () => {
    const { view } = renderSection();
    const toggle = view.getByRole("button", { name: "Book for someone else" });

    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Use my account details" })
    );

    fireEvent.click(document.activeElement as HTMLElement);
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Book for someone else" })
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
      view.getByRole("button", { name: "Book for someone else" })
    );
    expect(getValues().phone).toBe(existingCustomer.otherContact.phone);

    fireEvent.click(
      view.getByRole("button", { name: "Use my account details" })
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
      view.getByRole("button", { name: "Book for someone else" })
    );
    fireEvent.input(
      view.container.querySelector('input[name="name"]') as HTMLInputElement,
      { target: { value: "Katherine Johnson" } }
    );
    fireEvent.click(
      view.getByRole("button", { name: "Use my account details" })
    );

    remountSection();

    expect(view.getByRole("region", { name: "Booking as" })).not.toBeNull();
    expect(getValues().phone).toBe("+420111222333");
    fireEvent.click(
      view.getByRole("button", { name: "Book for someone else" })
    );
    expect(getValues()).toEqual({
      ...existingCustomer.otherContact,
      name: "Katherine Johnson",
    });
    fireEvent.click(
      view.getByRole("button", { name: "Use my account details" })
    );
    expect(getValues().phone).toBe("+420111222333");
  });
});
