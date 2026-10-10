import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { AdministrationInvoiceCreateInput } from "@deskohub/workspace-admin-api";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { Schema } from "effect";
import { createElement } from "react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { InvoiceFormOutput } from "./invoice-form";

mock.module("./actions", () => ({
  createAdministrationInvoice: async () => ({}),
  previewAdministrationInvoice: async () => ({}),
  searchAdministrationInvoiceCustomers: async () => ({}),
}));

// The form module (and the Radix dialog it renders) must be imported after
// the happy-dom global registration, or the dialog portal never mounts.
let getInvoiceDraftId: typeof import("./invoice-form").getInvoiceDraftId;
let getInvoiceReviewTotal: typeof import("./invoice-form").getInvoiceReviewTotal;
let InvoiceCreationForm: typeof import("./invoice-form").InvoiceCreationForm;
let invoiceFormSchema: typeof import("./invoice-form").invoiceFormSchema;
let isInvoicePriceInput: typeof import("./invoice-form").isInvoicePriceInput;
let readInvoiceForm: typeof import("./invoice-form").readInvoiceForm;

beforeAll(async () => {
  registerWorkspaceComponentTestEnv();
  ({
    getInvoiceDraftId,
    getInvoiceReviewTotal,
    InvoiceCreationForm,
    invoiceFormSchema,
    isInvoicePriceInput,
    readInvoiceForm,
  } = await import("./invoice-form"));
});
beforeEach(() => {
  workspaceUseAction.mockReset();
  window.happyDOM.setURL("https://deskohub.test/admin/invoices/new");
});
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});
afterAll(unregisterWorkspaceComponentTestEnv);

const formValues = ({
  customer,
  ...overrides
}: {
  readonly customer?: Partial<InvoiceFormOutput["customer"]>;
} & Partial<Omit<InvoiceFormOutput, "customer">> = {}): InvoiceFormOutput => ({
  customer: {
    customerType: "person",
    email: "billing@example.test",
    firstName: "Synthetic",
    lastName: "Customer",
    companyName: "",
    companyId: "",
    vatId: "",
    phone: "",
    line1: "Synthetic 1",
    line2: "",
    city: "Prague",
    postalCode: "110 00",
    country: "CZ",
    ...customer,
  },
  locale: "en-US",
  serviceDate: "2026-08-18",
  paid: false,
  paidOn: "2026-08-18",
  dueDate: "2026-09-01",
  currency: "CZK",
  variableSymbol: "2026000001",
  lines: [{ id: "line-1", description: "Space rental", price: "1000" }],
  ...overrides,
});

const validateFormSchema = (values: InvoiceFormOutput) =>
  Schema.toStandardSchemaV1(invoiceFormSchema)["~standard"].validate(values);

const expectRejectedAtPath = async (
  values: InvoiceFormOutput,
  path: string
) => {
  const result = await validateFormSchema(values);
  const issues = "issues" in result ? result.issues : undefined;
  expect(issues && JSON.stringify(issues)).toContain(path);
};

test("calculates the immutable review total without losing precision", () => {
  expect(
    getInvoiceReviewTotal([
      { price: "900719925474099312345678.02" },
      { price: "-0.01" },
    ])
  ).toBe("900719925474099312345678.01");
  expect(getInvoiceReviewTotal([{ price: "not-a-price" }])).toBeNull();
});

test("rejects prices beyond the selected currency precision", () => {
  expect(getInvoiceReviewTotal([{ price: "1.234" }], 2)).toBeNull();
  expect(getInvoiceReviewTotal([{ price: "-1.23" }], 2)).toBe("-1.23");
  expect(isInvoicePriceInput("1.234", 2)).toBeFalse();
  expect(isInvoicePriceInput("-1.23", 2)).toBeTrue();
});

