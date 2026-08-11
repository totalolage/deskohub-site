import { CliSessionsTable } from "@/features/admin-cli/cli-sessions-table";
import { loadCliSessions } from "@/features/admin-cli/page-data.server";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationTableToolbar,
} from "@/features/administration/components";

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
      <h1 className="sr-only">CLI sessions</h1>
      <AdministrationTableToolbar
        count={sessions.length}
        itemLabel="CLI session"
      />
      <AdministrationNoticeBanner notice={notice} />

      <CliSessionsTable sessions={sessions} />
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
