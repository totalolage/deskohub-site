import { createRoot } from "react-dom/client";
import "@/shared/polyfills/temporal";
import type { StoredDiscountId } from "@/features/discounts/persistence-contracts";
import { isLocale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  DiscountCodeCreationDialog,
  VoucherCreationDialog,
} from "./creation-dialogs";

const mountPoint = document.getElementById("discount-dialogs-root");

if (!mountPoint) {
  throw new Error("The discount dialogs browser harness root is missing.");
}

// The page's language picks the route locale.
const requestedLocale = document.documentElement.lang;
const locale = isLocale(requestedLocale) ? requestedLocale : "en-US";

const discounts = [
  {
    id: "019c91dd-c560-7e55-b9d8-c95065efd51d" as StoredDiscountId,
    labels: { "cs-CZ": "Letní sleva", "en-US": "Summer discount" },
  },
];

createRoot(mountPoint).render(
  <RouteLocaleProvider locale={locale}>
    <main className="flex flex-wrap gap-3 p-4">
      <DiscountCodeCreationDialog discounts={discounts} />
      <VoucherCreationDialog />
    </main>
  </RouteLocaleProvider>
);
