import { EmptyState } from "@/features/administration/empty-state";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { AdministrationStatusBadge } from "@/features/administration/status-badge";
import { AdministrationTableFrame } from "@/features/administration/table-frame";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";
import type { CliSessionAdministrationItem } from "./cli-authentication.service";
import { RenameCliSession } from "./rename-cli-session";
import { RevokeCliSession } from "./revoke-cli-session";

export function CliSessionsTable({
  sessions,
}: {
  readonly sessions: readonly CliSessionAdministrationItem[];
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState message="No CLI sessions yet. Sessions will appear after a user completes dhw auth." />
    );
  }

  return (
    <AdministrationTableFrame>
      <div className="overflow-x-auto">
        <Table aria-label="CLI sessions" className="min-w-[880px]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Client</TableHead>
              <TableHead>Build</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow key={session.id}>
                <TableCell>
                  <p className="font-semibold">{session.clientName}</p>
                  <p className="mt-1 font-mono text-xs text-navy-blue/55">
                    {session.id}
                  </p>
                </TableCell>
                <TableCell>
                  <p className="font-medium">{session.cliVersion}</p>
                  <p className="mt-1 text-xs text-navy-blue/60">
                    {session.buildTarget}
                  </p>
                </TableCell>
                <TableCell>
                  {formatAdministrationDateTime(session.createdAt)}
                </TableCell>
                <TableCell>
                  {formatAdministrationDateTime(session.lastUsedAt)}
                </TableCell>
                <TableCell>
                  <AdministrationStatusBadge
                    tone={session.revokedAt ? "neutral" : "positive"}
                  >
                    {session.revokedAt ? "Revoked" : "Active"}
                  </AdministrationStatusBadge>
                </TableCell>
                <TableCell className="text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AdministrationTableFrame>
  );
}
