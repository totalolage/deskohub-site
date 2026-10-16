import { ArrowLeft, RotateCw } from "lucide-react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationAlert,
  AdministrationDetailSection,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { Button } from "@/shared/components/ui/button";
import type { CampaignId } from "../../campaign-identifiers";
import { loadRecipientPreview } from "./recipient-preview.server";
import {
  DuplicateTable,
  ExclusionTable,
  RecipientTable,
} from "./recipient-preview-tables";

export async function RecipientPreviewPage({
  campaignId,
}: {
  readonly campaignId: CampaignId;
}) {
  const preview = await loadRecipientPreview(campaignId);
  const campaignHref = `/admin/email-campaigns/${campaignId}`;
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href={campaignHref}>
              <ArrowLeft aria-hidden className="size-4" />
              Back to campaign
            </Link>
          </Button>
        }
        description={
          preview.kind === "no-audience"
            ? undefined
            : `${preview.audienceTitle}: ${preview.audienceSummary}`
        }
        eyebrow={preview.campaign.title}
        title="Recipient preview"
      />
      {preview.kind === "no-audience" && (
        <AdministrationAlert status="warning">
          This campaign has no audience yet. Choose one in the composer to
          preview its recipients.
        </AdministrationAlert>
      )}
      {preview.kind === "unavailable" && (
        <AdministrationAlert role="alert" status="error">
          <p>
            Recipients couldn&apos;t be resolved because Dotypos is unavailable.
            Nothing was changed.
          </p>
          <Button asChild className="mt-3" size="sm" variant="secondary">
            <Link href={`${campaignHref}/recipients`}>
              <RotateCw aria-hidden className="size-4" />
              Try again
            </Link>
          </Button>
        </AdministrationAlert>
      )}
      {preview.kind === "resolved" && (
        <div className="space-y-6">
          <AdministrationDetailSection title="Summary">
            <dl className="grid gap-4 sm:grid-cols-3">
              <AdministrationFact
                label="Recipients"
                value={preview.resolution.recipients.length}
                valueClassName="text-2xl"
              />
              <AdministrationFact
                label="Excluded"
                value={preview.resolution.exclusions.length}
                valueClassName="text-2xl"
              />
              <AdministrationFact
                label="Shared emails"
                value={preview.resolution.duplicates.length}
                valueClassName="text-2xl"
              />
            </dl>
            <p className="mt-4 text-sm text-navy-blue/65">
              This resolves the audience as of now. Sending resolves it again
              and freezes that list.
            </p>
          </AdministrationDetailSection>
          <AdministrationDetailSection title="Recipients">
            <RecipientTable recipients={preview.resolution.recipients} />
          </AdministrationDetailSection>
          <AdministrationDetailSection title="Excluded customers">
            <ExclusionTable exclusions={preview.resolution.exclusions} />
          </AdministrationDetailSection>
          <AdministrationDetailSection title="Shared email addresses">
            <p className="mb-4 text-sm text-navy-blue/65">
              Customers sharing an email get one email, sent to the customer who
              reserved most recently.
            </p>
            <DuplicateTable duplicates={preview.resolution.duplicates} />
          </AdministrationDetailSection>
        </div>
      )}
    </AdministrationPage>
  );
}
