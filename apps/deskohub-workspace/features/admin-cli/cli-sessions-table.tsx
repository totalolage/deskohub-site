"use client";

import { useMemo } from "react";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/components";
import { EmptyState } from "@/features/administration/empty-state";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import type { CliSessionAdministrationItem } from "./cli-authentication.service";
import { RenameCliSession } from "./rename-cli-session";
import { RevokeCliSession } from "./revoke-cli-session";

/**
 * A CLI session with its date-times already formatted on the server, where the
 * locale data matches the rendered HTML.
 */
export type CliSessionsTableRow = CliSessionAdministrationItem & {
  readonly createdAtText: string;
  readonly expiresAtText: string | null;
  readonly lastUsedAtText: string;
};

export function CliSessionsTable({
  sessions,
}: {
  readonly sessions: readonly CliSessionsTableRow[];
}) {
  const locale = useRouteLocale();
  const columns = useMemo<AdministrationDataTableColumn<CliSessionsTableRow>[]>(
    () => [
      {
        accessorKey: "clientName",
        header: m.adminCliSessionsTableClient({}, { locale }),
        cell: ({ row }) => (
          <>
            <p className="font-semibold">{row.original.clientName}</p>
            <p className="mt-1 font-mono text-xs text-navy-blue/55">
              {row.original.id}
            </p>
          </>
        ),
      },
      {
        accessorKey: "cliVersion",
        header: m.adminCliSessionsTableBuild({}, { locale }),
        cell: ({ row }) => (
          <>
            <p className="font-medium">{row.original.cliVersion}</p>
            <p className="mt-1 text-xs text-navy-blue/60">
              {row.original.buildTarget}
            </p>
          </>
        ),
      },
      {
        accessorFn: (session) => session.approvedBy ?? "",
        id: "approvedBy",
        header: m.adminCliSessionsTableApprovedBy({}, { locale }),
        cell: ({ row }) => (
          <p className="font-medium">
            {row.original.approvedBy ??
              m.adminCliSessionsTableApproverUnavailable({}, { locale })}
          </p>
        ),
      },
      {
        accessorKey: "createdAt",
        header: m.adminCliSessionsTableCreated({}, { locale }),
        cell: ({ row }) => row.original.createdAtText,
      },
      {
        accessorKey: "lastUsedAt",
        header: m.adminCliSessionsTableLastUsed({}, { locale }),
        cell: ({ row }) => row.original.lastUsedAtText,
      },
      {
        accessorFn: (session) => session.expiresAt ?? "",
        id: "expiresAt",
        header: m.adminCliSessionsTableExpires({}, { locale }),
        cell: ({ row }) =>
          row.original.expiresAtText ??
          m.adminCliSessionsTableExpiresNever({}, { locale }),
      },
      {
        accessorKey: "status",
        header: m.adminCliSessionsTableStatus({}, { locale }),
        cell: ({ row }) => (
          <StatusBadge
            tone={
              (
                {
                  active: "positive",
                  expired: "neutral",
                  revoked: "neutral",
                } as const
              )[row.original.status]
            }
          >
            {{
              active: m.adminCliSessionsTableStatusActive,
              expired: m.adminCliSessionsTableStatusExpired,
              revoked: m.adminCliSessionsTableStatusRevoked,
            }[row.original.status]({}, { locale })}
          </StatusBadge>
        ),
      },
    ],
    [locale]
  );

  if (sessions.length === 0) {
    return <EmptyState message={m.adminCliSessionsEmpty({}, { locale })} />;
  }

  return (
    <AdministrationDataTable
      actionsLabel={m.adminCliSessionsTableActions({}, { locale })}
      ariaLabel={m.adminCliSessionsTitle({}, { locale })}
      columns={columns}
      data={sessions}
      getRowId={(session) => session.id}
      renderActions={(session) => (
        <div className="flex justify-end gap-2">
          <RenameCliSession
            clientName={session.clientName}
            sessionId={session.id}
          />
          <RevokeCliSession
            clientName={session.clientName}
            revoked={session.revokedAt !== null}
            sessionId={session.id}
          />
        </div>
      )}
      tableClassName="min-w-[1120px]"
    />
  );
}