test("omits blank optional business contact names", () => {
  const input = readInvoiceForm({
    customer: null,
    customerMode: "new",
    values: formValues({
      customer: {
        customerType: "business",
        firstName: "",
        lastName: "",
        companyName: "Example s.r.o.",
        companyId: "12345678",
        vatId: "CZ12345678",
        phone: "1".repeat(20),
        line2: "Floor 2",
      },
    }),
    invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21",
    suggestedVariableSymbol: "2026000002",
  });

  expect(input.customer.details).not.toHaveProperty("firstName");
  expect(input.customer.details).not.toHaveProperty("lastName");
  expect(input.variableSymbol).toBe("2026000001");
  expect(() =>
    Schema.decodeUnknownSync(AdministrationInvoiceCreateInput)(input)
  ).not.toThrow();
});

test("rejects values beyond the server-mirrored boundary lengths", async () => {
  await expectRejectedAtPath(
    formValues({ customer: { phone: "1".repeat(21) } }),
    '"phone"'
  );
  await expectRejectedAtPath(
    formValues({ customer: { email: `${"a".repeat(250)}@example.test` } }),
    '"email"'
  );
  await expectRejectedAtPath(
    formValues({ customer: { line2: "2".repeat(181) } }),
    '"line2"'
  );
  await expectRejectedAtPath(
    formValues({
      customer: {
        customerType: "business",
        firstName: "",
        lastName: "",
        vatId: "CZ".concat("1".repeat(254)),
      },
    }),
    '"vatId"'
  );
  await expectRejectedAtPath(
    formValues({
      customer: {
        customerType: "business",
        firstName: "S".repeat(101),
        lastName: "",
      },
    }),
    '"firstName"'
  );

  const valid = await validateFormSchema(formValues());
  expect("value" in valid).toBe(true);
});

test("preserves the reviewed variable symbol", () => {
  expect(
    readInvoiceForm({
      customer: null,
      customerMode: "new",
      values: formValues({ variableSymbol: "2026000001" }),
      invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21",
      suggestedVariableSymbol: "2026000002",
    }).variableSymbol
  ).toBe("2026000001");
});

test("reads the visible payment date as paid on when already paid", () => {
  expect(
    readInvoiceForm({
      customer: null,
      customerMode: "new",
      values: formValues({ paid: true, paidOn: "2026-08-20" }),
      invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21",
      suggestedVariableSymbol: "2026000002",
    })
  ).toHaveProperty("payment", { status: "paid", date: "2026-08-20" });
});

test("reuses an existing draft id and generates one when absent", () => {
  const firstId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21";

  expect(getInvoiceDraftId(firstId)).toBe(firstId);
  expect(getInvoiceDraftId(null)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

const renderInvoiceCreationForm = ({
  currencies = [{ code: "CZK", exponent: 2, name: "Czech koruna" }],
  defaultCurrency = "CZK",
}: {
  readonly currencies?: {
    readonly code: string;
    readonly exponent: number;
    readonly name: string;
  }[];
  readonly defaultCurrency?: string;
} = {}) =>
  render(
    createElement(InvoiceCreationForm, {
      currencies,
      defaultCurrency,
      defaultDueDate: "2026-09-01",
      defaultServiceDate: "2026-08-18",
      suggestedVariableSymbol: "2026000001",
    })
  );

type InvoiceFormView = ReturnType<typeof renderInvoiceCreationForm>;

const fillInput = (
  view: InvoiceFormView,
  label: string,
  value: string,
  index?: number
) => {
  const input = (
    index === undefined
      ? view.getByLabelText(label)
      : view.getAllByLabelText(label)[index]
  ) as HTMLInputElement;
  fireEvent.input(input, { target: { value } });
  return input;
};

const fillPersonRequiredFields = (view: InvoiceFormView) => {
  fillInput(view, "Invoice email", "billing@example.test");
  fillInput(view, "First name", "Synthetic");
  fillInput(view, "Last name", "Customer");
  fillInput(view, "Address", "Synthetic 1");
  fillInput(view, "City", "Prague");
  fillInput(view, "Postal code", "110 00");
  fillInput(view, "Description 1", "Space rental");
  fireEvent.change(view.getByLabelText("Price"), {
    target: { value: "1000" },
  });
};

const fillValidPersonInvoice = (view: InvoiceFormView) => {
  fireEvent.click(view.getByRole("button", { name: "New" }));
  fillPersonRequiredFields(view);
};

const mockPreviewAction = () => {
  const preview = mock();
  workspaceUseAction.mockImplementation((_action, options) => {
    const actionName = (options as { readonly actionName: string }).actionName;
    if (actionName === "previewAdministrationInvoice") {
      return { execute: preview, isExecuting: false } as never;
    }
    return { execute: mock(), isExecuting: false } as never;
  });
  return preview;
};

const submitInvoiceForm = (view: InvoiceFormView) => {
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Invoice form missing");
  fireEvent.submit(form);
};

const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const invoiceIdOf = (call: unknown[] | undefined) => {
  if (!call) throw new Error("Expected an action call");
  return (call[0] as { invoiceId: string }).invoiceId;
};

test("carries edited fields into the review payload", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  fillInput(view, "Country code", "cz");

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");

  expect(preview).toHaveBeenCalledTimes(1);
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({
      customer: {
        kind: "new",
        details: expect.objectContaining({
          kind: "person",
          firstName: "Synthetic",
          lastName: "Customer",
          address: expect.objectContaining({ country: "CZ" }),
        }),
      },
    })
  );
});

test("shows validation feedback and skips the preview for an invalid invoice", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fireEvent.click(view.getByRole("button", { name: "New" }));
  // "1." passes the controlled input gate for exponent 2 but fails the
  // submitted price pattern.
  fireEvent.change(view.getByLabelText("Price"), {
    target: { value: "1." },
  });

  submitInvoiceForm(view);
  expect(
    (await view.findAllByText("This field is required.")).length
  ).toBeGreaterThan(0);
  expect(view.getByText("Enter a valid line price.")).toBeTruthy();
  expect(preview).not.toHaveBeenCalled();
});

