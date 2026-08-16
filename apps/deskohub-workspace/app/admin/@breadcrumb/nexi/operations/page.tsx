import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function OperationsBreadcrumb() {
  return <AdministrationBreadcrumb segments={["nexi", "operations"]} />;
}
