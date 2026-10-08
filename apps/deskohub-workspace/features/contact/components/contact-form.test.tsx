import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type ContactActionResult = {
  readonly data?: unknown;
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};

const idleResult = (): Promise<ContactActionResult> =>
  Promise.resolve({ data: { status: "idle" } });
const submitContactForm = mock(idleResult);

mock.module("@/features/contact/actions/submit-contact", () => ({
  submitContactForm,
}));

mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const submittedValues = {
  name: "Synthetic Contact",
  email: "synthetic.contact@example.test",
  phone: "+420000000000",
  message: "Synthetic message that must survive a failed submission.",
};

type ContactView = ReturnType<typeof render>;

const fieldValue = (view: ContactView, label: string) =>
  (view.getByLabelText(label) as HTMLInputElement | HTMLTextAreaElement).value;

const fillAndSubmit = (view: ContactView) => {
  fireEvent.change(view.getByLabelText("Name"), {
    target: { value: submittedValues.name },
  });
  fireEvent.change(view.getByLabelText("Email"), {
    target: { value: submittedValues.email },
  });
  fireEvent.change(view.getByLabelText("Phone"), {
    target: { value: submittedValues.phone },
  });
  fireEvent.change(view.getByLabelText("Message"), {
    target: { value: submittedValues.message },
  });
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Contact form was not rendered");
  fireEvent.submit(form);
};

const expectSubmittedValues = (view: ContactView) => {
  expect(fieldValue(view, "Name")).toBe(submittedValues.name);
  expect(fieldValue(view, "Email")).toBe(submittedValues.email);
  expect(fieldValue(view, "Phone")).toBe(submittedValues.phone);
  expect(fieldValue(view, "Message")).toBe(submittedValues.message);
};

const getLiveRegion = (view: ContactView) => {
  const region = view.container.querySelector('[aria-live="polite"]');
  if (!region) throw new Error("Contact form live region was not rendered");
  return region;
};

describe("ContactForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    submitContactForm.mockReset();
    submitContactForm.mockImplementation(() => idleResult());
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("prefills fields from provided initial values", async () => {
    const { ContactForm } = await import("./contact-form");
    const view = render(
      <ContactForm
        locale="en-US"
        initialValues={{
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+420777777777",
          message: "Please help with order reservation-status-page.",
        }}
      />
    );

    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ada Lovelace"
    );
    expect((view.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "ada@example.com"
    );
    expect((view.getByLabelText("Phone") as HTMLInputElement).value).toBe(
      "+420777777777"
    );
    expect((view.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Please help with order reservation-status-page."
    );
    expect(
      view.container.querySelector<HTMLInputElement>('input[name="locale"]')
        ?.value
    ).toBe("en-US");
  });

  test("keeps the submitted values and announces an error when the action fails on the server", async () => {
    submitContactForm.mockImplementation(() =>
      Promise.resolve({ serverError: "Synthetic contact server failure" })
    );
    const { ContactForm } = await import("./contact-form");
    const view = render(<ContactForm locale="en-US" />);

    fillAndSubmit(view);

    await waitFor(() => {
      expect(getLiveRegion(view).textContent).toBe(
        m.contactEmailSendError({}, { locale: "en-US" })
      );
    });
    expect(submitContactForm).toHaveBeenCalledTimes(1);
    expectSubmittedValues(view);
  });

  test("keeps the submitted values and announces an error when the action input is rejected", async () => {
    submitContactForm.mockImplementation(() =>
      Promise.resolve({
        validationErrors: { formErrors: ["Synthetic invalid form data"] },
      })
    );
    const { ContactForm } = await import("./contact-form");
    const view = render(<ContactForm locale="en-US" />);

    fillAndSubmit(view);

    await waitFor(() => {
      expect(getLiveRegion(view).textContent).toBe(
        m.contactValidationReviewMessage({}, { locale: "en-US" })
      );
    });
    expect(submitContactForm).toHaveBeenCalledTimes(1);
    expectSubmittedValues(view);
  });

  test("keeps the status live region mounted before any message appears", async () => {
    submitContactForm.mockImplementation(() =>
      Promise.resolve({
        data: {
          status: "success",
          message: m.contactSuccessMessage({}, { locale: "en-US" }),
        },
      })
    );
    const { ContactForm } = await import("./contact-form");
    const view = render(<ContactForm locale="en-US" />);
    const liveRegion = getLiveRegion(view);

    expect(liveRegion.textContent).toBe("");

    fillAndSubmit(view);

    await waitFor(() => {
      expect(liveRegion.textContent).toBe(
        m.contactSuccessMessage({}, { locale: "en-US" })
      );
    });
    expect(getLiveRegion(view)).toBe(liveRegion);
  });

  test("clears the fields after consecutive successful submissions", async () => {
    submitContactForm.mockImplementation(() =>
      Promise.resolve({
        data: {
          status: "success",
          message: m.contactSuccessMessage({}, { locale: "en-US" }),
        },
      })
    );
    const { ContactForm } = await import("./contact-form");
    const view = render(
      <ContactForm
        locale="en-US"
        initialValues={{ name: "Synthetic Prefill" }}
      />
    );

    for (const submission of [1, 2]) {
      fillAndSubmit(view);
      await waitFor(() => {
        expect(submitContactForm).toHaveBeenCalledTimes(submission);
        expect(fieldValue(view, "Name")).toBe("");
        expect(fieldValue(view, "Email")).toBe("");
        expect(fieldValue(view, "Phone")).toBe("");
        expect(fieldValue(view, "Message")).toBe("");
      });
    }
  });
});
