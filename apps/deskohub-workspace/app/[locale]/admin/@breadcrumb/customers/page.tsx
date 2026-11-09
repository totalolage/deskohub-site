import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function CustomersBreadcrumb() {
  return <AdministrationBreadcrumb segments={["customers"]} />;
}
