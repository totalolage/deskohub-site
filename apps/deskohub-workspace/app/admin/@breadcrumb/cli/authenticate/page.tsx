import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";

export default function CliAuthenticationBreadcrumb() {
  return <AdministrationBreadcrumb segments={["cli", "authenticate"]} />;
}
