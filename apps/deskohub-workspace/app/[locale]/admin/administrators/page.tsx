import { Suspense } from "react";
import { AdministrationPage } from "@/features/administration/components";
import { AdministratorRoster } from "@/features/administrators/admin/administrator-roster";
import {
  AdministratorsLoading,
  AdministratorsPageHeader,
} from "@/features/administrators/admin/administrators-page-header";
import { loadAdministrators } from "@/features/administrators/admin/page-data.server";

export default function AdministratorsPage() {
  return (
    <AdministrationPage>
      <AdministratorsPageHeader />
      <Suspense fallback={<AdministratorsLoading />}>
        <AdministratorsContent />
      </Suspense>
    </AdministrationPage>
  );
}

async function AdministratorsContent() {
  return <AdministratorRoster {...(await loadAdministrators())} />;
}
