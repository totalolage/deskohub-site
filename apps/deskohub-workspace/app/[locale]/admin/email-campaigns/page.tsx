import { CampaignListPage } from "@/features/email-campaigns/admin/campaign-list/campaign-list-page";
import {
  type CampaignListSearchParams,
  loadCampaignList,
  loadCampaignListDelivery,
} from "@/features/email-campaigns/admin/campaign-list/campaign-list-page-data.server";

export default function EmailCampaignsPage({
  searchParams,
}: {
  readonly searchParams: CampaignListSearchParams;
}) {
  const delivery = loadCampaignListDelivery(searchParams);
  return (
    <CampaignListPage
      campaigns={loadCampaignList(delivery)}
      delivery={delivery}
    />
  );
}
