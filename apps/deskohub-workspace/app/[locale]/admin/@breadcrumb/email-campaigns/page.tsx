import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";
export default function EmailCampaignsBreadcrumb() {
  return <AdministrationBreadcrumb segments={["email-campaigns"]} />;
}
