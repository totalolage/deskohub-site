import { loadCliSessions } from "@/features/admin-cli/page-data.server";
import { RenameCliSession } from "@/features/admin-cli/rename-cli-session";
import { RevokeCliSession } from "@/features/admin-cli/revoke-cli-session";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationPageHeader,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { Badge } from "@/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/components/ui/table";

export const dynamic = "force-dynamic";

export default async function CliSessionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly result?: string }>;
}) {
  const [sessions, params] = await Promise.all([
    loadCliSessions(),
    searchParams,
  ]);
  const notice = getSessionsNotice(params.result);

  return (
    <AdministrationPage>
      <AdministrationPageHeader
        count={sessions.length}
        description="Review every command-line credential issued for Workspace administration and revoke access immediately."
        eyebrow="CLI security"
        title="CLI sessions"
      />
      <AdministrationNoticeBanner notice={notice} />

      {sessions.length === 0 ? (
        <div className="rounded-xl border border-navy-blue/10 bg-white p-6">
          <h2 className="text-xl">No CLI sessions yet</h2>
          <p className="mt-2 text-sm leading-6 text-navy-blue/65">
            Sessions will appear here after a user completes dhw auth.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-navy-blue/10 bg-white">
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
                      <Badge variant={session.revokedAt ? "subtle" : "default"}>
                        {session.revokedAt ? "Revoked" : "Active"}
                      </Badge>
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
        </div>
      )}
    </AdministrationPage>
  );
}

const getSessionsNotice = (result: string | undefined) => {
  if (result === "revoked") {
    return { message: "CLI session revoked.", status: "success" as const };
  }
  if (result === "unchanged") {
    return {
      message: "That CLI session was already revoked or no longer exists.",
      status: "error" as const,
    };
  }
  return undefined;
};
