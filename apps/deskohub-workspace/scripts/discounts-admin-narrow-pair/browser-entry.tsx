import { createRoot } from "react-dom/client";
import "../../app/globals.css";
import "@/shared/polyfills/temporal";
import {
  DiscountCodeCreationDialog,
  VoucherCreationDialog,
} from "@/features/discounts/admin/creation-dialogs";
import type { AdminDiscount } from "@/features/discounts/admin/discount-administration.service";
import type { StoredDiscountId } from "@/features/discounts/persistence-contracts";

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
