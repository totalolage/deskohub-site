import { createRoot } from "react-dom/client";
import { AdminShell } from "@/features/administration/admin-shell";
import { AdministrationPage } from "@/features/administration/components";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { CampaignComposer } from "./campaign-composer";
import { newCampaignComposerFields } from "./campaign-composer-fields";

const mountPoint = document.getElementById("campaign-composer-test-root");

if (!mountPoint) {
  throw new Error("The campaign composer browser harness root is missing.");
}

createRoot(mountPoint).render(
  <RouteLocaleProvider locale={mountPoint.dataset.locale as Locale}>
    <AdminShell breadcrumb={null} localeSwitcher={null}>
      <AdministrationPage>
        <CampaignComposer
          adminInbox={null}
          audiences={[]}
          campaign={undefined}
          initialFields={newCampaignComposerFields}
          templates={[]}
        />
      </AdministrationPage>
    </AdminShell>
  </RouteLocaleProvider>
);
