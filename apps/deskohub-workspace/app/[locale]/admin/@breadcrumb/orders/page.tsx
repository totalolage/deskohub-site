import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function OrdersBreadcrumb() {
  return <AdministrationBreadcrumb segments={["orders"]} />;
}
