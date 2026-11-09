import { createRoot } from "react-dom/client";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { AdminShell } from "./admin-shell";
import { AdministrationLocaleSwitcher } from "./administration-locale-switcher";

const mountPoint = document.getElementById("admin-shell-test-root");

if (!mountPoint) {
  throw new Error("The AdminShell browser harness root is missing.");
}

createRoot(mountPoint).render(
  <RouteLocaleProvider locale={mountPoint.dataset.locale as Locale}>
    <AdminShell
      breadcrumb={null}
      localeSwitcher={<AdministrationLocaleSwitcher />}
    >
      <main id="main-content">Synthetic administration page</main>
    </AdminShell>
  </RouteLocaleProvider>
);
