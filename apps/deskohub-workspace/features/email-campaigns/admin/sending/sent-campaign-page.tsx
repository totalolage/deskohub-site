import type { CampaignRow } from "@/db/schema";
import {
  AdministrationAlert,
  AdministrationDetailSection,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { formatCount } from "@/shared/utils/number";
import { campaignRecipientStatuses } from "../../campaign-states";
import {
  describeAudienceFilter,
  hasPeriodEndingAtEvaluation,
} from "../audience-filter-summary";
import { loadDiscountGroupOptions } from "../audiences/discount-group-options.server";
import {
  CampaignPurposeBadge,
  CampaignRecipientStatusBadge,
  CampaignStatusBadge,
} from "../campaign-list/campaign-badges";
import { loadSentCampaign } from "./sent-campaign.server";
import { SentCampaignActions } from "./sent-campaign-actions";
import { loadSentCampaignEmails } from "./sent-campaign-email.server";
import { SentCampaignEmailPreview } from "./sent-campaign-email-preview";
import { SentRecipientTable } from "./sent-recipient-table";

/** The read-only view of a campaign that left Draft. */
export async function SentCampaignPage({
  campaign,
}: {
  readonly campaign: CampaignRow;
}) {
  const [{ send, audienceTitle }, discountGroups, emails, locale] =
    await Promise.all([
      loadSentCampaign(campaign.id),
      loadDiscountGroupOptions(),
      loadSentCampaignEmails(campaign),
      getRequestLocale(),
    ]);
  const sentAt =
    send && formatAdministrationDateTime(send.createdAt.toString(), locale);
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={
          <SentCampaignActions
            campaignId={campaign.id}
            retryable={campaign.status === "failed"}
            unconfirmedCount={send?.counts.unconfirmed ?? 0}
          />
        }
        eyebrow={m.emailCampaignsSentEyebrow({}, { locale })}
        title={campaign.title}
      />
      <div className="space-y-6">
        {
          {
            draft: null,
            sending: (
              <AdministrationAlert status="warning">
                {m.emailCampaignsSentSendingNotice({}, { locale })}
              </AdministrationAlert>
            ),
            sent: null,
            failed: (
              <AdministrationAlert status="error">
                {m.emailCampaignsSentFailedNotice({}, { locale })}
              </AdministrationAlert>
            ),
          }[campaign.status]
        }
        <AdministrationDetailSection
          title={m.emailCampaignsSentCampaignTitle({}, { locale })}
        >
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdministrationFact
              label={m.emailCampaignsSentStatus({}, { locale })}
              value={
                <CampaignStatusBadge locale={locale} status={campaign.status} />
              }
            />
            <AdministrationFact
              label={m.emailCampaignsSentPurpose({}, { locale })}
              value={
                <CampaignPurposeBadge
                  locale={locale}
                  purpose={campaign.purpose}
                />
              }
            />
            <AdministrationFact
              label={m.emailCampaignsSentSentAt({}, { locale })}
              value={
                sentAt ?? m.emailCampaignsSentSentAtNotRecorded({}, { locale })
              }
            />
            <AdministrationFact
              label={m.emailCampaignsSentCompletedAt({}, { locale })}
              value={
                send?.completedAt
                  ? formatAdministrationDateTime(
                      send.completedAt.toString(),
                      locale
                    )
                  : m.emailCampaignsSentCompletedAtPending({}, { locale })
              }
            />
          </dl>
        </AdministrationDetailSection>
        <AdministrationDetailSection
          title={m.emailCampaignsSentAudienceTitle({}, { locale })}
        >
          {send ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <AdministrationFact
                label={m.emailCampaignsSentAudience({}, { locale })}
                value={
                  audienceTitle ??
                  m.emailCampaignsSentAudienceDeleted({}, { locale })
                }
              />
              <AdministrationFact
                label={m.emailCampaignsSentAudienceFilter({}, { locale })}
                value={
                  hasPeriodEndingAtEvaluation(send.audienceFilter)
                    ? m.emailCampaignsSentAudienceFilterCountedBack(
                        {
                          filter: describeAudienceFilter(
                            send.audienceFilter,
                            locale,
                            { discountGroups }
                          ),
                          sentAt: formatAdministrationDateTime(
                            send.createdAt.toString(),
                            locale
                          ),
                        },
                        { locale }
                      )
                    : m.emailCampaignsSentAudienceFilterSummary(
                        {
                          filter: describeAudienceFilter(
                            send.audienceFilter,
                            locale,
                            { discountGroups }
                          ),
                        },
                        { locale }
                      )
                }
              />
            </dl>
          ) : (
            <p className="text-sm text-navy-blue/65">
              {m.emailCampaignsSentNoSendRecorded({}, { locale })}
            </p>
          )}
        </AdministrationDetailSection>
        <AdministrationDetailSection
          title={m.emailCampaignsSentContentTitle({}, { locale })}
        >
          <SentCampaignEmailPreview emails={emails} />
        </AdministrationDetailSection>
        {send && (
          <>
            <AdministrationDetailSection
              title={m.emailCampaignsSentDeliveryTitle({}, { locale })}
            >
              <p className="text-2xl font-semibold">
                {m.emailCampaignsSentDeliveryRecipientCount(
                  { count: send.recipients.length },
                  { locale }
                )}
              </p>
              <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
                {campaignRecipientStatuses.map((status) => (
                  <li className="flex items-center gap-2" key={status}>
                    <CampaignRecipientStatusBadge
                      locale={locale}
                      status={status}
                    />
                    <span className="text-lg font-semibold tabular-nums">
                      {formatCount(send.counts[status], locale)}
                    </span>
                  </li>
                ))}
              </ul>
              {send.counts.unconfirmed > 0 && (
                <p className="mt-4 max-w-prose text-sm text-navy-blue/65">
                  {m.emailCampaignsSentDeliveryUnconfirmedNote({}, { locale })}
                </p>
              )}
            </AdministrationDetailSection>
            <AdministrationDetailSection
              title={m.emailCampaignsSentRecipientsTitle({}, { locale })}
            >
              <SentRecipientTable
                recipients={send.recipients.map((recipient) => ({
                  dotyposCustomerId: recipient.dotyposCustomerId,
                  locale: recipient.locale,
                  status: recipient.status,
                  skipReason: recipient.skipReason,
                  statusUpdatedAt: recipient.statusUpdatedAt.toString(),
                  statusSince: formatAdministrationDateTime(
                    recipient.statusUpdatedAt.toString(),
                    locale
                  ),
                }))}
              />
            </AdministrationDetailSection>
          </>
        )}
      </div>
    </AdministrationPage>
  );
}
