import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";
export default function NewEmailCampaignBreadcrumb() {
  return <AdministrationBreadcrumb segments={["email-campaigns", "new"]} />;
}
