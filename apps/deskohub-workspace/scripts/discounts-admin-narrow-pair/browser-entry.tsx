import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import "@/shared/polyfills/temporal";
import { isLocale, setLocale } from "@/features/i18n";
import {
  DiscountCodeCreationDialog,
  VoucherCreationDialog,
} from "@/features/discounts/admin/creation-dialogs";
import type { AdminDiscount } from "@/features/discounts/admin/discount-administration.service";
import type { StoredDiscountId } from "@/features/discounts/persistence-contracts";

// The Playwright context sets navigator.language per scenario locale; adopt
// it before the first render so paraglide's getLocale() resolves it.
const navigatorLocale = navigator.language;
if (isLocale(navigatorLocale)) {
  setLocale(navigatorLocale, { reload: false });
}

const discounts: readonly Pick<AdminDiscount, "id" | "labels">[] = [
  {
    id: "019c91dd-c560-7e55-b9d8-c95065efd51d" as StoredDiscountId,
    labels: {
      "cs-CZ": "Letní sleva",
      "en-US": "Summer discount",
    },
  },
];

const root = createRoot(document.getElementById("root")!);
root.render(
  <main style={{ padding: "1rem" }}>
    <DiscountCodeCreationDialog discounts={discounts} />
    <VoucherCreationDialog />
  </main>
);
