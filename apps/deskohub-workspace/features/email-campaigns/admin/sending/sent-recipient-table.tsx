"use client";

import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { EmptyState } from "@/features/administration/empty-state";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import type { Locale } from "@/features/i18n";
import type {
  CampaignRecipientSkipReason,
  CampaignRecipientStatus,
} from "../../campaign-states";
import { CampaignRecipientStatusBadge } from "../campaign-list/campaign-badges";
import { campaignLocaleNames } from "./campaign-locale-names";

export type SentRecipientRow = {
  readonly dotyposCustomerId: string;
  readonly locale: Locale;
  readonly status: CampaignRecipientStatus;
  /** Why a `skipped` recipient wasn't mailed; null for other statuses. */
  readonly skipReason: CampaignRecipientSkipReason | null;
  /** ISO instant. */
  readonly statusUpdatedAt: string;
};

const skipReasonLabels = {
  "missing-from-dotypos": "No longer in Dotypos",
  "deleted-customer": "Customer deleted",
  "missing-email": "No email address",
  "invalid-email": "Invalid email address",
  "consent-withdrawn": "Marketing consent withdrawn",
  "outside-test-domain": "Outside the test email domain",
} as const satisfies Record<CampaignRecipientSkipReason, string>;

const columns: AdministrationDataTableColumn<SentRecipientRow>[] = [
  {
    accessorKey: "dotyposCustomerId",
    header: "Customer",
    cell: ({ row }) => (
      <Link
        className="font-mono underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue"
        href={`/admin/customers/${row.original.dotyposCustomerId}`}
      >
        {row.original.dotyposCustomerId}
      </Link>
    ),
  },
  {
    accessorFn: (recipient) => campaignLocaleNames[recipient.locale],
    id: "locale",
    header: "Language",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <CampaignRecipientStatusBadge status={row.original.status} />
    ),
  },
  {
    accessorFn: (recipient) =>
      recipient.skipReason && skipReasonLabels[recipient.skipReason],
    id: "skipReason",
    header: "Skip reason",
  },
  {
    accessorKey: "statusUpdatedAt",
    header: "Status since",
    cell: ({ row }) =>
      formatAdministrationDateTime(row.original.statusUpdatedAt),
  },
];

export function SentRecipientTable({
  recipients,
}: {
  readonly recipients: readonly SentRecipientRow[];
}) {
  if (recipients.length === 0) {
    return <EmptyState message="This send froze no recipients." />;
  }
  return (
    <AdministrationDataTable
      ariaLabel="Campaign recipients"
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
                  href={`/admin/customers/${recipient.dotyposCustomerId}`}
                >
                  {recipient.dotyposCustomerId}
                </Link>
                <CampaignRecipientStatusBadge status={recipient.status} />
              </p>
              {recipient.skipReason && (
                <p className="text-navy-blue/65">
                  Skipped: {skipReasonLabels[recipient.skipReason]}
                </p>
              )}
              <p className="text-navy-blue/65">
                {campaignLocaleNames[recipient.locale]} · since{" "}
                {formatAdministrationDateTime(recipient.statusUpdatedAt)}
              </p>
            </li>
          ))}
        </ul>
      }
    />
  );
}
