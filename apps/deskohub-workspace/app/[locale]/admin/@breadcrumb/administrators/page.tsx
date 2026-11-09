import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function AdministratorsBreadcrumb() {
  return <AdministrationBreadcrumb segments={["administrators"]} />;
}
