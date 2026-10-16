"use client";

import type { ReactNode } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/data-table";
import { EmptyState } from "@/features/administration/empty-state";
import { campaignLocaleNames } from "./campaign-locale-names";
import type { CampaignRecipientResolution } from "./recipient-preview.server";

type Recipient = CampaignRecipientResolution["recipients"][number];
type Exclusion = CampaignRecipientResolution["exclusions"][number];
type Duplicate = CampaignRecipientResolution["duplicates"][number];

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

const recipientColumns: AdministrationDataTableColumn<Recipient>[] = [
  { accessorKey: "email", header: "Email" },
  {
    accessorFn: (recipient) => campaignLocaleNames[recipient.locale],
    id: "locale",
    header: "Language",
  },
  {
    accessorKey: "dotyposCustomerId",
    header: "Customer",
    cell: ({ row }) => (
      <CustomerLink customerId={row.original.dotyposCustomerId} />
    ),
  },
];

const exclusionReasons = {
  "missing-from-dotypos": "Not found in Dotypos",
  "deleted-customer": "Deleted in Dotypos",
  "missing-email": "No email in Dotypos",
  "invalid-email": "Invalid email in Dotypos",
} as const satisfies Record<Exclusion["reason"], string>;

const exclusionColumns: AdministrationDataTableColumn<Exclusion>[] = [
  {
    accessorKey: "dotyposCustomerId",
    header: "Customer",
    cell: ({ row }) => (
      <CustomerLink customerId={row.original.dotyposCustomerId} />
    ),
  },
  {
    accessorFn: (exclusion) => exclusionReasons[exclusion.reason],
    id: "reason",
    header: "Reason",
  },
];

const duplicateColumns: AdministrationDataTableColumn<Duplicate>[] = [
  { accessorKey: "email", header: "Email" },
  {
    accessorKey: "recipientCustomerId",
    header: "Receives the email",
    cell: ({ row }) => (
      <CustomerLink customerId={row.original.recipientCustomerId} />
    ),
  },
  {
    accessorFn: (duplicate) => duplicate.duplicateCustomerIds.join(", "),
    id: "skipped",
    header: "Skipped",
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
  readonly recipients: CampaignRecipientResolution["recipients"];
}) {
  if (recipients.length === 0) {
    return (
      <EmptyState message="The audience reaches no customers right now." />
    );
  }
  return (
    <AdministrationDataTable
      ariaLabel="Recipients"
      columns={recipientColumns}
      data={recipients}
      getRowId={(recipient) => recipient.dotyposCustomerId}
      mobile={
        <MobileList>
          {recipients.map((recipient) => (
            <MobileItem key={recipient.dotyposCustomerId}>
              <p className="break-all font-semibold">{recipient.email}</p>
              <p className="text-navy-blue/65">
                {campaignLocaleNames[recipient.locale]} · Customer{" "}
                <CustomerLink customerId={recipient.dotyposCustomerId} />
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
  readonly exclusions: CampaignRecipientResolution["exclusions"];
}) {
  if (exclusions.length === 0) {
    return <EmptyState message="No matching customer was excluded." />;
  }
  return (
    <AdministrationDataTable
      ariaLabel="Excluded customers"
      columns={exclusionColumns}
      data={exclusions}
      getRowId={(exclusion) => exclusion.dotyposCustomerId}
      mobile={
        <MobileList>
          {exclusions.map((exclusion) => (
            <MobileItem key={exclusion.dotyposCustomerId}>
              <p className="font-semibold">
                {exclusionReasons[exclusion.reason]}
              </p>
              <p className="text-navy-blue/65">
                Customer{" "}
                <CustomerLink customerId={exclusion.dotyposCustomerId} />
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
  readonly duplicates: CampaignRecipientResolution["duplicates"];
}) {
  if (duplicates.length === 0) {
    return <EmptyState message="No two customers share an email address." />;
  }
  return (
    <AdministrationDataTable
      ariaLabel="Shared email addresses"
      columns={duplicateColumns}
      data={duplicates}
      getRowId={(duplicate) => duplicate.email}
      mobile={
        <MobileList>
          {duplicates.map((duplicate) => (
            <MobileItem key={duplicate.email}>
              <p className="break-all font-semibold">{duplicate.email}</p>
              <p className="text-navy-blue/65">
                Receives it:{" "}
                <CustomerLink customerId={duplicate.recipientCustomerId} />
              </p>
              <p className="flex flex-wrap gap-x-3 text-navy-blue/65">
                Skipped:
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
