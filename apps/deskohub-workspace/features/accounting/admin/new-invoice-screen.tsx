import { Suspense } from "react";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { InvoiceCreationForm } from "./invoice-form";
import { loadInvoiceCreationPage } from "./page-data.server";

export async function NewInvoiceAdministrationScreen() {
  const locale = await getRequestLocale();
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <NewInvoiceContent locale={locale} />
    </Suspense>
  );
}

async function NewInvoiceContent({ locale }: { readonly locale: Locale }) {
  const { currencies, ...defaults } = await loadInvoiceCreationPage();
  const currencyNames = new Intl.DisplayNames([locale], { type: "currency" });
  return (
    <AdministrationPage className="max-w-6xl">
      <AdministrationPageHeader
        description={m.accountingInvoiceNewDescription({}, { locale })}
        eyebrow={m.accountingInvoiceListEyebrow({}, { locale })}
        title={m.accountingInvoiceNewTitle({}, { locale })}
      />
      <InvoiceCreationForm
        {...defaults}
        currencies={currencies.map((currency) => ({
          ...currency,
          name: currencyNames.of(currency.code) ?? currency.name,
        }))}
      />
    </AdministrationPage>
  );
}
