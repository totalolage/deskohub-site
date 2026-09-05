import { Suspense } from "react";
import { CreateStandaloneAccessCodeForm } from "@/features/access-codes/admin/create-access-code-form";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { AdministrationPanelLoading } from "@/features/administration/loading";
import { authorizeAdministratorPage } from "@/shared/administrator/administrator-authorization.server";

export default function AccessCodesAdminPage() {
  return (
    <AdministrationPage>
      <AdministrationPageHeader title="Create an access code" />
      <Suspense
        fallback={
          <div className="max-w-3xl">
            <AdministrationPanelLoading label="access-code form" />
          </div>
        }
      >
        <AuthorizedAccessCodeCard />
      </Suspense>
    </AdministrationPage>
  );
}

export async function AuthorizedAccessCodeCard() {
  await authorizeAdministratorPage();
  return (
    <div className="max-w-3xl rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
      <CreateStandaloneAccessCodeForm />
    </div>
  );
}
