import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function InvoicesBreadcrumb() {
  return <AdministrationBreadcrumb segments={["invoices"]} />;
}
