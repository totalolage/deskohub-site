import { AdministrationBreadcrumb } from "@/features/administration/breadcrumb.server";
export default async function EmailCampaignPreviewBreadcrumb({
  params,
}: {
  readonly params: Promise<{ readonly campaignId: string }>;
}) {
  const { campaignId } = await params;
  return (
    <AdministrationBreadcrumb
      segments={["email-campaigns", campaignId, "preview"]}
    />
  );
}
