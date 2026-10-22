import type { CampaignRow } from "@/db/schema";
import { AdministrationPage } from "@/features/administration/components";
import { campaignLocales } from "../../recipient-locale";
import { CampaignComposer } from "./campaign-composer";
import { loadCampaignComposerOptions } from "./campaign-composer-data.server";
import {
  campaignComposerFieldsFromCampaign,
  newCampaignComposerFields,
} from "./campaign-composer-fields";

/** The composer for a Draft campaign. */
export async function CampaignComposerPage({
  campaign,
}: {
  readonly campaign: CampaignRow;
}) {
  const options = await loadCampaignComposerOptions();
  return (
    <AdministrationPage>
      <CampaignComposer
        {...options}
        campaign={{
          id: campaign.id,
          contentLocales: campaignLocales.filter(
            (locale) => campaign.content[locale] !== undefined
          ),
          delivery: "once",
          readOnly: false,
        }}
        initialFields={campaignComposerFieldsFromCampaign(campaign)}
      />
    </AdministrationPage>
  );
}

/** The composer for a campaign that isn't saved yet. */
export async function NewCampaignComposerPage() {
  const options = await loadCampaignComposerOptions();
  return (
    <AdministrationPage>
      <CampaignComposer
        {...options}
        campaign={undefined}
        initialFields={newCampaignComposerFields}
      />
    </AdministrationPage>
  );
}
