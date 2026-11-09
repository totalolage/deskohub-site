import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function SalesBreadcrumb() {
  return <AdministrationBreadcrumb segments={["sales"]} />;
}