test("reuses the draft id for an unchanged retry and rotates it after a change", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  const firstInvoiceId = invoiceIdOf(preview.mock.calls[0]);

  submitInvoiceForm(view);
  await flush();
  expect(preview).toHaveBeenCalledTimes(2);
  expect(invoiceIdOf(preview.mock.calls[1])).toBe(firstInvoiceId);

  fillInput(view, "First name", "Changed");
  submitInvoiceForm(view);
  await flush();
  expect(preview).toHaveBeenCalledTimes(3);
  const thirdInvoiceId = invoiceIdOf(preview.mock.calls[2]);
  expect(thirdInvoiceId).not.toBe(firstInvoiceId);
  expect(getInvoiceDraftId(thirdInvoiceId)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

test("retries creation with the same id for an unchanged invoice and a new id after a change", async () => {
  const preview = mock();
  const create = mock();
  let previewOnSuccess:
    | ((result: { data: { dataUrl: string } }) => void)
    | undefined;
  let createOnError:
    | ((result: { error: { serverError: string } }) => void)
    | undefined;
  workspaceUseAction.mockImplementation((_action, options) => {
    const actionOptions = options as {
      readonly actionName: string;
      readonly onSuccess?: typeof previewOnSuccess;
      readonly onError?: typeof createOnError;
    };
    if (actionOptions.actionName === "previewAdministrationInvoice") {
      previewOnSuccess = actionOptions.onSuccess;
      return { execute: preview, isExecuting: false } as never;
    }
    if (actionOptions.actionName === "createAdministrationInvoice") {
      createOnError = actionOptions.onError;
      return { execute: create, isExecuting: false } as never;
    }
    return { execute: mock(), isExecuting: false } as never;
  });
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);

  const submitAndCreate = async () => {
    submitInvoiceForm(view);
    await flush();
    act(() =>
      previewOnSuccess?.({
        data: { dataUrl: "data:text/plain;base64,PA==" },
      })
    );
    const createButton = view.getByRole("button", {
      name: "Create and send invoice",
    });
    expect(createButton).toHaveProperty("disabled", false);
    fireEvent.click(createButton);
    await flush();
  };

  await submitAndCreate();
  expect(create).toHaveBeenCalledTimes(1);
  const firstInvoiceId = invoiceIdOf(create.mock.calls[0]);

  act(() => createOnError?.({ error: { serverError: "Create exploded." } }));
  expect(view.getByText("Create exploded.")).toBeTruthy();

  await submitAndCreate();
  expect(create).toHaveBeenCalledTimes(2);
  expect(invoiceIdOf(create.mock.calls[1])).toBe(firstInvoiceId);

  fillInput(view, "First name", "Changed");
  await submitAndCreate();
  expect(create).toHaveBeenCalledTimes(3);
  expect(invoiceIdOf(create.mock.calls[2])).not.toBe(firstInvoiceId);
});

test("leaves an unedited suggested variable symbol to the server", async () => {
  const preview = mock();
  const create = mock();
  let previewOnSuccess:
    | ((result: { data: { dataUrl: string } }) => void)
    | undefined;
  workspaceUseAction.mockImplementation((_action, options) => {
    const actionOptions = options as {
      readonly actionName: string;
      readonly onSuccess?: typeof previewOnSuccess;
    };
    if (actionOptions.actionName === "previewAdministrationInvoice") {
      previewOnSuccess = actionOptions.onSuccess;
      return { execute: preview, isExecuting: false } as never;
    }
    if (actionOptions.actionName === "createAdministrationInvoice") {
      return { execute: create, isExecuting: false } as never;
    }
    return { execute: mock(), isExecuting: false } as never;
  });
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);

  submitInvoiceForm(view);
  await flush();
  // The preview still shows the suggestion the operator reviewed.
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({ variableSymbol: "2026000001" })
  );
  act(() =>
    previewOnSuccess?.({ data: { dataUrl: "data:text/plain;base64,PA==" } })
  );
  fireEvent.click(
    view.getByRole("button", { name: "Create and send invoice" })
  );
  await flush();

  // The page-load suggestion goes stale once another invoice is issued, so
  // only the final invoice number may determine the default symbol.
  expect(create).toHaveBeenCalledTimes(1);
  expect(create.mock.calls[0]?.[0]).not.toHaveProperty("variableSymbol");
});

