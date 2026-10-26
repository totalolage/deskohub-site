"use client";

import { useMemo } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { EmptyState } from "@/features/administration/empty-state";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type {
  CampaignRecipientSkipReason,
  CampaignRecipientStatus,
} from "../../campaign-states";
import { CampaignRecipientStatusBadge } from "../campaign-list/campaign-badges";
import { campaignLocaleName } from "./campaign-locale-names";

export type SentRecipientRow = {
  readonly dotyposCustomerId: string;
  readonly locale: Locale;
  readonly status: CampaignRecipientStatus;
  /** Why a `skipped` recipient wasn't mailed; null for other statuses. */
  readonly skipReason: CampaignRecipientSkipReason | null;
  /** ISO instant, for sorting. */
  readonly statusUpdatedAt: string;
  /**
   * `statusUpdatedAt` formatted on the server: Node and the browser space
   * date-times differently.
   */
  readonly statusSince: string;
};

const skipReasonMessages = {
  "missing-from-dotypos": m.emailCampaignsSentSkipReasonMissingFromDotypos,
  "deleted-customer": m.emailCampaignsSentSkipReasonDeletedCustomer,
  "missing-email": m.emailCampaignsSentSkipReasonMissingEmail,
  "invalid-email": m.emailCampaignsSentSkipReasonInvalidEmail,
  "consent-withdrawn": m.emailCampaignsSentSkipReasonConsentWithdrawn,
  "outside-test-domain": m.emailCampaignsSentSkipReasonOutsideTestDomain,
} as const satisfies Record<
  CampaignRecipientSkipReason,
  typeof m.emailCampaignsSentSkipReasonMissingFromDotypos
>;

const createColumns = (
  locale: Locale
): AdministrationDataTableColumn<SentRecipientRow>[] => [
  {
    accessorKey: "dotyposCustomerId",
    header: m.emailCampaignsSentRecipientsCustomerColumn({}, { locale }),
    cell: ({ row }) => (
      <Link
        className="font-mono underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
        href={administrationHref("/[locale]/admin/customers/[customerId]", {
          customerId: row.original.dotyposCustomerId,
        })}
      >
        {row.original.dotyposCustomerId}
      </Link>
    ),
  },
  {
    accessorFn: (recipient) => campaignLocaleName(recipient.locale, locale),
    id: "locale",
    header: m.emailCampaignsSentRecipientsLanguageColumn({}, { locale }),
  },
  {
    accessorKey: "status",
    header: m.emailCampaignsSentRecipientsStatusColumn({}, { locale }),
    cell: ({ row }) => (
      <CampaignRecipientStatusBadge
        locale={locale}
        status={row.original.status}
      />
    ),
  },
  {
    accessorFn: (recipient) =>
      recipient.skipReason &&
      skipReasonMessages[recipient.skipReason]({}, { locale }),
    id: "skipReason",
    header: m.emailCampaignsSentRecipientsSkipReasonColumn({}, { locale }),
  },
  {
    accessorKey: "statusUpdatedAt",
    header: m.emailCampaignsSentRecipientsStatusSinceColumn({}, { locale }),
    cell: ({ row }) => row.original.statusSince,
  },
];

export function SentRecipientTable({
  recipients,
}: {
  readonly recipients: readonly SentRecipientRow[];
}) {
  const locale = useRouteLocale();
  const columns = useMemo(() => createColumns(locale), [locale]);
  if (recipients.length === 0) {
    return (
      <EmptyState
        message={m.emailCampaignsSentRecipientsEmpty({}, { locale })}
      />
    );
  }
  return (
    <AdministrationDataTable
      ariaLabel={m.emailCampaignsSentRecipientsTableLabel({}, { locale })}
      columns={columns}
      data={recipients}
      getRowId={(recipient) => recipient.dotyposCustomerId}
      mobile={
        <ul className="divide-y divide-navy-blue/10">
          {recipients.map((recipient) => (
            <li
              className="space-y-1 px-4 py-3 text-sm"
              key={recipient.dotyposCustomerId}
            >
              <p className="flex items-center justify-between gap-3">
                <Link
                  className="font-mono underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
                  href={administrationHref(
                    "/[locale]/admin/customers/[customerId]",
                    { customerId: recipient.dotyposCustomerId }
                  )}
                >
                  {recipient.dotyposCustomerId}
                </Link>
                <CampaignRecipientStatusBadge
                  locale={locale}
                  status={recipient.status}
                />
              </p>
              {recipient.skipReason && (
                <p className="text-navy-blue/65">
                  {m.emailCampaignsSentRecipientsSkipped(
                    {
                      reason: skipReasonMessages[recipient.skipReason](
                        {},
                        { locale }
                      ),
                    },
                    { locale }
                  )}
                </p>
              )}
              <p className="text-navy-blue/65">
                {m.emailCampaignsSentRecipientsLanguageSince(
                  {
                    language: campaignLocaleName(recipient.locale, locale),
                    statusUpdatedAt: recipient.statusSince,
                  },
                  { locale }
                )}
              </p>
            </li>
          ))}
        </ul>
      }
    />
  );
}
