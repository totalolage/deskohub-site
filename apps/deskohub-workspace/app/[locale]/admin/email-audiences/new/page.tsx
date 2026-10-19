import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { AudienceEditorPage } from "@/features/email-campaigns/admin/audiences/audience-editor";
import { loadAudienceValueLookups } from "@/features/email-campaigns/admin/audiences/audience-value-lookups.server";

export default function NewEmailAudiencePage() {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <AuthorizedAudienceEditor />
    </Suspense>
  );
}

async function AuthorizedAudienceEditor() {
  const lookups = await loadAudienceValueLookups();
  return <AudienceEditorPage lookups={lookups} />;
}
