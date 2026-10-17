import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";
export default function EmailAudiencesBreadcrumb() {
  return <AdministrationBreadcrumb segments={["email-audiences"]} />;
}
