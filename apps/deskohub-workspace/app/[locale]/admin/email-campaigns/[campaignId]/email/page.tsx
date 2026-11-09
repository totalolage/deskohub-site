import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { loadAutomatedCampaign } from "@/features/email-campaigns/admin/automation/automated-campaign.server";
import { AutomatedCampaignFrame } from "@/features/email-campaigns/admin/automation/automated-campaign-frame";
import { AutomatedCampaignEmailPage } from "@/features/email-campaigns/admin/automation/content/automated-campaign-email-page";
import { requireCampaignRouteId } from "@/features/email-campaigns/admin/campaign-page-data.server";

type RouteParams = Promise<{ readonly campaignId: string }>;

export default function EmailCampaignEmailPage({
  params,
}: {
  readonly params: RouteParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <Section params={params} />
    </Suspense>
  );
}

async function Section({ params }: { readonly params: RouteParams }) {
  const { campaignId } = await params;
  const automated = await loadAutomatedCampaign(
    requireCampaignRouteId(campaignId)
  );
  return (
    <AutomatedCampaignFrame automated={automated} section="email">
      <AutomatedCampaignEmailPage automated={automated} />
    </AutomatedCampaignFrame>
  );
}
