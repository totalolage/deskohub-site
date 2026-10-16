import { Suspense } from "react";
import { CliSessionsTable } from "@/features/admin-cli/cli-sessions-table";
import { loadCliSessions } from "@/features/admin-cli/page-data.server";
import {
  AdministrationNoticeBanner,
  AdministrationPage,
  AdministrationTableCount,
  AdministrationTableToolbar,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationCollectionLoading } from "@/features/administration/loading";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function CliSessionsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly result?: string }>;
}) {
  const locale = getRequestLocale();
  return (
    <AdministrationPage>
      <h1 className="sr-only">
        <CliSessionsTitle locale={locale} />
      </h1>
      <Suspense
        fallback={
          <AdministrationCollectionLoading label="CLI sessions" columns={8} />
        }
      >
        <CliSessionsContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </AdministrationPage>
  );
}

async function CliSessionsTitle({
  locale,
}: {
  readonly locale: Promise<Locale>;
}) {
  return m.adminCliSessionsTitle({}, { locale: await locale });
}

export async function CliSessionsContent({
  locale: localePromise,
  searchParams,
}: {
  readonly locale: Promise<Locale>;
  readonly searchParams: Promise<{ readonly result?: string }>;
}) {
  const [{ sessions, username }, locale, params] = await Promise.all([
    loadCliSessions(),
    localePromise,
    searchParams,
  ]);
  const notice = getSessionsNotice(params.result, locale);

  return (
    <>
      <AdministrationTableToolbar
        count={
          <>
            <AdministrationTableCount
              count={sessions.length}
              itemLabel="CLI session"
            />
            <p className="text-sm text-navy-blue/60">
              {m.adminCliSessionsApprovedBy({ username }, { locale })}
            </p>
          </>
        }
        itemLabel="CLI session"
      />
      <AdministrationNoticeBanner notice={notice} />

      <CliSessionsTable
        sessions={sessions.map((session) => ({
          ...session,
          createdAtText: formatAdministrationDateTime(session.createdAt),
          expiresAtText: session.expiresAt
            ? formatAdministrationDateTime(session.expiresAt)
            : null,
          lastUsedAtText: formatAdministrationDateTime(session.lastUsedAt),
        }))}
      />
    </>
  );
}

const getSessionsNotice = (result: string | undefined, locale: Locale) => {
  if (result === "revoked") {
    return {
      message: m.adminCliSessionsRevokedNotice({}, { locale }),
      status: "success" as const,
    };
  }
  if (result === "unchanged") {
    return {
      message: m.adminCliSessionsUnchangedNotice({}, { locale }),
      status: "error" as const,
    };
  }
  return undefined;
};
