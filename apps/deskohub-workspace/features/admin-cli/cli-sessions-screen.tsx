import Interpolate from "@doist/react-interpolate";
import { Suspense } from "react";
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
import { CliSessionsTable } from "./cli-sessions-table";
import { loadCliSessions } from "./page-data.server";

type CliSessionsSearchParams = Promise<{ readonly result?: string }>;

/** The operator's CLI sessions. Only the locale is awaited before the frame. */
export async function CliSessionsScreen({
  searchParams,
}: {
  readonly searchParams: CliSessionsSearchParams;
}) {
  const locale = await getRequestLocale();
  return (
    <AdministrationPage>
      <h1 className="sr-only">{m.adminCliSessionsTitle({}, { locale })}</h1>
      <Suspense
        fallback={
          <AdministrationCollectionLoading
            label={m.adminCliSessionsLoading({}, { locale })}
            columns={8}
          />
        }
      >
        <CliSessionsContent locale={locale} searchParams={searchParams} />
      </Suspense>
    </AdministrationPage>
  );
}

async function CliSessionsContent({
  locale,
  searchParams,
}: {
  readonly locale: Locale;
  readonly searchParams: CliSessionsSearchParams;
}) {
  const [{ sessions, administratorEmail }, params] = await Promise.all([
    loadCliSessions(),
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
              label={m.adminCliSessionsCount(
                { count: sessions.length },
                { locale }
              )}
            />
            <p className="text-sm text-navy-blue/60">
              <Interpolate
                string={m.adminCliSessionsApprovedBy({}, { locale })}
                mapping={{
                  email: (
                    <span className="font-medium">{administratorEmail}</span>
                  ),
                }}
              />
            </p>
          </>
        }
        label={m.adminCliSessionsTableControls({}, { locale })}
      />
      <AdministrationNoticeBanner notice={notice} />

      <CliSessionsTable
        sessions={sessions.map((session) => ({
          ...session,
          createdAtText: formatAdministrationDateTime(
            session.createdAt,
            locale
          ),
          expiresAtText: session.expiresAt
            ? formatAdministrationDateTime(session.expiresAt, locale)
            : null,
          lastUsedAtText: formatAdministrationDateTime(
            session.lastUsedAt,
            locale
          ),
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
