import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { loadAutomatedCampaign } from "@/features/email-campaigns/admin/automation/automated-campaign.server";
import { AutomatedCampaignFrame } from "@/features/email-campaigns/admin/automation/automated-campaign-frame";
import { AutomationRunLogPage } from "@/features/email-campaigns/admin/automation/run-log/automation-run-log-page";
import { requireCampaignRouteId } from "@/features/email-campaigns/admin/campaign-page-data.server";

type RouteParams = Promise<{ readonly campaignId: string }>;
type RouteSearchParams = Promise<
  Readonly<Record<string, string | string[] | undefined>>
>;

export default function EmailCampaignRunsPage({
  params,
  searchParams,
}: {
  readonly params: RouteParams;
  readonly searchParams: RouteSearchParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <Section params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Section({
  params,
  searchParams,
}: {
  readonly params: RouteParams;
  readonly searchParams: RouteSearchParams;
}) {
  const { campaignId } = await params;
  const automated = await loadAutomatedCampaign(
    requireCampaignRouteId(campaignId)
  );
  return (
    <AutomatedCampaignFrame automated={automated} section="runs">
      <AutomationRunLogPage
        automated={automated}
        searchParams={await searchParams}
      />
    </AutomatedCampaignFrame>
  );
}
