import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { ContactFormState } from "@/features/contact/actions/contact";
import type { submitContactForm } from "@/features/contact/actions/submit-contact";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { resolveContactFormState } from "./contact-form-state";

type TestingLibrary = typeof import("@testing-library/react/pure");
let cleanup: TestingLibrary["cleanup"];
let fireEvent: TestingLibrary["fireEvent"];
let render: TestingLibrary["render"];
let waitFor: TestingLibrary["waitFor"];

let response: { data?: unknown; serverError?: unknown } = {
  data: { status: "idle" },
};
let contactSearchParams = "";
const calls: FormData[] = [];
const submitContactFormMock = Object.assign(
  mock(
    async (
      _previous: Parameters<typeof submitContactForm>[0],
      data: Parameters<typeof submitContactForm>[1]
    ) => {
      calls.push(data);
      return response;
    }
  ),
  {
    $$FORM_ACTION: (prefix: string) => ({
      name: prefix,
      action: "/en-US/contact",
      method: "POST",
      encType: "multipart/form-data",
      data: null,
    }),
  }
);
mock.module("@/features/contact/actions/submit-contact", () => ({
  submitContactForm: submitContactFormMock,
}));
mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(contactSearchParams),
}));

describe("ContactForm", () => {
  beforeAll(async () => {
    registerWorkspaceComponentTestEnv();
    ({ cleanup, fireEvent, render, waitFor } = await import(
      "@testing-library/react/pure"
    ));
  });
  beforeEach(() => {
    response = { data: { status: "idle" } };
    contactSearchParams = "";
    calls.length = 0;
  });
  afterEach(() => cleanup());
  afterAll(unregisterWorkspaceComponentTestEnv);

  test("prefills values and retains a native form action", async () => {
    const { ContactForm } = await import("./contact-form");
    const view = render(
      <ContactForm
        locale="en-US"
        initialValues={{
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+420777777777",
          message: "Please help with a reservation.",
        }}
      />
    );
    for (const [label, value] of [
      ["Name", "Ada Lovelace"],
      ["Email", "ada@example.com"],
      ["Phone", "+420777777777"],
      ["Message", "Please help with a reservation."],
    ]) {
      expect((view.getByLabelText(label) as HTMLInputElement).value).toBe(
        value
      );
    }
    const form = view.container.querySelector("form");
    expect(form?.getAttribute("action")).toBeTruthy();
  });

  test("validates and submits edited field values after hydration", async () => {
    response = { data: { status: "success", message: "Sent" } };
    const { ContactForm } = await import("./contact-form");
    const view = render(<ContactForm locale="en-US" />);
    await waitFor(() =>
      expect(
        view.container.querySelector("form")?.getAttribute("data-rhf-ready")
      ).toBe("true")
    );

    for (const [label, value] of [
      ["Name", "Grace Hopper"],
      ["Email", "grace@example.com"],
      ["Message", "Please contact me about a meeting room."],
    ]) {
      const field = view.getByLabelText(label) as HTMLInputElement;
      fireEvent.change(field, { target: { value } });
      expect(field.value).toBe(value);
    }
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    expect(form.getAttribute("data-rhf-ready")).toBe("true");
    const submittedValues = new FormData(form);
    expect(submittedValues.get("name")).toBe("Grace Hopper");
    expect(submittedValues.get("email")).toBe("grace@example.com");
    expect(submittedValues.get("message")).toBe(
      "Please contact me about a meeting room."
    );
    fireEvent.submit(form);

    const clientValidationMessage = m.contactValidationReviewMessage(
      {},
      {
        locale: "en-US",
      }
    );
    await waitFor(() =>
      expect(
        calls.length === 1 || view.queryByText(clientValidationMessage) !== null
      ).toBe(true)
    );
    expect(view.queryByText(clientValidationMessage)).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.get("name")).toBe("Grace Hopper");
    expect(calls[0]?.get("email")).toBe("grace@example.com");
    expect(calls[0]?.get("message")).toBe(
      "Please contact me about a meeting room."
    );
    await waitFor(() =>
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("")
    );
    expect(view.getByText("Sent")).toBeTruthy();
  });

  test("keeps edited values when only unrelated query parameters change", async () => {
    contactSearchParams = "name=Query+Prefill";
    const { ContactForm } = await import("./contact-form");
    const view = render(<ContactForm locale="en-US" />);
    const nameInput = view.getByLabelText("Name") as HTMLInputElement;

    await waitFor(() => expect(nameInput.value).toBe("Query Prefill"));
    fireEvent.change(nameInput, { target: { value: "X" } });
    contactSearchParams = "name=Query+Prefill&source=campaign";
    view.rerender(<ContactForm locale="en-US" />);

    await waitFor(() =>
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("X")
    );
  });

  test("shows localized errors and retains invalid values", async () => {
    const locale = "cs-CZ";
    const values = {
      name: " A ",
      email: "bad",
      phone: "bad",
      message: " short ",
    };
    const { ContactForm } = await import("./contact-form");
    const view = render(<ContactForm locale={locale} initialValues={values} />);
    view.rerender(<ContactForm locale={locale} initialValues={values} />);
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(
        view.getByText(m.contactValidationNameMinimum({ min: 2 }, { locale }))
      ).toBeTruthy()
    );
    expect(
      view.getByText(m.contactValidationReviewMessage({}, { locale }))
    ).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect(
      (
        view.getByLabelText(
          m.contactNameLabel({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe(" A ");
  });

  test("submits valid data and clears the form on success", async () => {
    response = { data: { status: "success", message: "Sent" } };
    const { ContactForm } = await import("./contact-form");
    const view = render(
      <ContactForm
        locale="en-US"
        initialValues={{
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "",
          message: "Please help with a reservation.",
        }}
      />
    );
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    fireEvent.submit(form);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.get("name")).toBe("Ada Lovelace");
    expect(calls[0]?.get("locale")).toBe("en-US");
    await waitFor(() =>
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("")
    );
    await waitFor(() =>
      expect(
        view.container.querySelector("form")?.getAttribute("data-rhf-ready")
      ).toBe("true")
    );
    expect(view.getByText("Sent")).toBeTruthy();

    const reviewMessage = m.contactValidationReviewMessage(
      {},
      { locale: "en-US" }
    );
    fireEvent.submit(form);
    await waitFor(() => expect(view.getByText(reviewMessage)).toBeTruthy());
    expect(view.queryByText("Sent")).toBeNull();
    expect(calls).toHaveLength(1);

    for (const [label, value] of [
      ["Name", "Ada Lovelace"],
      ["Email", "ada@example.com"],
      ["Message", "Please help with a reservation."],
    ]) {
      fireEvent.change(view.getByLabelText(label), { target: { value } });
    }
    expect(view.getByText(reviewMessage)).toBeTruthy();

    response = { data: { status: "success", message: "Sent again" } };
    fireEvent.submit(form);
    await waitFor(() => expect(calls).toHaveLength(2));
    await waitFor(() => expect(view.getByText("Sent again")).toBeTruthy());
    expect(view.queryByText(reviewMessage)).toBeNull();
  });

  test("shows hydrated server field errors with retained values and accessibility links", async () => {
    const locale = "cs-CZ";
    const message = m.contactValidationReviewMessage({}, { locale });
    const nameError = m.contactValidationNameMinimum({ min: 2 }, { locale });
    const state: ContactFormState = {
      status: "error",
      message,
      values: {
        name: " S ",
        email: "bad",
        phone: "",
        message: " short ",
      },
      fieldErrors: { name: nameError },
    };
    response = { data: state };
    const { ContactForm } = await import("./contact-form");
    const view = render(
      <ContactForm
        locale={locale}
        initialValues={{
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "",
          message: "Please help with a reservation.",
        }}
      />
    );
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    fireEvent.submit(form);

    await waitFor(() =>
      expect(
        (
          view.getByLabelText(
            m.contactNameLabel({}, { locale })
          ) as HTMLInputElement
        ).value
      ).toBe(state.values?.name)
    );
    const nameInput = view.getByLabelText(
      m.contactNameLabel({}, { locale })
    ) as HTMLInputElement;
    expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    expect(nameInput.getAttribute("aria-describedby")).toBe("name-error");
    expect(view.getByText(nameError).getAttribute("role")).toBe("alert");
    expect(view.getByText(message).getAttribute("aria-live")).toBe("polite");
    await waitFor(() =>
      expect(
        view.container.querySelector("form")?.getAttribute("data-rhf-ready")
      ).toBe("true")
    );
  });

  test("shows a generic action error without losing entered values", async () => {
    response = { serverError: "internal" };
    const { ContactForm } = await import("./contact-form");
    const view = render(
      <ContactForm
        locale="en-US"
        initialValues={{
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "",
          message: "Please help with a reservation.",
        }}
      />
    );
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    fireEvent.change(view.getByLabelText("Name"), {
      target: { value: "Edited Name" },
    });
    fireEvent.submit(form);
    await waitFor(() =>
      expect(
        view.getByText(m.contactEmailSendError({}, { locale: "en-US" }))
      ).toBeTruthy()
    );
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Edited Name"
    );
  });

  test("uses native success state when the hydrated state action has no outcome", () => {
    const success: ContactFormState = {
      status: "success",
      message: m.contactSuccessMessage({}, { locale: "en-US" }),
    };

    expect(
      resolveContactFormState({}, { data: success }, "Send failed.")
    ).toEqual(success);
  });

  test("projects server validation values and messages from either action state", () => {
    const locale = "cs-CZ";
    const validationError: ContactFormState = {
      status: "error",
      message: m.contactValidationReviewMessage({}, { locale }),
      values: {
        name: " S ",
        email: "bad",
        phone: "",
        message: " short ",
      },
      fieldErrors: {
        name: m.contactValidationNameMinimum({ min: 2 }, { locale }),
        email: m.contactValidationEmailInvalid({}, { locale }),
      },
    };
    const nativeSuccess: ContactFormState = {
      status: "success",
      message: m.contactSuccessMessage({}, { locale }),
    };

    expect(
      resolveContactFormState({}, { data: validationError }, "Send failed.")
    ).toEqual(validationError);
    expect(
      resolveContactFormState(
        { data: validationError },
        { data: nativeSuccess },
        "Send failed."
      )
    ).toEqual(validationError);
  });

  test("keeps hydrated action errors authoritative over the native fallback", () => {
    const genericError = "The contact request could not be sent.";
    const nativeSuccess: ContactFormState = {
      status: "success",
      message: m.contactSuccessMessage({}, { locale: "en-US" }),
    };

    expect(
      resolveContactFormState(
        { serverError: "internal" },
        { data: nativeSuccess },
        genericError
      )
    ).toEqual({ status: "error", message: genericError });
  });
});
