import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { loadAutomatedCampaign } from "@/features/email-campaigns/admin/automation/automated-campaign.server";
import { AutomatedCampaignFrame } from "@/features/email-campaigns/admin/automation/automated-campaign-frame";
import { AutomationRunPage } from "@/features/email-campaigns/admin/automation/run-log/automation-run-page";
import { requireCampaignRouteId } from "@/features/email-campaigns/admin/campaign-page-data.server";

type RouteParams = Promise<{
  readonly campaignId: string;
  readonly runId: string;
}>;

export default function EmailCampaignRunPage({
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
  const { campaignId, runId } = await params;
  const automated = await loadAutomatedCampaign(
    requireCampaignRouteId(campaignId)
  );
  return (
    <AutomatedCampaignFrame automated={automated} section="runs">
      <AutomationRunPage automated={automated} runId={runId} />
    </AutomatedCampaignFrame>
  );
}