test("keeps the draft id when a whitespace-only edit produces the same payload", async () => {
  const preview = mock();
  const create = mock();
  let previewOnSuccess:
    | ((result: { data: { dataUrl: string } }) => void)
    | undefined;
  let createOnError:
    | ((result: { error: { serverError: string } }) => void)
    | undefined;
  workspaceUseAction.mockImplementation((_action, options) => {
    const actionOptions = options as {
      readonly actionName: string;
      readonly onSuccess?: typeof previewOnSuccess;
      readonly onError?: typeof createOnError;
    };
    if (actionOptions.actionName === "previewAdministrationInvoice") {
      previewOnSuccess = actionOptions.onSuccess;
      return { execute: preview, isExecuting: false } as never;
    }
    if (actionOptions.actionName === "createAdministrationInvoice") {
      createOnError = actionOptions.onError;
      return { execute: create, isExecuting: false } as never;
    }
    return { execute: mock(), isExecuting: false } as never;
  });
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  fillInput(view, "Variable symbol", "20260001 ");

  const submitAndFail = async () => {
    submitInvoiceForm(view);
    await flush();
    act(() =>
      previewOnSuccess?.({
        data: { dataUrl: "data:text/plain;base64,PA==" },
      })
    );
    const createButton = view.getByRole("button", {
      name: "Create and send invoice",
    });
    expect(createButton).toHaveProperty("disabled", false);
    fireEvent.click(createButton);
    await flush();
    act(() =>
      createOnError?.({ error: { serverError: "Create interrupted." } })
    );
  };

  await submitAndFail();
  expect(create).toHaveBeenCalledTimes(1);
  const firstCall = create.mock.calls[0];
  const firstInvoiceId = invoiceIdOf(firstCall);

  // A whitespace-only variableSymbol edit is payload-equivalent once
  // readInvoiceForm trims it, so the interrupted draft id must be reused
  // instead of minting a fresh id the server would accept as a new invoice.
  fillInput(view, "Variable symbol", "20260001");
  await submitAndFail();

  expect(create).toHaveBeenCalledTimes(2);
  expect(invoiceIdOf(create.mock.calls[1])).toBe(firstInvoiceId);
  expect(create.mock.calls[1]).toEqual(firstCall);
});

