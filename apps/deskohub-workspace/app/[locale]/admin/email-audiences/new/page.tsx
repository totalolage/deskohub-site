import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { AudienceEditorPage } from "@/features/email-campaigns/admin/audiences/audience-editor";
import { loadDiscountGroupOptions } from "@/features/email-campaigns/admin/audiences/discount-group-options.server";

export default function NewEmailAudiencePage() {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <AuthorizedAudienceEditor />
    </Suspense>
  );
}

async function AuthorizedAudienceEditor() {
  const discountGroups = await loadDiscountGroupOptions();
  return <AudienceEditorPage discountGroups={discountGroups} />;
}
