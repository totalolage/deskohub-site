import { CampaignListPage } from "@/features/email-campaigns/admin/campaign-list/campaign-list-page";
import { loadCampaignList } from "@/features/email-campaigns/admin/campaign-list/campaign-list-page-data.server";

export default function EmailCampaignsPage() {
  return <CampaignListPage campaigns={loadCampaignList()} />;
}
