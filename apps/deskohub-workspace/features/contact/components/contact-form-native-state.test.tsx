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
let fireEvent: TestingLibrary["fireEvent"];
let render: TestingLibrary["render"];
let waitFor: TestingLibrary["waitFor"];

type ContactActionResult = Awaited<ReturnType<typeof submitContactForm>>;

let nativeResult: ContactActionResult = {};
let hydratedResult: ContactActionResult = {};
let contactSearchParams = "";
const contactSearchParamsReads: string[] = [];
const hydratedCalls: FormData[] = [];

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
  execute: mock(async (formData: FormData) => {
    hydratedCalls.push(formData);
  }),
}));

mock.module("react", () => ({ ...React, useActionState: useActionStateMock }));
mock.module("next-safe-action/stateful-hooks", () => ({
  useStateAction: useStateActionMock,
}));
mock.module("@/features/contact/actions/submit-contact", () => ({
  submitContactForm: submitContactFormMock,
}));
mock.module("next/navigation", () => ({
  useSearchParams: () => {
    contactSearchParamsReads.push(contactSearchParams);
    return new URLSearchParams(contactSearchParams);
  },
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
    ({ cleanup, fireEvent, render, waitFor } = await import(
      "@testing-library/react/pure"
    ));
  });
  beforeEach(() => {
    nativeResult = {};
    hydratedResult = {};
    contactSearchParams = "";
    contactSearchParamsReads.length = 0;
    hydratedCalls.length = 0;
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

    const { ContactFormClient } = await import("./contact-form");
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

  test("native validation values and errors override query prefill", async () => {
    const locale = "cs-CZ";
    const state: ContactFormState = {
      status: "error",
      message: m.contactValidationReviewMessage({}, { locale }),
      values: {
        name: "Submitted Person",
        email: "submitted@example.invalid",
        phone: "",
        message: "A submitted request with enough detail.",
      },
      fieldErrors: {
        name: m.contactValidationNameMinimum({ min: 2 }, { locale }),
      },
    };
    nativeResult = { data: state };
    contactSearchParams = "name=Query+Prefill";

    const { ContactFormClient } = await import("./contact-form");
    const view = render(
      <ContactFormClient locale={locale} submitAction={submitContactFormMock} />
    );
    await waitFor(() =>
      expect(
        (
          view.getByLabelText(
            m.contactNameLabel({}, { locale })
          ) as HTMLInputElement
        ).value
      ).toBe(state.values?.name)
    );

    expect(
      (
        view.getByLabelText(
          m.contactEmailLabel({}, { locale })
        ) as HTMLInputElement
      ).value
    ).toBe(state.values.email);
    expect(view.getByText(state.fieldErrors?.name ?? "")).toBeTruthy();
    expect(view.getByText(state.message ?? "")).toBeTruthy();
  });

  test("a native success after valid edits clears an initially empty RHF form", async () => {
    const locale = "en-US";
    const { ContactFormClient } = await import("./contact-form");
    const props = { locale, submitAction: submitContactFormMock };
    const view = render(<ContactFormClient {...props} />);
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    await waitFor(() =>
      expect(form.getAttribute("data-rhf-ready")).toBe("true")
    );
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Email") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      ""
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
    expect(new FormData(form).get("name")).toBe("Grace Hopper");

    nativeResult = {
      data: {
        status: "success",
        message: m.contactSuccessMessage({}, { locale }),
      },
    };
    view.rerender(<ContactFormClient {...props} />);

    await waitFor(() =>
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("")
    );
    expect((view.getByLabelText("Email") as HTMLInputElement).value).toBe("");
    expect((view.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      ""
    );
    expect(
      view.getByText(m.contactSuccessMessage({}, { locale }))
    ).toBeTruthy();
    fireEvent.submit(form);
    const validationMessage = m.contactValidationReviewMessage({}, { locale });
    await waitFor(() =>
      expect(
        hydratedCalls.length === 1 ||
          view.queryByText(validationMessage) !== null
      ).toBe(true)
    );
    expect(view.queryByText(validationMessage)).toBeTruthy();
    await waitFor(() =>
      expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(
        false
      )
    );
    expect(hydratedCalls).toHaveLength(0);
  });

  test("query prefill arriving after native success cannot repopulate cleared values", async () => {
    const locale = "en-US";
    nativeResult = {
      data: {
        status: "success",
        message: m.contactSuccessMessage({}, { locale }),
      },
    };
    const { ContactFormClient } = await import("./contact-form");
    const props = { locale, submitAction: submitContactFormMock };
    const view = render(<ContactFormClient {...props} />);
    await waitFor(() =>
      expect(
        view.getByText(m.contactSuccessMessage({}, { locale }))
      ).toBeTruthy()
    );

    contactSearchParams = "name=Query+Prefill";
    view.rerender(<ContactFormClient {...props} />);

    expect(contactSearchParamsReads.at(-1)).toBe("name=Query+Prefill");
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("");
  });

  test("a late native validation result updates values used by RHF validation", async () => {
    const locale = "cs-CZ";
    const initialValues = {
      name: "Initial Person",
      email: "initial@example.com",
      phone: "",
      message: "Initial request text.",
    };
    const state: ContactFormState = {
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
      },
    };
    const { ContactFormClient } = await import("./contact-form");
    const props = {
      initialValues,
      locale,
      submitAction: submitContactFormMock,
    };
    const view = render(<ContactFormClient {...props} />);
    const form = view.container.querySelector("form");
    if (!form) throw new Error("Contact form did not render.");
    await waitFor(() =>
      expect(form.getAttribute("data-rhf-ready")).toBe("true")
    );

    nativeResult = { data: state };
    view.rerender(<ContactFormClient {...props} />);
    await waitFor(() =>
      expect(
        (
          view.getByLabelText(
            m.contactNameLabel({}, { locale })
          ) as HTMLInputElement
        ).value
      ).toBe(state.values.name)
    );
    expect(view.getByText(state.fieldErrors?.name ?? "")).toBeTruthy();

    fireEvent.submit(form);
    const validationMessage = m.contactValidationReviewMessage({}, { locale });
    await waitFor(() =>
      expect(
        hydratedCalls.length === 1 ||
          view.queryByText(validationMessage) !== null
      ).toBe(true)
    );
    expect(view.queryByText(validationMessage)).toBeTruthy();
    await waitFor(() =>
      expect((view.getByRole("button") as HTMLButtonElement).disabled).toBe(
        false
      )
    );
    expect(hydratedCalls).toHaveLength(0);
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

    const { ContactFormClient } = await import("./contact-form");
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
