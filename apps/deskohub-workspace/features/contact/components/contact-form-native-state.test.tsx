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
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ContactFormState } from "@/features/contact/actions/contact";
import type { submitContactForm } from "@/features/contact/actions/submit-contact";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type TestingLibrary = typeof import("@testing-library/react/pure");
let cleanup: TestingLibrary["cleanup"];
let render: TestingLibrary["render"];
let waitFor: TestingLibrary["waitFor"];

type ContactActionResult = Awaited<ReturnType<typeof submitContactForm>>;

let nativeResult: ContactActionResult = {};
let hydratedResult: ContactActionResult = {};

const submitContactFormMock = Object.assign(
  mock<typeof submitContactForm>(async () => nativeResult),
  {
    $$FORM_ACTION: (prefix: string) => ({
      name: prefix,
      action: "/cs-CZ/contact",
      method: "POST",
      encType: "multipart/form-data",
      data: null,
    }),
  }
) satisfies typeof submitContactForm;

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

describe("ContactForm native action state", () => {
  beforeAll(async () => {
    registerWorkspaceComponentTestEnv();
    ({ cleanup, render, waitFor } = await import(
      "@testing-library/react/pure"
    ));
  });
  beforeEach(() => {
    nativeResult = {};
    hydratedResult = {};
  });
  afterEach(() => cleanup());
  afterAll(unregisterWorkspaceComponentTestEnv);

  test("server-renders a native POST with returned values and accessible field errors", async () => {
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

    const { ContactFormClient } = await import("./contact-form-client");
    const props = {
      initialValues,
      locale,
      submitAction: submitContactFormMock,
    };
    const serverMarkup = renderToStaticMarkup(<ContactFormClient {...props} />);

    expect(serverMarkup).toContain("<form");
    expect(serverMarkup.toLowerCase()).toContain('method="post"');
    expect(serverMarkup).toContain('action="/cs-CZ/contact"');
    expect(serverMarkup).toContain('name="locale" value="cs-CZ"');
    expect(serverMarkup).toContain('value=" S "');
    expect(serverMarkup).toContain('aria-invalid="true"');
    expect(serverMarkup).toContain('aria-describedby="name-error"');
    expect(serverMarkup).toContain(message);
    expect(serverMarkup).not.toContain('data-rhf-ready="true"');

    const view = render(<ContactFormClient {...props} />);
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    await waitFor(() =>
      expect(form.getAttribute("data-rhf-ready")).toBe("true")
    );
    expect(
      (
        view.getByLabelText(
          m.contactNameLabel({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe(state.values?.name);
    expect(view.getByText(nameError).getAttribute("role")).toBe("alert");
    expect(view.getByText(message).getAttribute("aria-live")).toBe("polite");
  });

  test("uses the hydrated action result ahead of the native fallback", async () => {
    const locale = "en-US";
    const state: ContactFormState = {
      status: "error",
      message: m.contactValidationReviewMessage({}, { locale }),
      values: {
        name: "Hydrated Name",
        email: "hydrated@example.invalid",
        phone: "",
        message: "Hydrated validation error.",
      },
      fieldErrors: { name: "Hydrated name error." },
    };
    nativeResult = {
      data: {
        status: "success",
        message: m.contactSuccessMessage({}, { locale }),
      },
    };
    hydratedResult = { data: state };

    const { ContactFormClient } = await import("./contact-form-client");
    const view = render(
      <ContactFormClient
        initialValues={initialValues}
        locale={locale}
        submitAction={submitContactFormMock}
      />
    );

    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
      state.values?.name
    );
    expect(view.getByText(state.message ?? "")).toBeTruthy();
    expect(view.getByText("Hydrated name error.")).toBeTruthy();
    expect(
      view.queryByText(m.contactSuccessMessage({}, { locale }))
    ).toBeNull();
  });
});
