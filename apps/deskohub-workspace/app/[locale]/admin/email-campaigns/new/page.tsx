import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { NewCampaignComposerPage } from "@/features/email-campaigns/admin/composer/campaign-composer-page";

export default function NewEmailCampaignPage() {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <NewCampaignComposerPage />
    </Suspense>
  );
}
