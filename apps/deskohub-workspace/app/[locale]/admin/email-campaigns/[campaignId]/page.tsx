import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { loadAutomatedCampaign } from "@/features/email-campaigns/admin/automation/automated-campaign.server";
import { AutomatedCampaignFrame } from "@/features/email-campaigns/admin/automation/automated-campaign-frame";
import { AutomationFlowPage } from "@/features/email-campaigns/admin/automation/builder/automation-flow-page";
import {
  loadAdminCampaign,
  loadCampaignDelivery,
  loadCampaignEditorContent,
  requireCampaignRouteId,
} from "@/features/email-campaigns/admin/campaign-page-data.server";
import { CampaignComposerPage } from "@/features/email-campaigns/admin/composer/campaign-composer-page";
import { SentCampaignPage } from "@/features/email-campaigns/admin/sending/sent-campaign-page";
import type { CampaignId } from "@/features/email-campaigns/campaign-identifiers";

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

/**
 * An automated campaign opens on its flow. A one-off Draft opens in the
 * composer; a one-off campaign that left Draft is read-only.
 */
async function EmailCampaign({
  params,
}: {
  readonly params: CampaignRouteParams;
}) {
  const campaignId = requireCampaignRouteId((await params).campaignId);
  return (await loadCampaignDelivery(campaignId)) === "automated" ? (
    <AutomatedCampaignFlow campaignId={campaignId} />
  ) : (
    <OnceCampaign campaignId={campaignId} />
  );
}

async function AutomatedCampaignFlow({
  campaignId,
}: {
  readonly campaignId: CampaignId;
}) {
  const automated = await loadAutomatedCampaign(campaignId);
  return (
    <AutomatedCampaignFrame automated={automated} section="flow">
      <AutomationFlowPage automated={automated} />
    </AutomatedCampaignFrame>
  );
}

async function OnceCampaign({
  campaignId,
}: {
  readonly campaignId: CampaignId;
}) {
  const campaign = await loadCampaignEditorContent(campaignId, "once");
  return campaign.status === "draft" ? (
    <CampaignComposerPage campaign={campaign} />
  ) : (
    <SentCampaign campaignId={campaignId} />
  );
}

async function SentCampaign({
  campaignId,
}: {
  readonly campaignId: CampaignId;
}) {
  return <SentCampaignPage campaign={await loadAdminCampaign(campaignId)} />;
}
