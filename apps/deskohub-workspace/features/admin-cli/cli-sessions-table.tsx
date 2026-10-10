"use client";

import { useMemo } from "react";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/components";
import { EmptyState } from "@/features/administration/empty-state";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import type { CliSessionAdministrationItem } from "./cli-authentication.service";
import { RenameCliSession } from "./rename-cli-session";
import { RevokeCliSession } from "./revoke-cli-session";

export function CliSessionsTable({
  sessions,
}: {
  readonly sessions: readonly CliSessionAdministrationItem[];
}) {
  const columns = useMemo<
    AdministrationDataTableColumn<CliSessionAdministrationItem>[]
  >(
    () => [
      {
        accessorKey: "clientName",
        header: "Client",
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
        header: "Build",
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
        header: "Approved by",
        cell: ({ row }) => (
          <p className="font-medium">
            {row.original.approvedBy ?? "Unavailable"}
          </p>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ getValue }) =>
          formatAdministrationDateTime(getValue<string>()),
      },
      {
        accessorKey: "lastUsedAt",
        header: "Last used",
        cell: ({ getValue }) =>
          formatAdministrationDateTime(getValue<string>()),
      },
      {
        accessorFn: (session) => session.expiresAt ?? "",
        id: "expiresAt",
        header: "Expires",
        cell: ({ row }) =>
          row.original.expiresAt
            ? formatAdministrationDateTime(row.original.expiresAt)
            : "Never",
      },
      {
        accessorKey: "status",
        header: "Status",
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
            {
              {
                active: "Active",
                expired: "Expired",
                revoked: "Revoked",
              }[row.original.status]
            }
          </StatusBadge>
        ),
      },
    ],
    []
  );

  if (sessions.length === 0) {
    return (
      <EmptyState message="No CLI sessions yet. Sessions will appear after a user completes dhw auth." />
    );
  }

  return (
    <AdministrationDataTable
      actionsLabel="Action"
      ariaLabel="CLI sessions"
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
