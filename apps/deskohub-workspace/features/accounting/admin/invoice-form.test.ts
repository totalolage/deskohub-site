import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import {
  getLocaleDefinition,
  supportedLocales,
} from "@deskohub/i18n/locale-registry";
import { testEmailAddress } from "@deskohub/test-email";
import { AdministrationInvoiceCreateInput } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { createElement } from "react";
import type { InvoiceAdministrationCustomer } from "@/features/accounting/admin/invoice-administration.service";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import {
  workspaceRouterPush,
  workspaceUseAction,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { getInvoiceCustomerName } from "./invoice-display";
import type { InvoiceFormOutput } from "./invoice-form";

const billingEmail = testEmailAddress("billing");

// Distinct functions, so a hook mock can tell which action the form wired.
const invoiceActions = {
  createAdministrationInvoice: async () => ({}),
  previewAdministrationInvoice: async () => ({}),
  searchAdministrationInvoiceCustomers: async () => ({}),
};
mock.module("./actions", () => invoiceActions);
mock.module("next/navigation", () => ({
  useParams: () => ({ locale: "en-US" }),
  useRouter: () => ({ push: workspaceRouterPush }),
  // The administration's export control runs browser Effects, whose runner
  // rethrows only Next control flow, which these tests never raise.
  unstable_rethrow: () => {},
}));

registerWorkspaceComponentTestEnv();
// React DOM, which @testing-library/react and the form load, must load after
// the happy-dom registration to handle input events; the Radix dialog portal
// also needs the registered document.
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);
const {
  getInvoiceDraftId,
  getInvoiceReviewTotal,
  InvoiceCreationForm,
  createInvoiceFormSchema,
  isInvoicePriceInput,
  readInvoiceForm,
} = await import("./invoice-form");

