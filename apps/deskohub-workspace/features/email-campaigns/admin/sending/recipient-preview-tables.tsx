"use client";

import type { AdministrationCampaignRecipientPreviewType as CampaignRecipientPreview } from "@deskohub/workspace-admin-api";
import Interpolate from "@doist/react-interpolate";
import { type ReactNode, useMemo } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { EmptyState } from "@/features/administration/empty-state";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { campaignLocaleName } from "./campaign-locale-names";

type Recipient = CampaignRecipientPreview["recipients"][number];
type Exclusion = CampaignRecipientPreview["exclusions"][number];
type Duplicate = CampaignRecipientPreview["duplicates"][number];

function CustomerLink({ customerId }: { readonly customerId: string }) {
  return (
    <Link
      className="font-mono underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
      href={`/admin/customers/${customerId}`}
    >
      {customerId}
    </Link>
  );
}

const createRecipientColumns = (
  locale: Locale
): AdministrationDataTableColumn<Recipient>[] => [
  {
    accessorKey: "email",
    header: m.emailCampaignsRecipientPreviewEmailColumn({}, { locale }),
  },
  {
    accessorFn: (recipient) => campaignLocaleName(recipient.locale, locale),
    id: "locale",
    header: m.emailCampaignsRecipientPreviewLanguageColumn({}, { locale }),
  },
  {
    accessorKey: "customerId",
    header: m.emailCampaignsRecipientPreviewCustomerColumn({}, { locale }),
    cell: ({ row }) => <CustomerLink customerId={row.original.customerId} />,
  },
];

const exclusionReasonMessages = {
  "missing-from-dotypos":
    m.emailCampaignsRecipientPreviewExclusionMissingFromDotypos,
  "deleted-customer": m.emailCampaignsRecipientPreviewExclusionDeletedCustomer,
  "missing-email": m.emailCampaignsRecipientPreviewExclusionMissingEmail,
  "invalid-email": m.emailCampaignsRecipientPreviewExclusionInvalidEmail,
} as const satisfies Record<
  Exclusion["reason"],
  typeof m.emailCampaignsRecipientPreviewExclusionMissingFromDotypos
>;

const describeExclusionReason = (exclusion: Exclusion, locale: Locale) =>
  exclusionReasonMessages[exclusion.reason]({}, { locale });

const createExclusionColumns = (
  locale: Locale
): AdministrationDataTableColumn<Exclusion>[] => [
  {
    accessorKey: "customerId",
    header: m.emailCampaignsRecipientPreviewCustomerColumn({}, { locale }),
    cell: ({ row }) => <CustomerLink customerId={row.original.customerId} />,
  },
  {
    accessorFn: (exclusion) => describeExclusionReason(exclusion, locale),
    id: "reason",
    header: m.emailCampaignsRecipientPreviewReasonColumn({}, { locale }),
  },
];

const createDuplicateColumns = (
  locale: Locale
): AdministrationDataTableColumn<Duplicate>[] => [
  {
    accessorKey: "email",
    header: m.emailCampaignsRecipientPreviewEmailColumn({}, { locale }),
  },
  {
    accessorKey: "recipientCustomerId",
    header: m.emailCampaignsRecipientPreviewReceivesColumn({}, { locale }),
    cell: ({ row }) => (
      <CustomerLink customerId={row.original.recipientCustomerId} />
    ),
  },
  {
    accessorFn: (duplicate) => duplicate.duplicateCustomerIds.join(", "),
    id: "skipped",
    header: m.emailCampaignsRecipientPreviewSkippedColumn({}, { locale }),
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-x-3">
        {row.original.duplicateCustomerIds.map((customerId) => (
          <CustomerLink customerId={customerId} key={customerId} />
        ))}
      </span>
    ),
  },
];

function MobileList({ children }: { readonly children: ReactNode }) {
  return <ul className="divide-y divide-navy-blue/10">{children}</ul>;
}

function MobileItem({ children }: { readonly children: ReactNode }) {
  return <li className="space-y-1 px-4 py-3 text-sm">{children}</li>;
}

