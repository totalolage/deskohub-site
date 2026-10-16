import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { requireCampaignRouteId } from "@/features/email-campaigns/admin/campaign-page-data.server";
import { RecipientPreviewPage } from "@/features/email-campaigns/admin/sending/recipient-preview-page";

type CampaignRouteParams = Promise<{ readonly campaignId: string }>;

export default function EmailCampaignRecipientsPage({
  params,
}: {
  readonly params: CampaignRouteParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <EmailCampaignRecipients params={params} />
    </Suspense>
  );
}

async function EmailCampaignRecipients({
  params,
}: {
  readonly params: CampaignRouteParams;
}) {
  const { campaignId } = await params;
  return (
    <RecipientPreviewPage campaignId={requireCampaignRouteId(campaignId)} />
  );
}
