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
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Schema } from "effect";
import { createElement } from "react";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("./actions", () => ({
  createAdministrationInvoice: async () => ({}),
  previewAdministrationInvoice: async () => ({}),
  searchAdministrationInvoiceCustomers: async () => ({}),
}));

const {
  getInvoiceDraftId,
  getInvoiceReviewTotal,
  InvoiceCreationForm,
  isInvoicePriceInput,
  readInvoiceForm,
} = await import("./invoice-form");

beforeAll(registerWorkspaceComponentTestEnv);
beforeEach(() => {
  workspaceUseAction.mockReset();
  window.happyDOM.setURL("https://deskohub.test/admin/invoices/new");
});
afterEach(() => {
  cleanup();
});
afterAll(unregisterWorkspaceComponentTestEnv);

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
  const form = new FormData();
  for (const [name, value] of Object.entries({
    email: "billing@example.test",
    firstName: "",
    lastName: "",
    line1: "Synthetic 1",
    city: "Prague",
    postalCode: "110 00",
    country: "CZ",
    companyName: "Example s.r.o.",
    companyId: "12345678",
    locale: "en-US",
    serviceDate: "2026-08-18",
    dueDate: "2026-09-01",
    currency: "CZK",
    variableSymbol: "2026000001",
    "description-line-1": "Space rental",
    "price-line-1": "1000",
  })) {
    form.set(name, value);
  }

  const input = readInvoiceForm({
    customer: null,
    customerMode: "new",
    customerType: "business",
    form,
    invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21",
    lines: [{ id: "line-1", description: "", price: "" }],
  });

  expect(input.customer.details).not.toHaveProperty("firstName");
  expect(input.customer.details).not.toHaveProperty("lastName");
  expect(input.variableSymbol).toBe("2026000001");
  expect(() =>
    Schema.decodeUnknownSync(AdministrationInvoiceCreateInput)(input)
  ).not.toThrow();
});

test("preserves the reviewed variable symbol", () => {
  const form = new FormData();
  form.set("variableSymbol", "2026000001");

  const common = {
    customer: null,
    customerMode: "new" as const,
    customerType: "person" as const,
    form,
    invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21",
    lines: [],
  };

  expect(readInvoiceForm(common).variableSymbol).toBe("2026000001");
});

test("reuses an existing draft id and generates one when absent", () => {
  const firstId = "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21";

  expect(getInvoiceDraftId(firstId)).toBe(firstId);
  expect(getInvoiceDraftId(null)).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
});

test("previews the suggested variable symbol after restoring the default", () => {
  const preview = mock();
  workspaceUseAction.mockImplementation((_action, options) => {
    const actionName = (options as { readonly actionName: string }).actionName;
    if (actionName === "previewAdministrationInvoice") {
      return { execute: preview, isExecuting: false } as never;
    }
    return { execute: mock(), isExecuting: false } as never;
  });

  const view = renderInvoiceCreationForm();
  fireEvent.click(view.getByRole("button", { name: "New" }));
  const variableSymbol = view.getByLabelText(
    "Variable symbol"
  ) as HTMLInputElement;
  fireEvent.change(variableSymbol, { target: { value: "" } });
  fireEvent.blur(variableSymbol);
  expect(variableSymbol.value).toBe("2026000001");
  fireEvent.focus(variableSymbol);
  expect(variableSymbol.selectionStart).toBe(0);
  expect(variableSymbol.selectionEnd).toBe(variableSymbol.value.length);
  fireEvent.change(view.getByLabelText("Price"), {
    target: { value: "1000" },
  });
  const form = view.container.querySelector("form");
  if (!form) throw new Error("Invoice form missing");

  fireEvent.submit(form);
  expect(preview).toHaveBeenCalledWith(
    expect.objectContaining({ variableSymbol: "2026000001" })
  );
});

const renderInvoiceCreationForm = () =>
  render(
    createElement(InvoiceCreationForm, {
      currencies: [{ code: "CZK", exponent: 2, name: "Czech koruna" }],
      defaultCurrency: "CZK",
      defaultDueDate: "2026-09-01",
      defaultServiceDate: "2026-08-18",
      suggestedVariableSymbol: "2026000001",
    })
  );
