"use client";

import { AdministrationPageHeader } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationCollectionLoading } from "@/features/administration/loading";
import { useRouteLocale } from "@/features/i18n/route-locale";

export function AdministratorsPageHeader() {
  const locale = useRouteLocale();
  return (
    <AdministrationPageHeader
      description={m.administratorsPageDescription({}, { locale })}
      title={m.administratorsPageTitle({}, { locale })}
    />
  );
}

export function AdministratorsLoading() {
  const locale = useRouteLocale();
  return (
    <AdministrationCollectionLoading
      columns={4}
      label={m.administratorsListLabel({}, { locale })}
      rows={3}
    />
  );
}
