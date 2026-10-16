import { Suspense } from "react";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationPanelLoading } from "@/features/administration/loading";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { authorizeAdministratorPage } from "@/shared/administrator/administrator-authorization.server";
import { CreateStandaloneAccessCodeForm } from "./create-access-code-form";

/**
 * The standalone access-code screen. It awaits only the route locale, which
 * the prerender knows, so the frame stays in the instant shell while the
 * administrator check streams in behind it.
 */
export async function AccessCodesAdministrationScreen() {
  const locale = await getRequestLocale();

  return (
    <AdministrationPage>
      <AdministrationPageHeader
        title={m.accessCodesPageTitle({}, { locale })}
      />
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
