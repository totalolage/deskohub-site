import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { BillingScreenCopy } from "./billing-screen";
import { BillingScreen } from "./billing-screen";

const englishCopy = {
  title: "Billing & invoices",
  currency: "Currency: CZK (Kč)",
  paymentMethodsTitle: "Saved payment methods",
  paymentMethodsUnavailable:
    "Saved payment methods are not available in this account.",
  addPaymentCard: "Add payment card",
  removePaymentCard: "Remove payment card",
  billingDetailsTitle: "Billing details",
  syncAres: "Sync with ARES Registry",
  aresUnavailable: "ARES Registry sync is not available in this account.",
  invoiceHistoryTitle: "Invoice history",
  invoiceHistoryUnavailable:
    "Invoice history and downloads are not available in this account.",
  downloadInvoice: "Download PDF",
  exportInvoices: "Export all",
} satisfies BillingScreenCopy;

const czechCopy = {
  title: "Fakturace a faktury",
  currency: "Měna: CZK (Kč)",
  paymentMethodsTitle: "Uložené platební metody",
  paymentMethodsUnavailable:
    "Uložené platební metody nejsou pro tento účet dostupné.",
  addPaymentCard: "Přidat platební kartu",
  removePaymentCard: "Odebrat platební kartu",
  billingDetailsTitle: "Fakturační údaje",
  syncAres: "Synchronizovat s registrem ARES",
  aresUnavailable:
    "Synchronizace s registrem ARES není pro tento účet dostupná.",
  invoiceHistoryTitle: "Historie faktur",
  invoiceHistoryUnavailable:
    "Historie faktur a jejich stahování nejsou pro tento účet dostupné.",
  downloadInvoice: "Stáhnout PDF",
  exportInvoices: "Exportovat vše",
} satisfies BillingScreenCopy;

const countOccurrences = (value: string, needle: string) =>
  value.split(needle).length - 1;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

const renderScreen = (copy: BillingScreenCopy) =>
  renderToStaticMarkup(
    <BillingScreen copy={copy}>
      <div data-child-marker="billing-fields">Caller-owned billing fields</div>
    </BillingScreen>
  );

const getAttributeValues = (markup: string, attribute: string) =>
  [...markup.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map(
    ([, value]) => value
  );

describe("BillingScreen", () => {
  test("renders children and the optional footer exactly once without owning a form or input", () => {
    const markup = renderToStaticMarkup(
      <BillingScreen
        copy={englishCopy}
        footer={<span data-footer-marker="billing-footer">Save billing</span>}
      >
        <div data-child-marker="billing-fields">
          Caller-owned billing fields
        </div>
      </BillingScreen>
    );

    expect(countOccurrences(markup, 'data-child-marker="billing-fields"')).toBe(
      1
    );
    expect(
      countOccurrences(markup, 'data-footer-marker="billing-footer"')
    ).toBe(1);
    expect(markup.match(/<form\b/g) ?? []).toHaveLength(0);
    expect(markup.match(/<input\b/g) ?? []).toHaveLength(0);
  });

  test("renders safely without an optional footer", () => {
    const markup = renderScreen(englishCopy);

    expect(markup).not.toContain("data-footer-marker");
  });

  test("keeps one outer form and the supplied billing input and footer action intact", () => {
    const markup = renderToStaticMarkup(
      <form id="account-profile-form">
        <BillingScreen
          copy={englishCopy}
          footer={<button type="submit">Save billing</button>}
        >
          <div>
            <label htmlFor="company-legal-name">Company legal name</label>
            <input
              id="company-legal-name"
              name="companyName"
              defaultValue="Studio Alpha s.r.o."
              readOnly
            />
          </div>
        </BillingScreen>
      </form>
    );

    expect(markup.match(/<form\b/g) ?? []).toHaveLength(1);
    expect(markup).toContain('id="company-legal-name"');
    expect(markup).toContain('name="companyName"');
    expect(markup).toContain('value="Studio Alpha s.r.o."');
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("Save billing");
  });

  test("keeps every unsupported action disabled and native button-shaped", () => {
    const markup = renderScreen(englishCopy);
    const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];

    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button).toMatch(/\btype="button"/);
      expect(button).toMatch(/\bdisabled(?:="")?(?:\s|>)/);
    }
  });

  test.each([
    ["English", englishCopy],
    ["Czech", czechCopy],
  ] as const)(
    "renders every supplied %s string without invented billing data",
    (_locale, copy) => {
      const markup = renderScreen(copy);

      for (const value of Object.values(copy)) {
        expect(markup).toContain(escapeHtml(value));
      }
      expect(markup).not.toMatch(
        /Visa|Mastercard|American Express|Stripe|4242|••••|Issued:/i
      );
      expect(markup).not.toContain("VF-");
    }
  );

  test("keeps labels and description references unique across two instances", () => {
    const markup = renderToStaticMarkup(
      <div>
        <BillingScreen copy={englishCopy}>
          <div>First billing fields</div>
        </BillingScreen>
        <BillingScreen copy={czechCopy}>
          <div>Second billing fields</div>
        </BillingScreen>
      </div>
    );
    const ids = getAttributeValues(markup, "id");
    const references = [
      ...getAttributeValues(markup, "aria-labelledby"),
      ...getAttributeValues(markup, "aria-describedby"),
    ].flatMap((value) => value.split(/\s+/));

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const reference of references) {
      expect(ids.filter((id) => id === reference)).toHaveLength(1);
    }
  });
});
