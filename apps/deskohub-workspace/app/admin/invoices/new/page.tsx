import { Suspense } from "react";
import { InvoiceCreationForm } from "@/features/accounting/admin/invoice-form";
import { loadInvoiceCreationPage } from "@/features/accounting/admin/page-data.server";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { AdministrationRouteLoading } from "@/features/administration/loading";

export default function NewInvoiceAdministrationPage() {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <NewInvoiceContent />
    </Suspense>
  );
}

async function NewInvoiceContent() {
  const defaults = await loadInvoiceCreationPage();
  return (
    <AdministrationPage className="max-w-6xl">
      <AdministrationPageHeader
        description="Create an ad-hoc service invoice and send it immediately after review."
        eyebrow="Accounting"
        title="New invoice"
      />
      <InvoiceCreationForm {...defaults} />
    </AdministrationPage>
  );
}