test("renders preview and create action errors as alerts", async () => {
  let previewOnError:
    | ((result: { error: { serverError: string } }) => void)
    | undefined;
  let createOnError:
    | ((result: { error: { serverError: string } }) => void)
    | undefined;
  workspaceUseAction.mockImplementation((_action, options) => {
    const actionOptions = options as {
      readonly actionName: string;
      readonly onError?: typeof previewOnError;
    };
    if (actionOptions.actionName === "previewAdministrationInvoice") {
      previewOnError = actionOptions.onError;
      return { execute: mock(), isExecuting: false } as never;
    }
    if (actionOptions.actionName === "createAdministrationInvoice") {
      createOnError = actionOptions.onError;
    }
    return { execute: mock(), isExecuting: false } as never;
  });
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  act(() => previewOnError?.({ error: { serverError: "Preview exploded." } }));
  expect(view.getByText("Preview exploded.")).toBeTruthy();
  act(() => createOnError?.({ error: { serverError: "Create exploded." } }));
  expect(view.getByText("Create exploded.")).toBeTruthy();
});

const expectLabelsToMatchInputs = (view: InvoiceFormView) => {
  const labels = [
    ...view.container.querySelectorAll("label[for]"),
  ] as HTMLLabelElement[];
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    const input = view.container.querySelector(`#${CSS.escape(label.htmlFor)}`);
    expect(
      input,
      `label "${label.textContent}" points at missing id "${label.htmlFor}"`
    ).toBeTruthy();
    // Checkbox controls render as buttons with role="checkbox", so allow
    // both native and ARIA-labelable targets.
    const tagName = input?.tagName ?? "";
    expect(
      ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tagName),
      `label htmlFor "${label.htmlFor}" does not target a form control`
    ).toBe(true);
  }
};

test("associates every label with its rendered input", () => {
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
  const view = renderInvoiceCreationForm();
  expectLabelsToMatchInputs(view);

  fireEvent.click(view.getByRole("button", { name: "Add line" }));
  expectLabelsToMatchInputs(view);

  fireEvent.click(view.getByRole("button", { name: "Remove line 2" }));
  expectLabelsToMatchInputs(view);
});

test("manages line items and gates price input by currency precision", () => {
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
  const view = renderInvoiceCreationForm();
  fireEvent.click(view.getByRole("button", { name: "New" }));

  const singleRemove = view.getByRole("button", { name: "Remove line 1" });
  expect(singleRemove).toHaveProperty("disabled", true);

  fireEvent.click(view.getByRole("button", { name: "Add line" }));
  expect(view.getByLabelText("Description 2")).toBeTruthy();
  const remove2 = view.getByRole("button", { name: "Remove line 2" });
  expect(remove2).toHaveProperty("disabled", false);

  const firstPrice = view.getAllByLabelText("Price")[0] as HTMLInputElement;
  fireEvent.change(firstPrice, { target: { value: "1.23" } });
  expect(firstPrice.value).toBe("1.23");
  fireEvent.change(firstPrice, { target: { value: "1.234" } });
  expect(firstPrice.value).toBe("1.23");

  fireEvent.click(remove2);
  expect(view.queryByLabelText("Description 2")).toBeNull();
  expect(view.getByLabelText("Description 1")).toBeTruthy();
});

test("previews the suggested variable symbol after restoring the default", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fireEvent.click(view.getByRole("button", { name: "New" }));
  const variableSymbol = view.getByLabelText(
    "Variable symbol"
  ) as HTMLInputElement;
  fireEvent.input(variableSymbol, { target: { value: "" } });
  fireEvent.blur(variableSymbol);
  expect(variableSymbol.value).toBe("2026000001");
  fireEvent.focus(variableSymbol);
  expect(variableSymbol.selectionStart).toBe(0);
  expect(variableSymbol.selectionEnd).toBe(variableSymbol.value.length);
  fillValidPersonInvoice(view);
  fillInput(view, "Variable symbol", "");
  fireEvent.blur(view.getByLabelText("Variable symbol"));

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({ variableSymbol: "2026000001" })
  );
});

