import { ArrowLeft, RotateCw } from "lucide-react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationAlert,
  AdministrationDetailSection,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { Button } from "@/shared/components/ui/button";
import { formatCount } from "@/shared/utils/number";
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
  const [preview, locale] = await Promise.all([
    loadRecipientPreview(campaignId),
    getRequestLocale(),
  ]);
  const campaignHref = administrationHref(
    "/[locale]/admin/email-campaigns/[campaignId]",
    { campaignId }
  );
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={
          <Button asChild size="sm" variant="secondary">
            <Link href={campaignHref}>
              <ArrowLeft aria-hidden className="size-4" />
              {m.emailCampaignsRecipientPreviewBackToCampaign({}, { locale })}
            </Link>
          </Button>
        }
        description={
          preview.kind === "no-audience"
            ? undefined
            : m.emailCampaignsRecipientPreviewAudienceDescription(
                {
                  audience: preview.audienceTitle,
                  filter: preview.audienceSummary,
                },
                { locale }
              )
        }
        eyebrow={preview.campaign.title}
        title={m.emailCampaignsRecipientPreviewTitle({}, { locale })}
      />
      {preview.kind === "no-audience" && (
        <AdministrationAlert status="warning">
          {m.emailCampaignsRecipientPreviewNoAudience({}, { locale })}
        </AdministrationAlert>
      )}
      {preview.kind === "unavailable" && (
        <AdministrationAlert role="alert" status="error">
          <p>{m.emailCampaignsRecipientPreviewUnavailable({}, { locale })}</p>
          <Button asChild className="mt-3" size="sm" variant="secondary">
            <Link
              href={administrationHref(
                "/[locale]/admin/email-campaigns/[campaignId]/recipients",
                { campaignId }
              )}
            >
              <RotateCw aria-hidden className="size-4" />
              {m.emailCampaignsRecipientPreviewTryAgain({}, { locale })}
            </Link>
          </Button>
        </AdministrationAlert>
      )}
      {preview.kind === "resolved" && (
        <div className="space-y-6">
          <AdministrationDetailSection
            title={m.emailCampaignsRecipientPreviewSummary({}, { locale })}
          >
            <dl className="grid gap-4 sm:grid-cols-3">
              <AdministrationFact
                label={m.emailCampaignsRecipientPreviewRecipients(
                  {},
                  { locale }
                )}
                value={formatCount(
                  preview.resolution.recipients.length,
                  locale
                )}
                valueClassName="text-2xl"
              />
              <AdministrationFact
                label={m.emailCampaignsRecipientPreviewExcluded({}, { locale })}
                value={formatCount(
                  preview.resolution.exclusions.length,
                  locale
                )}
                valueClassName="text-2xl"
              />
              <AdministrationFact
                label={m.emailCampaignsRecipientPreviewSharedEmails(
                  {},
                  { locale }
                )}
                value={formatCount(
                  preview.resolution.duplicates.length,
                  locale
                )}
                valueClassName="text-2xl"
              />
            </dl>
            <p className="mt-4 text-sm text-navy-blue/65">
              {m.emailCampaignsRecipientPreviewAsOfNow({}, { locale })}
            </p>
          </AdministrationDetailSection>
          <AdministrationDetailSection
            title={m.emailCampaignsRecipientPreviewRecipients({}, { locale })}
          >
            <RecipientTable recipients={preview.resolution.recipients} />
          </AdministrationDetailSection>
          <AdministrationDetailSection
            title={m.emailCampaignsRecipientPreviewExcludedCustomers(
              {},
              { locale }
            )}
          >
            <ExclusionTable exclusions={preview.resolution.exclusions} />
          </AdministrationDetailSection>
          <AdministrationDetailSection
            title={m.emailCampaignsRecipientPreviewSharedEmailsTitle(
              {},
              { locale }
            )}
          >
            <p className="mb-4 text-sm text-navy-blue/65">
              {m.emailCampaignsRecipientPreviewSharedEmailsNote({}, { locale })}
            </p>
            <DuplicateTable duplicates={preview.resolution.duplicates} />
          </AdministrationDetailSection>
        </div>
      )}
    </AdministrationPage>
  );
}