export function RecipientTable({
  recipients,
}: {
  readonly recipients: CampaignRecipientPreview["recipients"];
}) {
  const locale = useRouteLocale();
  const columns = useMemo(() => createRecipientColumns(locale), [locale]);
  if (recipients.length === 0) {
    return (
      <EmptyState
        message={m.emailCampaignsRecipientPreviewRecipientsEmpty(
          {},
          { locale }
        )}
      />
    );
  }
  return (
    <AdministrationDataTable
      ariaLabel={m.emailCampaignsRecipientPreviewRecipients({}, { locale })}
      columns={columns}
      data={recipients}
      getRowId={(recipient) => recipient.customerId}
      mobile={
        <MobileList>
          {recipients.map((recipient) => (
            <MobileItem key={recipient.customerId}>
              <p className="break-all font-semibold">{recipient.email}</p>
              <p className="text-navy-blue/65">
                {campaignLocaleName(recipient.locale, locale)} ·{" "}
                <Interpolate
                  mapping={{
                    customer: (
                      <CustomerLink customerId={recipient.customerId} />
                    ),
                  }}
                  string={m.emailCampaignsRecipientPreviewCustomerInline(
                    { customer: "{customer}" },
                    { locale }
                  )}
                />
              </p>
            </MobileItem>
          ))}
        </MobileList>
      }
    />
  );
}

export function ExclusionTable({
  exclusions,
}: {
  readonly exclusions: CampaignRecipientPreview["exclusions"];
}) {
  const locale = useRouteLocale();
  const columns = useMemo(() => createExclusionColumns(locale), [locale]);
  if (exclusions.length === 0) {
    return (
      <EmptyState
        message={m.emailCampaignsRecipientPreviewExcludedEmpty({}, { locale })}
      />
    );
  }
  return (
    <AdministrationDataTable
      ariaLabel={m.emailCampaignsRecipientPreviewExcludedCustomers(
        {},
        { locale }
      )}
      columns={columns}
      data={exclusions}
      getRowId={(exclusion) => exclusion.customerId}
      mobile={
        <MobileList>
          {exclusions.map((exclusion) => (
            <MobileItem key={exclusion.customerId}>
              <p className="font-semibold">
                {describeExclusionReason(exclusion, locale)}
              </p>
              <p className="text-navy-blue/65">
                <Interpolate
                  mapping={{
                    customer: (
                      <CustomerLink customerId={exclusion.customerId} />
                    ),
                  }}
                  string={m.emailCampaignsRecipientPreviewCustomerInline(
                    { customer: "{customer}" },
                    { locale }
                  )}
                />
              </p>
            </MobileItem>
          ))}
        </MobileList>
      }
    />
  );
}

export function DuplicateTable({
  duplicates,
}: {
  readonly duplicates: CampaignRecipientPreview["duplicates"];
}) {
  const locale = useRouteLocale();
  const columns = useMemo(() => createDuplicateColumns(locale), [locale]);
  if (duplicates.length === 0) {
    return (
      <EmptyState
        message={m.emailCampaignsRecipientPreviewSharedEmailsEmpty(
          {},
          { locale }
        )}
      />
    );
  }
  return (
    <AdministrationDataTable
      ariaLabel={m.emailCampaignsRecipientPreviewSharedEmailsTitle(
        {},
        { locale }
      )}
      columns={columns}
      data={duplicates}
      getRowId={(duplicate) => duplicate.email}
      mobile={
        <MobileList>
          {duplicates.map((duplicate) => (
            <MobileItem key={duplicate.email}>
              <p className="break-all font-semibold">{duplicate.email}</p>
              <p className="text-navy-blue/65">
                <Interpolate
                  mapping={{
                    customer: (
                      <CustomerLink
                        customerId={duplicate.recipientCustomerId}
                      />
                    ),
                  }}
                  string={m.emailCampaignsRecipientPreviewReceivesInline(
                    { customer: "{customer}" },
                    { locale }
                  )}
                />
              </p>
              <p className="flex flex-wrap gap-x-3 text-navy-blue/65">
                {m.emailCampaignsRecipientPreviewSkippedInline({}, { locale })}
                {duplicate.duplicateCustomerIds.map((customerId) => (
                  <CustomerLink customerId={customerId} key={customerId} />
                ))}
              </p>
            </MobileItem>
          ))}
        </MobileList>
      }
    />
  );
}
