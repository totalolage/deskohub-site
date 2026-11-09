import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";
export default function NewEmailAudienceBreadcrumb() {
  return <AdministrationBreadcrumb segments={["email-audiences", "new"]} />;
}
