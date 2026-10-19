import { Suspense } from "react";
import { AdministrationRouteLoading } from "@/features/administration/loading";
import { AudienceEditorPage } from "@/features/email-campaigns/admin/audiences/audience-editor";
import { loadAudienceEditor } from "@/features/email-campaigns/admin/audiences/audience-page-data.server";
import { loadAudienceValueLookups } from "@/features/email-campaigns/admin/audiences/audience-value-lookups.server";
import { requireAudienceRouteId } from "@/features/email-campaigns/admin/campaign-page-data.server";

type AudienceRouteParams = Promise<{ readonly audienceId: string }>;

export default function EmailAudiencePage({
  params,
}: {
  readonly params: AudienceRouteParams;
}) {
  return (
    <Suspense fallback={<AdministrationRouteLoading />}>
      <EmailAudience params={params} />
    </Suspense>
  );
}

async function EmailAudience({
  params,
}: {
  readonly params: AudienceRouteParams;
}) {
  const { audienceId } = await params;
  const [audience, lookups] = await Promise.all([
    loadAudienceEditor(requireAudienceRouteId(audienceId)),
    loadAudienceValueLookups(),
  ]);
  return <AudienceEditorPage audience={audience} lookups={lookups} />;
}
