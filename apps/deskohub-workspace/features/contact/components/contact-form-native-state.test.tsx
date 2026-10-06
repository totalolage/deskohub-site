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
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContactFormState } from "@/features/contact/actions/contact";
import type { submitContactForm } from "@/features/contact/actions/submit-contact";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type ContactActionResult = Awaited<ReturnType<typeof submitContactForm>>;

let nativeResult: ContactActionResult = {};
let hydratedResult: ContactActionResult = {};

const submitContactFormMock = Object.assign(
  mock(async () => nativeResult),
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

const useActionStateMock = mock((_action: typeof submitContactForm) => [
  nativeResult,
  submitContactFormMock,
]);
const useStateActionMock = mock(() => ({
  result: hydratedResult,
  isExecuting: false,
  execute: mock(async () => undefined),
}));

mock.module("react", () => ({ ...React, useActionState: useActionStateMock }));
mock.module("next-safe-action/stateful-hooks", () => ({
  useStateAction: useStateActionMock,
}));
mock.module("@/features/contact/actions/submit-contact", () => ({
  submitContactForm: submitContactFormMock,
}));

const initialValues = {
  name: "Initial Person",
  email: "initial@example.invalid",
  phone: "",
  message: "Initial request text.",
};

const renderContactForm = async (locale: "cs-CZ" | "en-US" = "en-US") => {
  const { ContactForm } = await import("./contact-form");
  return render(<ContactForm locale={locale} initialValues={initialValues} />);
};

describe("ContactForm native action state", () => {
  beforeAll(registerWorkspaceComponentTestEnv);
  beforeEach(() => {
    nativeResult = {};
    hydratedResult = {};
  });
  afterEach(cleanup);
  afterAll(unregisterWorkspaceComponentTestEnv);

  test("marks RHF ready after reset while keeping server markup on native POST", async () => {
    const { ContactFormClient } = await import("./contact-form-client");
    const props = {
      initialValues,
      locale: "en-US" as const,
      submitAction: submitContactFormMock as unknown as typeof submitContactForm,
    };
    const serverMarkup = renderToStaticMarkup(
      <ContactFormClient {...props} />
    );

    expect(serverMarkup).not.toContain('data-rhf-ready="true"');
    expect(serverMarkup).toContain("<form");
    expect(serverMarkup.toLowerCase()).toContain('method="post"');
    expect(serverMarkup).toContain("action=");

    const view = render(<ContactFormClient {...props} />);
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    await waitFor(() =>
      expect(form.getAttribute("data-rhf-ready")).toBe("true")
    );
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBeTruthy();
  });

  test("resets fields and shows success after a native Server Action result", async () => {
    const locale = "en-US";
    nativeResult = {
      data: {
        status: "success",
        message: m.contactSuccessMessage({}, { locale }),
      },
    };
    const view = await renderContactForm(locale);

    await waitFor(() =>
      expect(
        (
          view.getByLabelText(
            m.contactNameLabel({}, { locale })
          ) as HTMLInputElement
        ).value
      ).toBe("")
    );
    expect(
      view.getByText(m.contactSuccessMessage({}, { locale }))
    ).toBeTruthy();
  });

  test("retains native server validation values, field errors, and message", async () => {
    const locale = "cs-CZ";
    const message = m.contactValidationReviewMessage({}, { locale });
    const nameError = m.contactValidationNameMinimum({ min: 2 }, { locale });
    const emailError = m.contactValidationEmailInvalid({}, { locale });
    const state: ContactFormState = {
      status: "error",
      message,
      values: {
        name: " S ",
        email: "bad",
        phone: "",
        message: " short ",
      },
      fieldErrors: {
        name: nameError,
        email: emailError,
      },
    };
    nativeResult = { data: state };
    const view = await renderContactForm(locale);

    expect(
      (
        view.getByLabelText(
          m.contactNameLabel({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe(state.values?.name);
    expect(
      (
        view.getByLabelText(
          m.contactEmailLabel({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe(state.values?.email);
    expect(view.getByText(message)).toBeTruthy();
    expect(view.getByText(nameError)).toBeTruthy();
    expect(view.getByText(emailError)).toBeTruthy();
  });

  test("keeps hydrated action state authoritative over native state", async () => {
    const locale = "en-US";
    const hydratedMessage = m.contactValidationReviewMessage({}, { locale });
    const hydratedNameError = "Hydrated name error.";
    nativeResult = {
      data: {
        status: "success",
        message: m.contactSuccessMessage({}, { locale }),
      },
    };
    const hydratedState: ContactFormState = {
      status: "error",
      message: hydratedMessage,
      values: {
        name: "Hydrated Name",
        email: "hydrated@example.invalid",
        phone: "",
        message: "Hydrated validation error.",
      },
      fieldErrors: { name: hydratedNameError },
    };
    hydratedResult = { data: hydratedState };
    const view = await renderContactForm(locale);

    expect(
      (
        view.getByLabelText(
          m.contactNameLabel({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe(hydratedState.values?.name);
    expect(view.getByText(hydratedMessage)).toBeTruthy();
    expect(view.getByText(hydratedNameError)).toBeTruthy();
    expect(
      view.queryByText(m.contactSuccessMessage({}, { locale }))
    ).toBeNull();
  });
});