beforeEach(() => {
  workspaceUseAction.mockReset();
  window.happyDOM.setURL("https://deskohub.test/en-US/admin/invoices/new");
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
    email: billingEmail,
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

const validateFormSchema = (
  values: InvoiceFormOutput,
  locale: Locale = "en-US"
) =>
  Schema.toStandardSchemaV1(createInvoiceFormSchema(locale))[
    "~standard"
  ].validate(values);

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
    formValues({ customer: { email: testEmailAddress("a".repeat(250)) } }),
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

const renderInvoiceCreationForm = ({
  currencies = [{ code: "CZK", exponent: 2, name: "Czech koruna" }],
  defaultCurrency = "CZK",
  locale = "en-US",
}: {
  readonly currencies?: {
    readonly code: string;
    readonly exponent: number;
    readonly name: string;
  }[];
  readonly defaultCurrency?: string;
  readonly locale?: Locale;
} = {}) =>
  render(
    createElement(
      RouteLocaleProvider,
      { locale },
      createElement(InvoiceCreationForm, {
        currencies,
        defaultCurrency,
        defaultDueDate: "2026-09-01",
        defaultServiceDate: "2026-08-18",
        suggestedVariableSymbol: "2026000001",
      })
    )
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

// A date field takes typed text when focus leaves it.
const typeDate = (view: InvoiceFormView, label: string, text: string) => {
  const field = view.getByRole("combobox", { name: label });
  fireEvent.change(field, { target: { value: text } });
  fireEvent.focusOut(field);
  return field;
};

const fillPersonRequiredFields = (view: InvoiceFormView) => {
  fillInput(view, "Invoice email", billingEmail);
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
  fireEvent.click(view.getByRole("radio", { name: "New" }));
  fillPersonRequiredFields(view);
};

const mockPreviewAction = () => {
  const preview = mock();
  workspaceUseAction.mockImplementation((action) => {
    if (action === invoiceActions.previewAdministrationInvoice) {
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

// react-hook-form keys field-array rows with `crypto.randomUUID()` during
// render, so ids it mints itself are ignored. The rest of the stack is
// searched for the form because tail calls drop intermediate frames.
const spyOnFormMintedIds = () => {
  const mintRandomUUID = crypto.randomUUID.bind(crypto);
  const minted: string[] = [];
  const randomUUID = spyOn(crypto, "randomUUID").mockImplementation(() => {
    const id = mintRandomUUID();
    const frames = (new Error().stack ?? "").split("\n");
    const callers = frames.slice(
      frames.findIndex((frame) => frame.includes("at randomUUID")) + 1
    );
    const directCaller = callers.find((frame) => !frame.includes("(native"));
    if (
      !directCaller?.includes("/react-hook-form/") &&
      callers.some((frame) => frame.includes("/admin/invoice-form.tsx"))
    ) {
      minted.push(id);
    }
    return id;
  });
  return { minted, restore: () => randomUUID.mockRestore() };
};

test("creates request identities only after user interaction", async () => {
  // A random id minted during render differs between the server and client
  // passes and between re-renders, so the draft id waits for the review.
  const preview = mockPreviewAction();
  const ids = spyOnFormMintedIds();
  try {
    const view = renderInvoiceCreationForm();
    view.rerender(
      createElement(InvoiceCreationForm, {
        currencies: [{ code: "CZK", exponent: 2, name: "Czech koruna" }],
        defaultCurrency: "CZK",
        defaultDueDate: "2026-09-01",
        defaultServiceDate: "2026-08-18",
        suggestedVariableSymbol: "2026000001",
      })
    );
    fillValidPersonInvoice(view);
    expect(ids.minted).toEqual([]);

    submitInvoiceForm(view);
    await view.findByText("This action creates and sends the invoice");
    expect(ids.minted).toEqual([invoiceIdOf(preview.mock.calls[0])]);
  } finally {
    ids.restore();
  }
});

test("shows validation feedback and skips the preview for an invalid invoice", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fireEvent.click(view.getByRole("radio", { name: "New" }));
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

test("keeps a typed decimal comma as the decimal point", () => {
  mockPreviewAction();
  const view = renderInvoiceCreationForm({ locale: "cs-CZ" });
  const price = view.getByLabelText("Cena") as HTMLInputElement;
  for (const typed of ["1", "12", "125", "1250", "1250,"]) {
    fireEvent.input(price, { target: { value: typed } });
  }
  expect(price.value).toBe("1250.");

  fireEvent.input(price, { target: { value: "99,9" } });
  expect(price.value).toBe("99.9");
});

test("offers every Workspace language for the invoice, named in itself", () => {
  mockPreviewAction();
  const view = renderInvoiceCreationForm({ locale: "cs-CZ" });
  const options = within(view.getByLabelText("Jazyk")).getAllByRole("option");
  expect(
    options.map((option) => [option.getAttribute("value"), option.textContent])
  ).toEqual(
    supportedLocales.map((option) => [
      option,
      getLocaleDefinition(option).nativeName,
    ])
  );
});

test("refuses an invoice language Workspace does not serve", async () => {
  const result = await validateFormSchema(
    formValues({ locale: "zz-ZZ" as Locale })
  );
  expect("issues" in result && JSON.stringify(result.issues)).toContain(
    "locale"
  );
});

test("shows Czech copy and validation feedback on a Czech route", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm({ locale: "cs-CZ" });
  fireEvent.click(view.getByRole("radio", { name: "Nový" }));
  fireEvent.change(view.getByLabelText("Cena"), { target: { value: "1." } });

  submitInvoiceForm(view);
  expect(
    (await view.findAllByText("Toto pole je povinné.")).length
  ).toBeGreaterThan(0);
  expect(view.getByText("Zadejte platnou cenu položky.")).toBeTruthy();
  expect(view.getByLabelText("E-mail pro fakturu")).toBeTruthy();
  expect(
    view.getByRole("button", { name: "Zkontrolovat fakturu" })
  ).toBeTruthy();
  expect(preview).not.toHaveBeenCalled();
});

test("pluralizes the Czech length limit", async () => {
  const result = await validateFormSchema(
    formValues({ customer: { phone: "1".repeat(21) } }),
    "cs-CZ"
  );
  expect("issues" in result && result.issues?.[0]?.message).toBe(
    "Použijte nejvýše 20 znaků."
  );
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
  workspaceUseAction.mockImplementation((action, options) => {
    const actionOptions = options as {
      readonly onSuccess?: typeof previewOnSuccess;
      readonly onError?: typeof createOnError;
    };
    if (action === invoiceActions.previewAdministrationInvoice) {
      previewOnSuccess = actionOptions.onSuccess;
      return { execute: preview, isExecuting: false } as never;
    }
    if (action === invoiceActions.createAdministrationInvoice) {
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
  workspaceUseAction.mockImplementation((action, options) => {
    const actionOptions = options as {
      readonly onSuccess?: typeof previewOnSuccess;
    };
    if (action === invoiceActions.previewAdministrationInvoice) {
      previewOnSuccess = actionOptions.onSuccess;
      return { execute: preview, isExecuting: false } as never;
    }
    if (action === invoiceActions.createAdministrationInvoice) {
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
  workspaceUseAction.mockImplementation((action, options) => {
    const actionOptions = options as {
      readonly onSuccess?: typeof previewOnSuccess;
      readonly onError?: typeof createOnError;
    };
    if (action === invoiceActions.previewAdministrationInvoice) {
      previewOnSuccess = actionOptions.onSuccess;
      return { execute: preview, isExecuting: false } as never;
    }
    if (action === invoiceActions.createAdministrationInvoice) {
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

test("accepts retained business values after switching to an individual", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fireEvent.click(view.getByRole("radio", { name: "New" }));
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

test("ignores a blank hidden due date once already paid is selected", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  typeDate(view, "Due date", "");

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

test("submits the typed invoice dates as calendar dates", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  typeDate(view, "Service date", "2026-08-20");
  typeDate(view, "Due date", "2026-09-15");

  const form = view.container.querySelector("form")!;
  const data = new FormData(form);
  expect([data.get("serviceDate"), data.get("dueDate")]).toEqual([
    "2026-08-20",
    "2026-09-15",
  ]);
  submitInvoiceForm(view);
  await waitFor(() =>
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceDate: "2026-08-20",
        payment: { status: "due", date: "2026-09-15" },
      })
    )
  );
});

test("submits the typed paid-on date once already paid is selected", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  fireEvent.click(view.getByRole("checkbox", { name: "Already paid" }));
  typeDate(view, "Paid on", "2026-08-25");

  const form = view.container.querySelector("form")!;
  expect(new FormData(form).get("paidOn")).toBe("2026-08-25");
  submitInvoiceForm(view);
  await waitFor(() =>
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: { status: "paid", date: "2026-08-25" },
      })
    )
  );
});

test("drops a hidden due date's unfinished text once already paid is selected", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  fireEvent.change(view.getByRole("combobox", { name: "Due date" }), {
    target: { value: "2026-13-45" },
  });

  fireEvent.click(view.getByRole("checkbox", { name: "Already paid" }));
  submitInvoiceForm(view);
  await waitFor(() =>
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        payment: { status: "paid", date: "2026-08-18" },
      })
    )
  );
});

test("keeps typed text that is no date out of the review", async () => {
  const preview = mockPreviewAction();
  const view = renderInvoiceCreationForm();
  fillValidPersonInvoice(view);
  const serviceDate = view.getByRole("combobox", { name: "Service date" });
  fireEvent.change(serviceDate, { target: { value: "2026-02-30" } });

  submitInvoiceForm(view);
  await flush();

  expect(preview).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(serviceDate);
  expect(serviceDate.getAttribute("aria-invalid")).toBe("true");
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

  // More precision than the currency allows: rejected, never enters state,
  // and the controlled field shows the accepted price again.
  fireEvent.input(priceInput, { target: { value: "1250.555" } });
  expect(priceInput.value).toBe("1250.5");

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
  expect(priceInput.value).toBe("1000");

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

const en = { locale: "en-US" } as const;

type InvoiceActionName = keyof typeof invoiceActions;

type CapturedInvoiceAction = {
  readonly execute: ReturnType<typeof mock>;
  options: {
    readonly onSuccess?: (result: { readonly data?: unknown }) => void;
    readonly onError?: (result: {
      readonly error: { readonly serverError?: string };
    }) => void;
    readonly onTransportError?: () => void;
  };
};

const captureInvoiceAction = (): CapturedInvoiceAction => ({
  execute: mock(),
  options: {},
});

// Wires every invoice action to its own execute mock and keeps the callbacks
// the form registered, so a test can settle an action the way the server would.
const captureInvoiceActions = ({
  executing = [],
}: {
  readonly executing?: readonly InvoiceActionName[];
} = {}) => {
  const captured = {
    createAdministrationInvoice: captureInvoiceAction(),
    previewAdministrationInvoice: captureInvoiceAction(),
    searchAdministrationInvoiceCustomers: captureInvoiceAction(),
  };
  workspaceUseAction.mockImplementation((action, options) => {
    const name = (Object.keys(invoiceActions) as InvoiceActionName[]).find(
      (key) => invoiceActions[key] === action
    );
    if (!name) throw new Error("Unexpected invoice action");
    captured[name].options = options as CapturedInvoiceAction["options"];
    return {
      execute: captured[name].execute,
      isExecuting: executing.includes(name),
    } as never;
  });
  return captured;
};

const businessCustomer: InvoiceAdministrationCustomer = {
  id: "customer-business",
  displayName: "Synthetic Works s.r.o.",
  hasName: true,
  email: billingEmail,
  details: {
    kind: "business",
    email: billingEmail,
    phone: "+420 111 222 333",
    companyName: "Synthetic Works s.r.o.",
    companyId: "12345678",
    vatId: "CZ12345678",
    firstName: "Synthetic",
    lastName: "Contact",
    address: {
      line1: "Synthetic 1",
      line2: "Floor 2",
      city: "Prague",
      postalCode: "110 00",
      country: "SK",
    },
  },
};

const sparsePersonCustomer: InvoiceAdministrationCustomer = {
  id: "customer-person",
  displayName: "",
  hasName: false,
  email: null,
  details: {
    kind: "person",
    email: testEmailAddress("sparse-person"),
    firstName: "Sparse",
    lastName: "Person",
    address: {
      line1: "Synthetic 2",
      city: "Brno",
      postalCode: "602 00",
      country: "",
    },
  },
};

const inputValue = (view: InvoiceFormView, label: string) =>
  (view.getByLabelText(label) as HTMLInputElement).value;

const searchCustomers = (view: InvoiceFormView, query: string) => {
  const input = view.getByLabelText(m.accountingInvoiceFormSearchLabel({}, en));
  fireEvent.input(input, { target: { value: query } });
  fireEvent.keyDown(input, { key: "Enter" });
  return input as HTMLInputElement;
};

test("searches customers by the trimmed query only once it has two characters", () => {
  const { searchAdministrationInvoiceCustomers: search } =
    captureInvoiceActions();
  const view = renderInvoiceCreationForm();
  const searchButton = view.getByRole("button", {
    name: m.accountingInvoiceFormSearch({}, en),
  });

  searchCustomers(view, " a ");
  expect(searchButton).toHaveProperty("disabled", true);
  fireEvent.click(searchButton);
  expect(search.execute).not.toHaveBeenCalled();

  const input = searchCustomers(view, "  ada  ");
  fireEvent.keyDown(input, { key: "a" });
  expect(search.execute).toHaveBeenCalledTimes(1);
  expect(search.execute).toHaveBeenCalledWith({ query: "ada" });
  expect(searchButton).toHaveProperty("disabled", false);
  fireEvent.click(searchButton);
  expect(search.execute).toHaveBeenCalledTimes(2);
});

test("blocks another search while one is running", () => {
  const { searchAdministrationInvoiceCustomers: search } =
    captureInvoiceActions({
      executing: ["searchAdministrationInvoiceCustomers"],
    });
  const view = renderInvoiceCreationForm();

  searchCustomers(view, "ada");

  expect(search.execute).not.toHaveBeenCalled();
  expect(
    view.getByRole("button", { name: m.accountingInvoiceFormSearching({}, en) })
  ).toHaveProperty("disabled", true);
});

test("prefills a selected business customer and keeps the query after changing it", () => {
  const { searchAdministrationInvoiceCustomers: search } =
    captureInvoiceActions();
  const view = renderInvoiceCreationForm();
  searchCustomers(view, "synthetic");

  act(() => search.options.onSuccess?.({ data: undefined }));
  expect(view.queryByRole("list")).toBeNull();
  act(() =>
    search.options.onSuccess?.({
      data: [businessCustomer, sparsePersonCustomer],
    })
  );
  expect(view.getAllByRole("listitem")).toHaveLength(2);
  expect(
    view.getByText(m.accountingInvoiceFormCustomerNoEmail({}, en))
  ).toBeTruthy();

  fireEvent.click(
    view.getAllByRole("button", {
      name: m.accountingInvoiceFormSelectCustomer({}, en),
    })[0]!
  );

  expect(
    view.getByText(getInvoiceCustomerName(businessCustomer, "en-US"))
  ).toBeTruthy();
  expect(
    view.queryByLabelText(m.accountingInvoiceFormSearchLabel({}, en))
  ).toBeNull();
  expect(
    (
      view.getByLabelText(
        m.accountingInvoiceFormCustomerType({}, en)
      ) as HTMLSelectElement
    ).value
  ).toBe("business");
  expect(
    [
      m.accountingInvoiceFormEmail({}, en),
      m.accountingInvoiceFormContactFirstName({}, en),
      m.accountingInvoiceFormContactLastName({}, en),
      m.accountingInvoiceFormCompanyName({}, en),
      m.accountingInvoiceFormCompanyId({}, en),
      m.accountingInvoiceFormVatId({}, en),
      m.accountingInvoiceFormPhone({}, en),
      m.accountingInvoiceFormAddressLine1({}, en),
      m.accountingInvoiceFormAddressLine2({}, en),
      m.accountingInvoiceFormCity({}, en),
      m.accountingInvoiceFormPostalCode({}, en),
      m.accountingInvoiceFormCountryCode({}, en),
    ].map((label) => inputValue(view, label))
  ).toEqual([
    billingEmail,
    "Synthetic",
    "Contact",
    "Synthetic Works s.r.o.",
    "12345678",
    "CZ12345678",
    "+420 111 222 333",
    "Synthetic 1",
    "Floor 2",
    "Prague",
    "110 00",
    "SK",
  ]);

  fireEvent.click(
    view.getByRole("button", {
      name: m.accountingInvoiceFormChangeCustomer({}, en),
    })
  );

  expect(
    view.queryByLabelText(m.accountingInvoiceFormEmail({}, en))
  ).toBeNull();
  expect(inputValue(view, m.accountingInvoiceFormSearchLabel({}, en))).toBe(
    "synthetic"
  );
  expect(view.queryByRole("list")).toBeNull();
});

test("fills blanks and the default country for a sparse person customer", () => {
  const { searchAdministrationInvoiceCustomers: search } =
    captureInvoiceActions();
  const view = renderInvoiceCreationForm();
  searchCustomers(view, "sparse");
  act(() => search.options.onSuccess?.({ data: [sparsePersonCustomer] }));

  fireEvent.click(
    view.getByRole("button", {
      name: m.accountingInvoiceFormSelectCustomer({}, en),
    })
  );

  expect(view.getByText(m.accountingUnnamedCustomer({}, en))).toBeTruthy();
  expect(
    view.queryByLabelText(m.accountingInvoiceFormCompanyName({}, en))
  ).toBeNull();
  expect(
    [
      m.accountingInvoiceFormFirstName({}, en),
      m.accountingInvoiceFormLastName({}, en),
      m.accountingInvoiceFormPhone({}, en),
      m.accountingInvoiceFormAddressLine2({}, en),
      m.accountingInvoiceFormCountryCode({}, en),
    ].map((label) => inputValue(view, label))
  ).toEqual(["Sparse", "Person", "", "", "CZ"]);

  // Switching to a new customer drops the selected one's details.
  fireEvent.click(
    view.getByRole("radio", {
      name: m.accountingInvoiceFormCustomerSourceNew({}, en),
    })
  );
  expect(view.queryByText(m.accountingUnnamedCustomer({}, en))).toBeNull();
  expect(inputValue(view, m.accountingInvoiceFormFirstName({}, en))).toBe("");
});

test("reports search failures and an empty result", () => {
  const { searchAdministrationInvoiceCustomers: search } =
    captureInvoiceActions();
  const view = renderInvoiceCreationForm();
  searchCustomers(view, "nobody");
  const searchError = m.accountingInvoiceFormSearchError({}, en);

  act(() =>
    search.options.onError?.({ error: { serverError: "Search exploded." } })
  );
  expect(view.getByRole("alert").textContent).toBe("Search exploded.");
  act(() => search.options.onError?.({ error: {} }));
  expect(view.getByRole("alert").textContent).toBe(searchError);
  searchCustomers(view, "nobody");
  expect(view.queryByRole("alert")).toBeNull();
  act(() => search.options.onTransportError?.());
  expect(view.getByRole("alert").textContent).toBe(searchError);

  act(() => search.options.onSuccess?.({ data: [] }));
  expect(view.queryByRole("alert")).toBeNull();
  expect(
    view.getByText(m.accountingInvoiceFormSearchEmpty({}, en))
  ).toBeTruthy();
});

const openReviewedInvoice = async (view: InvoiceFormView) => {
  fillValidPersonInvoice(view);
  submitInvoiceForm(view);
  await view.findByRole("dialog");
};

test("opens the created invoice and reports creation and preview failures", async () => {
  workspaceRouterPush.mockClear();
  const {
    createAdministrationInvoice: create,
    previewAdministrationInvoice: preview,
  } = captureInvoiceActions();
  const view = renderInvoiceCreationForm();
  await openReviewedInvoice(view);
  const createButton = view.getByRole("button", {
    name: m.accountingInvoiceFormCreate({}, en),
  });
  const previewError = m.accountingInvoiceFormPreviewError({}, en);

  act(() => preview.options.onSuccess?.({ data: undefined }));
  expect(createButton).toHaveProperty("disabled", true);
  act(() => preview.options.onError?.({ error: {} }));
  expect(view.getByRole("alert").textContent).toBe(previewError);
  act(() =>
    preview.options.onError?.({ error: { serverError: "Preview exploded." } })
  );
  expect(view.getByRole("alert").textContent).toBe("Preview exploded.");
  act(() => preview.options.onTransportError?.());
  expect(view.getByRole("alert").textContent).toBe(previewError);
  act(() =>
    preview.options.onSuccess?.({
      data: { dataUrl: "data:text/plain;base64,PA==" },
    })
  );
  expect(view.queryByRole("alert")).toBeNull();

  fireEvent.click(createButton);
  expect(create.execute).toHaveBeenCalledTimes(1);
  const invoiceId = invoiceIdOf(create.execute.mock.calls[0]);

  act(() => create.options.onError?.({ error: {} }));
  expect(view.getByRole("alert").textContent).toBe(
    m.accountingInvoiceFormCreateError({}, en)
  );
  act(() => create.options.onTransportError?.());
  expect(view.getByRole("alert").textContent).toBe(
    m.accountingInvoiceFormCreateError({}, en)
  );

  act(() => create.options.onSuccess?.({ data: undefined }));
  expect(workspaceRouterPush).not.toHaveBeenCalled();
  act(() => create.options.onSuccess?.({ data: { invoiceId } }));
  expect(workspaceRouterPush).toHaveBeenCalledWith(
    getLocalizedPagePath("en-US", "/[locale]/admin/invoices/[invoiceId]", {
      invoiceId,
    })
  );
});

test("closes the review unless the invoice is being created", async () => {
  captureInvoiceActions();
  const view = renderInvoiceCreationForm();
  await openReviewedInvoice(view);

  fireEvent.click(
    view.getByRole("button", { name: m.accountingInvoiceFormGoBack({}, en) })
  );
  await flush();
  expect(view.queryByRole("dialog")).toBeNull();
  cleanup();

  const { createAdministrationInvoice: create } = captureInvoiceActions({
    executing: ["createAdministrationInvoice"],
  });
  const creating = renderInvoiceCreationForm();
  await openReviewedInvoice(creating);

  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
  });
  await flush();
  expect(creating.getByRole("dialog")).toBeTruthy();
  expect(
    creating.getByRole("button", {
      name: m.accountingInvoiceFormCreating({}, en),
    })
  ).toHaveProperty("disabled", true);
  expect(create.execute).not.toHaveBeenCalled();
});
