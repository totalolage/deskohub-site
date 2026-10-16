import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import {
  loadAdminCampaign,
  requireCampaignRouteId,
} from "@/features/email-campaigns/admin/campaign-page-data.server";
import { CampaignComposerPage } from "@/features/email-campaigns/admin/composer/campaign-composer-page";
import { SentCampaignPage } from "@/features/email-campaigns/admin/sending/sent-campaign-page";

type CampaignRouteParams = Promise<{ readonly campaignId: string }>;

export default function EmailCampaignPage({
  params,
}: {
  readonly params: CampaignRouteParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <EmailCampaign params={params} />
    </Suspense>
  );
}

/** A Draft opens in the composer; a campaign that left Draft is read-only. */
async function EmailCampaign({
  params,
}: {
  readonly params: CampaignRouteParams;
}) {
  const { campaignId } = await params;
  const campaign = await loadAdminCampaign(requireCampaignRouteId(campaignId));
  return campaign.status === "draft" ? (
    <CampaignComposerPage campaign={campaign} />
  ) : (
    <SentCampaignPage campaign={campaign} />
  );
}
