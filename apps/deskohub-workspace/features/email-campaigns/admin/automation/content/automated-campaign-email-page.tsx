import { loadCampaignEditorContent } from "../../campaign-page-data.server";
import { CampaignComposer } from "../../composer/campaign-composer";
import { loadCampaignComposerOptions } from "../../composer/campaign-composer-data.server";
import { campaignComposerFieldsFromCampaign } from "../../composer/campaign-composer-fields";
import type { AutomatedCampaign } from "../automated-campaign.server";

/**
 * The automated campaign's email content and audience, in the composer
 * without its one-off send controls. Edits change the working copy, which
 * goes live at the next activation; an archived campaign is read-only.
 */
export async function AutomatedCampaignEmailPage({
  automated,
}: {
  readonly automated: AutomatedCampaign;
}) {
  const [campaign, options] = await Promise.all([
    loadCampaignEditorContent(automated.campaign.id, "automated"),
    loadCampaignComposerOptions(),
  ]);
  return (
    <CampaignComposer
      {...options}
      campaign={{
        id: campaign.id,
        contentLocales: campaign.locales,
        delivery: "automated",
        readOnly: automated.automation.status === "archived",
      }}
      initialFields={campaignComposerFieldsFromCampaign(campaign)}
    />
  );
}
