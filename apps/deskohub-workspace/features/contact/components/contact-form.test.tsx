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
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ContactFormState } from "@/features/contact/actions/contact";
import type { submitContactForm } from "@/features/contact/actions/submit-contact";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { resolveContactFormState } from "./contact-form-state";

let response: { data?: unknown; serverError?: unknown } = {
  data: { status: "idle" },
};
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

describe("ContactForm", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  beforeEach(() => {
    response = { data: { status: "idle" } };
    calls.length = 0;
  });
  afterEach(cleanup);
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
    expect(form?.getAttribute("method")).toBe("post");
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
    expect(view.getByText("Sent")).toBeTruthy();
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
    fireEvent.submit(form);
    await waitFor(() =>
      expect(
        view.getByText(m.contactEmailSendError({}, { locale: "en-US" }))
      ).toBeTruthy()
    );
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ada Lovelace"
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
