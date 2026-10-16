"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { EmptyState } from "@/features/administration/empty-state";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { CampaignPurposeBadge, CampaignStatusBadge } from "./campaign-badges";
import type { CampaignListItem } from "./campaign-list-page-data.server";

/** A campaign list row with its last update already formatted on the server. */
export type CampaignListRow = CampaignListItem & {
  readonly updatedAtText: string;
};

const campaignListColumns = (
  locale: Locale
): AdministrationDataTableColumn<CampaignListRow>[] => [
  {
    accessorKey: "title",
    header: m.emailCampaignsListCampaignColumn({}, { locale }),
    cell: ({ row }) => (
      <Link
        className="font-semibold underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
        href={`/admin/email-campaigns/${row.original.id}`}
      >
        {row.original.title}
      </Link>
    ),
  },
  {
    accessorKey: "purpose",
    header: m.emailCampaignsListPurposeColumn({}, { locale }),
    cell: ({ row }) => (
      <CampaignPurposeBadge locale={locale} purpose={row.original.purpose} />
    ),
  },
  {
    accessorKey: "status",
    header: m.emailCampaignsListStatusColumn({}, { locale }),
    cell: ({ row }) => (
      <CampaignStatusBadge locale={locale} status={row.original.status} />
    ),
  },
  {
    accessorFn: (campaign) => campaign.audienceTitle ?? "",
    id: "audience",
    header: m.emailCampaignsListAudienceColumn({}, { locale }),
    cell: ({ row }) =>
      row.original.audienceTitle ?? (
        <span className="text-navy-blue/55">
          {m.emailCampaignsListNoAudience({}, { locale })}
        </span>
      ),
  },
  {
    accessorKey: "updatedAt",
    header: m.emailCampaignsListUpdatedColumn({}, { locale }),
    cell: ({ row }) => row.original.updatedAtText,
  },
];

export function CampaignListTable({
  campaigns,
}: {
  readonly campaigns: readonly CampaignListRow[];
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const columns = useMemo(() => campaignListColumns(locale), [locale]);
  if (campaigns.length === 0) {
    return <EmptyState message={m.emailCampaignsListEmpty({}, { locale })} />;
  }
  return (
    <AdministrationDataTable
      ariaLabel={m.emailCampaignsListTitle({}, { locale })}
      columns={columns}
      data={campaigns}
      getRowId={(campaign) => campaign.id}
      mobile={
        <ul className="divide-y divide-navy-blue/10">
          {campaigns.map((campaign) => (
            <li key={campaign.id}>
              <Link
                className="block px-4 py-4 transition-colors hover:bg-navy-blue/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-blue/40"
                href={`/admin/email-campaigns/${campaign.id}`}
              >
                <span className="block font-semibold">{campaign.title}</span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <CampaignStatusBadge
                    locale={locale}
                    status={campaign.status}
                  />
                  <CampaignPurposeBadge
                    locale={locale}
                    purpose={campaign.purpose}
                  />
                </span>
                <span className="mt-2 block text-navy-blue/70 text-sm">
                  {campaign.audienceTitle ??
                    m.emailCampaignsListNoAudience({}, { locale })}
                </span>
                <span className="mt-3 block text-navy-blue/60 text-xs">
                  {m.emailCampaignsListUpdatedAt(
                    { updatedAt: campaign.updatedAtText },
                    { locale }
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      }
      onRowActivate={(campaign) =>
        router.push(
          localizeAdministrationHref(
            `/admin/email-campaigns/${campaign.id}`,
            locale
          )
        )
      }
      tableClassName="min-w-[720px]"
    />
  );
}
