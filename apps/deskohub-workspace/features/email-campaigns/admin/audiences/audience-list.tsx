"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
  EmptyState,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/utils";
import type { AudienceListItem } from "./audience-page-data.server";

export const audienceHref = (audienceId: string) =>
  `/admin/email-audiences/${audienceId}`;

export function AudienceStatusBadge({
  archived,
}: {
  readonly archived: boolean;
}) {
  return (
    <Badge variant={archived ? "subtle" : "default"}>
      {archived ? "Archived" : "Active"}
    </Badge>
  );
}

export function AudienceList({
  audiences,
}: {
  readonly audiences: readonly AudienceListItem[];
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const columns = useMemo<AdministrationDataTableColumn<AudienceListItem>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Audience",
        cell: ({ row }) => (
          <Link
            className={cn(
              "font-semibold underline decoration-navy-blue/25 underline-offset-4 hover:decoration-navy-blue",
              row.original.archived && "text-navy-blue/55"
            )}
            href={audienceHref(row.original.id)}
          >
            {row.original.title}
          </Link>
        ),
      },
      {
        accessorKey: "summary",
        header: "Who it reaches",
        enableSorting: false,
        cell: ({ row }) => (
          <span
            className={cn(
              "line-clamp-2 max-w-xl text-sm",
              row.original.archived ? "text-navy-blue/50" : "text-navy-blue/80"
            )}
          >
            {row.original.summary}
          </span>
        ),
      },
      {
        accessorKey: "archived",
        header: "Status",
        cell: ({ row }) => (
          <AudienceStatusBadge archived={row.original.archived} />
        ),
      },
      {
        accessorKey: "updatedAt",
        header: "Updated",
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-navy-blue/70 text-sm">
            {formatAdministrationDateTime(row.original.updatedAt)}
          </span>
        ),
      },
    ],
    []
  );

  if (audiences.length === 0) {
    return (
      <EmptyState message="No audiences yet. Create one to choose who a campaign reaches." />
    );
  }

  return (
    <AdministrationDataTable
      ariaLabel="Email audiences"
      columns={columns}
      data={audiences}
      getRowId={(audience) => audience.id}
      mobile={
        <ul className="divide-y divide-navy-blue/10">
          {audiences.map((audience) => (
            <li key={audience.id}>
              <Link
                className="block px-4 py-4 transition-colors hover:bg-navy-blue/[0.025] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-blue/40"
                href={audienceHref(audience.id)}
              >
                <span className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "font-semibold",
                      audience.archived && "text-navy-blue/55"
                    )}
                  >
                    {audience.title}
                  </span>
                  <AudienceStatusBadge archived={audience.archived} />
                </span>
                <span
                  className={cn(
                    "mt-1 line-clamp-3 block text-sm",
                    audience.archived
                      ? "text-navy-blue/50"
                      : "text-navy-blue/70"
                  )}
                >
                  {audience.summary}
                </span>
                <span className="mt-3 block text-navy-blue/60 text-xs">
                  Updated {formatAdministrationDateTime(audience.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      }
      onRowActivate={(audience) =>
        router.push(
          localizeAdministrationHref(audienceHref(audience.id), locale)
        )
      }
      tableClassName="min-w-[720px]"
    />
  );
}
