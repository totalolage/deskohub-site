import { describe, expect, test } from "bun:test";
import type { ComponentPropsWithoutRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CustomerInvoiceListState } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import { BillingScreen } from "./billing-screen";

const countOccurrences = (value: string, needle: string) =>
  value.split(needle).length - 1;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

const renderScreen = (
  locale: Locale,
  invoices: ComponentPropsWithoutRef<typeof BillingScreen>["invoices"] = {
    kind: "empty",
  }
) =>
  renderToStaticMarkup(
    <BillingScreen invoices={invoices} locale={locale}>
      <div data-child-marker="billing-fields">Caller-owned billing fields</div>
    </BillingScreen>
  );

const getAttributeValues = (markup: string, attribute: string) =>
  [...markup.matchAll(new RegExp(`${attribute}="([^"]+)"`, "g"))].map(
    ([, value]) => value
  );

const getSavedPaymentMethodsMarkup = (markup: string) =>
  markup.match(
    /<section aria-labelledby="[^"]+-payment-methods-title"[^>]*>[\s\S]*?<\/section>/
  )?.[0] ?? "";

describe("BillingScreen", () => {
  test("renders inside the shared account section panel", () => {
    const markup = renderScreen("en-US");

    expect(markup).toContain('data-slot="account-section-panel"');
  });

  test("renders children and the optional footer exactly once without owning a form or input", () => {
    const markup = renderToStaticMarkup(
      <BillingScreen
        invoices={{ kind: "empty" }}
        footer={<span data-footer-marker="billing-footer">Save billing</span>}
        locale="en-US"
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

  test("keeps a provided footer in one sticky, opaque, safe-area wrapper", () => {
    const markup = renderToStaticMarkup(
      <BillingScreen
        invoices={{ kind: "empty" }}
        footer={<span data-footer-marker="billing-footer">Save billing</span>}
        locale="en-US"
      >
        <div data-child-marker="billing-fields">
          Caller-owned billing fields
        </div>
      </BillingScreen>
    );
    const sectionClass = markup
      .match(/<section[^>]*class="([^"]*)"/)?.[1]
      ?.replaceAll("&amp;", "&");
    const footerWrapperClass = markup.match(
      /<div class="([^"]*)"><span data-footer-marker="billing-footer">Save billing<\/span><\/div><\/section>$/
    )?.[1];

    expect(sectionClass).toBeDefined();
    expect(sectionClass).toContain(
      "[&_input]:scroll-mb-[calc(12rem+env(safe-area-inset-bottom))]"
    );
    expect(sectionClass).toContain(
      "[&_select]:scroll-mb-[calc(12rem+env(safe-area-inset-bottom))]"
    );
    expect(
      markup.match(/data-footer-marker="billing-footer"/g) ?? []
    ).toHaveLength(1);
    expect(footerWrapperClass).toBeDefined();
    expect(footerWrapperClass).toContain("sticky");
    expect(footerWrapperClass).toContain("bottom-0");
    expect(footerWrapperClass).toContain("z-10");
    expect(footerWrapperClass).toContain("mt-8");
    expect(footerWrapperClass).toContain("min-w-0");
    expect(footerWrapperClass).toContain("border-t");
    expect(footerWrapperClass).toContain("border-[#e6ebf1]");
    expect(footerWrapperClass).toContain("bg-white");
    expect(footerWrapperClass).toContain("pt-4");
    expect(footerWrapperClass).toContain(
      "pb-[max(1rem,env(safe-area-inset-bottom))]"
    );
  });

  test("renders safely without an optional footer", () => {
    const markup = renderScreen("en-US");

    expect(markup).not.toContain("data-footer-marker");
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "keeps the localized billing title without rendering currency copy in %s",
    (locale) => {
      const markup = renderScreen(locale);

      expect(markup).toContain(
        escapeHtml(m.accountSectionBilling({}, { locale }))
      );
      expect(markup).not.toContain(
        escapeHtml(m.accountBillingCurrency({}, { locale }))
      );
    }
  );

  test("keeps one outer form and the supplied billing input and footer action intact", () => {
    const markup = renderToStaticMarkup(
      <form id="account-profile-form">
        <BillingScreen
          invoices={{ kind: "empty" }}
          footer={<button type="submit">Save billing</button>}
          locale="en-US"
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
    const markup = renderScreen("en-US");
    const buttons = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];

    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toMatch(/\btype="button"/);
      expect(button).toMatch(/\bdisabled(?:="")?(?:\s|>)/);
    }
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "renders only the saved payment heading and disabled Add action in %s",
    (locale) => {
      const savedSection = getSavedPaymentMethodsMarkup(renderScreen(locale));
      const buttons =
        savedSection.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];

      expect(savedSection).toContain(
        escapeHtml(m.accountBillingPaymentMethodsTitle({}, { locale }))
      );
      expect(savedSection).not.toContain(
        escapeHtml(m.accountBillingPaymentMethodsUnavailable({}, { locale }))
      );
      expect(savedSection).not.toContain(
        escapeHtml(m.accountBillingRemovePaymentCard({}, { locale }))
      );
      expect(savedSection).not.toContain("payment-methods-unavailable");
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toContain(
        escapeHtml(m.accountBillingAddPaymentCard({}, { locale }))
      );
      expect(buttons[0]).toMatch(/\btype="button"/);
      expect(buttons[0]).toMatch(/\bdisabled(?:="")?(?:\s|>)/);
      expect(buttons[0]).not.toMatch(/\baria-describedby=/);
    }
  );

  test.each(["en-US", "cs-CZ"] as const)(
    "renders billing catalog copy without invented billing data in %s",
    (locale) => {
      const invoiceStates: CustomerInvoiceListState[] = [
        { kind: "empty" },
        { kind: "loading" },
        { kind: "unavailable" },
        { kind: "failed" },
        {
          invoices: [
            {
              currency: "CZK",
              id: "billing-screen-test-invoice",
              invoiceNumber: "WS-FV-2026-000001",
              issuedAt: "2026-09-01T08:00:00.000Z",
              paymentStatus: "due",
              total: "100",
              dueDate: "2026-10-02",
            },
          ],
          kind: "populated",
        },
      ];
      const markup = invoiceStates
        .map((invoices) => renderScreen(locale, invoices))
        .join("\n");

      for (const value of [
        m.accountSectionBilling({}, { locale }),
        m.accountBillingPaymentMethodsTitle({}, { locale }),
        m.accountBillingAddPaymentCard({}, { locale }),
        m.accountBillingDetailsTitle({}, { locale }),
        m.accountBillingSyncAres({}, { locale }),
        m.accountBillingInvoiceHistoryTitle({}, { locale }),
        m.accountBillingInvoiceEmpty({}, { locale }),
        m.accountBillingInvoiceLoading({}, { locale }),
        m.accountBillingInvoiceUnavailable({}, { locale }),
        m.accountBillingInvoiceFailed({}, { locale }),
        m.accountBillingDownloadInvoice({}, { locale }),
        m.accountBillingExportInvoices({}, { locale }),
        m.invoiceManualUnpaid({}, { locale }),
        m.invoiceManualDueDate({}, { locale }),
      ]) {
        expect(markup).toContain(escapeHtml(value));
      }
      expect(markup).not.toContain(
        escapeHtml(m.accountBillingCurrency({}, { locale }))
      );
      expect(markup).not.toContain(
        escapeHtml(m.accountBillingPaymentMethodsUnavailable({}, { locale }))
      );
      expect(markup).not.toContain(
        escapeHtml(m.accountBillingRemovePaymentCard({}, { locale }))
      );
      expect(markup).not.toMatch(
        /Visa|Mastercard|American Express|Stripe|4242|••••|Issued:/i
      );
      expect(markup).not.toContain("VF-");
    }
  );

  test("keeps labels and description references unique across two instances", () => {
    const markup = renderToStaticMarkup(
      <div>
        <BillingScreen invoices={{ kind: "empty" }} locale="en-US">
          <div>First billing fields</div>
        </BillingScreen>
        <BillingScreen invoices={{ kind: "empty" }} locale="cs-CZ">
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
