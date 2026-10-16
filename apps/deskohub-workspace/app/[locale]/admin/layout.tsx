import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminShell } from "@/features/administration/admin-shell";
import { AdministrationLocaleSwitcher } from "@/features/administration/administration-locale-switcher";
import { m } from "@/features/administration/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { createLocalePreferenceSaving } from "@/shared/components/site-header-config";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title: m.shellMetadataTitle({}, { locale }),
    robots: {
      index: false,
      follow: false,
    },
  };
}

export const instant = true;

export default function AdminLayout({
  breadcrumb,
  children,
  modal,
}: {
  readonly breadcrumb: ReactNode;
  readonly children: ReactNode;
  readonly modal: ReactNode;
}) {
  return (
    <>
      <AdminShell
        breadcrumb={breadcrumb}
        localeSwitcher={
          <AdministrationLocaleSwitcher
            localePreference={createLocalePreferenceSaving()}
          />
        }
      >
        {children}
      </AdminShell>
      {modal}
    </>
  );
}
