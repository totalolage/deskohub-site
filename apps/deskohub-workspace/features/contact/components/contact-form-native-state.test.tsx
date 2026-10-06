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
import type { FieldValues, UseFormReturn } from "react-hook-form";
import * as ReactHookForm from "react-hook-form";
import type { ContactFormState } from "@/features/contact/actions/contact";
import type { submitContactForm } from "@/features/contact/actions/submit-contact";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type ContactActionResult = Awaited<ReturnType<typeof submitContactForm>>;
const realUseForm = ReactHookForm.useForm;

let nativeResult: ContactActionResult = {};
let hydratedResult: ContactActionResult = {};
const registeredFields = new Set<string>();
const readinessEvents: Array<
  | { readonly type: "invalidate" | "reset" }
  | { readonly type: "publish"; readonly fields: readonly string[] }
> = [];

const useTrackedForm = (<
  TFieldValues extends FieldValues,
  TContext = unknown,
  TTransformedValues = TFieldValues,
>(
  ...args: Parameters<
    typeof realUseForm<TFieldValues, TContext, TTransformedValues>
  >
): UseFormReturn<TFieldValues, TContext, TTransformedValues> => {
  const form = realUseForm<TFieldValues, TContext, TTransformedValues>(...args);
  const currentRegister = React.useRef(form.register);
  const currentReset = React.useRef(form.reset);
  currentRegister.current = form.register;
  currentReset.current = form.reset;

  const register = React.useCallback<
    UseFormReturn<TFieldValues, TContext, TTransformedValues>["register"]
  >((name, options) => {
    const registration = currentRegister.current(name, options);
    const fieldName = String(name);
    return {
      ...registration,
      ref: (element) => {
        registration.ref(element);
        if (element) registeredFields.add(fieldName);
        else registeredFields.delete(fieldName);
      },
    };
  }, []);
  const reset = React.useCallback<
    UseFormReturn<TFieldValues, TContext, TTransformedValues>["reset"]
  >((...resetArgs) => {
    registeredFields.clear();
    readinessEvents.push({ type: "reset" });
    return currentReset.current(...resetArgs);
  }, []);

  return { ...form, register, reset };
}) satisfies typeof realUseForm;

const submitContactFormMock = Object.assign(
  mock<typeof submitContactForm>(async () => nativeResult),
  {
    $$FORM_ACTION: (prefix: string) => ({
      name: prefix,
      action: "/en-US/contact",
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

let originalSetAttribute: typeof HTMLFormElement.prototype.setAttribute;
let originalRemoveAttribute: typeof HTMLFormElement.prototype.removeAttribute;

mock.module("react", () => ({ ...React, useActionState: useActionStateMock }));
mock.module("react-hook-form", () => ({
  ...ReactHookForm,
  useForm: useTrackedForm,
}));
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

const expectReadinessAfterRegistrationCommit = () => {
  const expectedFields = ["email", "message", "name", "phone"];
  const publications = readinessEvents.filter(
    (
      event
    ): event is Extract<
      (typeof readinessEvents)[number],
      { readonly type: "publish" }
    > => event.type === "publish"
  );

  expect(publications.length).toBeGreaterThan(0);
  expect(publications.map(({ fields }) => fields)).toEqual(
    publications.map(() => expectedFields)
  );

  let invalidated = false;
  let resetsAwaitingCommit = 0;
  for (const event of readinessEvents) {
    if (event.type === "invalidate") {
      invalidated = true;
    } else if (event.type === "reset") {
      expect(invalidated).toBe(true);
      invalidated = false;
      resetsAwaitingCommit += 1;
    } else {
      expect(resetsAwaitingCommit).toBeGreaterThan(0);
      resetsAwaitingCommit = 0;
    }
  }
  expect(resetsAwaitingCommit).toBe(0);
};

describe("ContactForm native action state", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    originalSetAttribute = HTMLFormElement.prototype.setAttribute;
    originalRemoveAttribute = HTMLFormElement.prototype.removeAttribute;
    HTMLFormElement.prototype.setAttribute = function (name, value) {
      if (name === "data-rhf-ready" && value === "true") {
        readinessEvents.push({
          type: "publish",
          fields: [...registeredFields].sort(),
        });
      }
      return originalSetAttribute.call(this, name, value);
    };
    HTMLFormElement.prototype.removeAttribute = function (name) {
      if (name === "data-rhf-ready") {
        readinessEvents.push({ type: "invalidate" });
      }
      return originalRemoveAttribute.call(this, name);
    };
  });
  beforeEach(() => {
    nativeResult = {};
    hydratedResult = {};
    registeredFields.clear();
    readinessEvents.length = 0;
  });
  afterEach(cleanup);
  afterAll(() => {
    HTMLFormElement.prototype.setAttribute = originalSetAttribute;
    HTMLFormElement.prototype.removeAttribute = originalRemoveAttribute;
    unregisterWorkspaceComponentTestEnv();
  });

  test("marks RHF ready after reset while keeping server markup on native POST", async () => {
    const { ContactFormClient } = await import("./contact-form-client");
    const props = {
      initialValues,
      locale: "en-US" as const,
      submitAction: submitContactFormMock,
    };
    const serverMarkup = renderToStaticMarkup(<ContactFormClient {...props} />);

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
    expectReadinessAfterRegistrationCommit();
  });

  test("resets fields and shows success after a native Server Action result", async () => {
    const locale = "en-US";
    const { ContactFormClient } = await import("./contact-form-client");
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
    const resetsBeforeSuccess = readinessEvents.filter(
      (event) => event.type === "reset"
    ).length;
    nativeResult = {
      data: {
        status: "success",
        message: m.contactSuccessMessage({}, { locale }),
      },
    };
    view.rerender(<ContactFormClient {...props} />);

    await waitFor(() =>
      expect(
        (
          view.getByLabelText(
            m.contactNameLabel({}, { locale })
          ) as HTMLInputElement
        ).value
      ).toBe("")
    );
    await waitFor(() =>
      expect(
        readinessEvents.filter((event) => event.type === "reset").length
      ).toBeGreaterThan(resetsBeforeSuccess)
    );
    await waitFor(() =>
      expect(form.getAttribute("data-rhf-ready")).toBe("true")
    );
    expect(
      view.getByText(m.contactSuccessMessage({}, { locale }))
    ).toBeTruthy();
    expectReadinessAfterRegistrationCommit();
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
    expectReadinessAfterRegistrationCommit();
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
    expectReadinessAfterRegistrationCommit();
  });
});
