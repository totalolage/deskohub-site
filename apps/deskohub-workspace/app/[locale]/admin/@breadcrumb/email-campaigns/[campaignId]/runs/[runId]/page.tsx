import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";
export default async function EmailCampaignRunBreadcrumb({
  params,
}: {
  readonly params: Promise<{
    readonly campaignId: string;
    readonly runId: string;
  }>;
}) {
  const { campaignId, runId } = await params;
  return (
    <AdministrationBreadcrumb
      segments={["email-campaigns", campaignId, "runs", runId]}
    />
  );
}
