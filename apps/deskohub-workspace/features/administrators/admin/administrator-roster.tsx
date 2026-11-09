"use client";

import { useState } from "react";
import {
  AdministrationDataTable,
  type AdministrationDataTableColumn,
} from "@/features/administration/components";
import { EmptyState } from "@/features/administration/empty-state";
import { m } from "@/features/administration/i18n";
import {
  type AdministrationNotice,
  AdministrationNoticeBanner,
} from "@/features/administration/notice";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { GrantAdministratorForm } from "./grant-administrator-form";
import type { AdministratorsPageData } from "./page-data.server";
import { RevokeAdministrator } from "./revoke-administrator";

/** The administrators, with grant and revoke controls for the acting one. */
export function AdministratorRoster({
  actorAccountId,
  administrators,
}: AdministratorsPageData) {
  const locale = useRouteLocale();
  const [notice, setNotice] = useState<AdministrationNotice>();

  const columns: AdministrationDataTableColumn<
    AdministratorsPageData["administrators"][number]
  >[] = [
    {
      accessorKey: "email",
      header: m.administratorsColumnAccount({}, { locale }),
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-2 font-medium">
          <span>{row.original.email}</span>
          {row.original.accountId === actorAccountId && (
            <StatusBadge tone="neutral">
              {m.administratorsCurrentAccount({}, { locale })}
            </StatusBadge>
          )}
        </span>
      ),
    },
    {
      accessorFn: (administrator) => administrator.grantedByEmail ?? "",
      id: "grantedBy",
      header: m.administratorsColumnGrantedBy({}, { locale }),
      cell: ({ row }) =>
        row.original.grantedByEmail ??
        m.administratorsGrantedBySystem({}, { locale }),
    },
    {
      accessorKey: "grantedAt",
      header: m.administratorsColumnGrantedAt({}, { locale }),
      cell: ({ row }) => row.original.grantedAtLabel,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="max-w-3xl rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
        <h2 className="text-lg font-semibold">
          {m.administratorsGrantTitle({}, { locale })}
        </h2>
        <p className="mt-1 mb-4 text-sm leading-6 text-navy-blue/62">
          {m.administratorsGrantDescription({}, { locale })}
        </p>
        <GrantAdministratorForm
          onOutcome={(outcome) =>
            setNotice(
              outcome.kind === "failed"
                ? { message: outcome.message, status: "error" }
                : {
                    message: (outcome.kind === "granted"
                      ? m.administratorsGrantGranted
                      : m.administratorsGrantAlreadyAdministrator)(
                      { email: outcome.email },
                      { locale }
                    ),
                    status: "success",
                  }
            )
          }
        />
      </section>
      <AdministrationNoticeBanner notice={notice} />
      {administrators.length === 0 ? (
        <EmptyState message={m.administratorsEmpty({}, { locale })} />
      ) : (
        <AdministrationDataTable
          actionsLabel={m.administratorsColumnActions({}, { locale })}
          ariaLabel={m.administratorsListLabel({}, { locale })}
          columns={columns}
          data={administrators}
          getRowId={(administrator) => administrator.accountId}
          renderActions={(administrator) =>
            administrator.accountId === actorAccountId ? null : (
              <div className="flex justify-end">
                <RevokeAdministrator
                  administrator={administrator}
                  onRevoked={({ changed }) =>
                    setNotice({
                      message: (changed
                        ? m.administratorsRevokeRevoked
                        : m.administratorsRevokeUnchanged)(
                        { email: administrator.email },
                        { locale }
                      ),
                      status: "success",
                    })
                  }
                />
              </div>
            )
          }
        />
      )}
    </div>
  );
}