test("accepts retained business values after switching to an individual", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fireEvent.click(view.getByRole("button", { name: "New" }));
  fireEvent.change(view.getByLabelText("Customer type"), {
    target: { value: "business" },
  });
  fillInput(view, "Company name", "C".repeat(200));
  fireEvent.change(view.getByLabelText("Customer type"), {
    target: { value: "person" },
  });
  fillPersonRequiredFields(view);

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({
      customer: {
        kind: "new",
        details: expect.objectContaining({ kind: "person" }),
      },
    })
  );
});

test("previews an edited variable symbol unchanged", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  fillInput(view, "Variable symbol", "9876543210");

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({ variableSymbol: "9876543210" })
  );
});

test("switches the invoice date from due date to paid on", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);

  expect(view.getByLabelText("Due date")).toHaveProperty("value", "2026-09-01");
  fireEvent.click(view.getByRole("checkbox", { name: "Already paid" }));
  expect(view.queryByLabelText("Due date")).toBeNull();
  expect(view.getByLabelText("Paid on")).toHaveProperty("value", "2026-08-18");

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({
      payment: { status: "paid", date: "2026-08-18" },
    })
  );
});

test("ignores a blank hidden due date once already paid is selected", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  fillInput(view, "Due date", "");

  submitInvoiceForm(view);
  await view.findByText("This field is required.");
  expect(preview).not.toHaveBeenCalled();

  fireEvent.click(view.getByRole("checkbox", { name: "Already paid" }));
  expect(view.queryByLabelText("Due date")).toBeNull();
  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({
      payment: { status: "paid", date: "2026-08-18" },
    })
  );
});

const priceInputOf = (view: InvoiceFormView) =>
  view.getByLabelText("Price") as HTMLInputElement;

const previewPayloadOf = (
  preview: ReturnType<typeof mockPreviewAction>,
  callIndex: number
) =>
  preview.mock.calls[callIndex]![0] as {
    readonly lines: { readonly price: string }[];
  };

test("accepts a browser-typed price and keeps a rejected one out of the payload", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  const priceInput = priceInputOf(view);

  // Browser-style typing: input events through the same handler the other
  // fields use.
  fireEvent.input(priceInput, { target: { value: "1250.5" } });
  expect(priceInput.value).toBe("1250.5");

  // More precision than the currency allows: rejected, never enters state.
  fireEvent.input(priceInput, { target: { value: "1250.555" } });
  expect(priceInput.value).toBe("1250.555");

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  expect(previewPayloadOf(preview, 0).lines[0]).toEqual({
    description: "Space rental",
    price: "1250.5",
  });
});

test("follows the switched currency exponent when gating price input", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm({
    currencies: [
      { code: "JPY", exponent: 0, name: "Japanese yen" },
      { code: "CZK", exponent: 2, name: "Czech koruna" },
    ],
  });
  fillValidPersonInvoice(view);
  const priceInput = priceInputOf(view);
  expect(priceInput.value).toBe("1000");

  // Exponent 0 rejects any decimal places.
  fireEvent.change(view.getByLabelText("Currency"), {
    target: { value: "JPY" },
  });
  fireEvent.change(priceInput, { target: { value: "1.5" } });
  expect(priceInput.value).toBe("1000");
  fireEvent.input(priceInput, { target: { value: "1.5" } });
  expect(priceInput.value).toBe("1.5");

  submitInvoiceForm(view);
  await view.findByText("This action creates and sends the invoice");
  const jpyPayload = previewPayloadOf(preview, 0);
  expect(jpyPayload.lines[0]).toEqual({
    description: "Space rental",
    price: "1000",
  });

  // Exponent 2 accepts the decimal again.
  fireEvent.change(view.getByLabelText("Currency"), {
    target: { value: "CZK" },
  });
  fireEvent.input(priceInput, { target: { value: "1.5" } });
  expect(priceInput.value).toBe("1.5");

  submitInvoiceForm(view);
  await flush();
  const czkPayload = previewPayloadOf(preview, 1);
  expect(czkPayload.lines[0]).toEqual({
    description: "Space rental",
    price: "1.5",
  });
});
