"use client";

import { useRouter } from "next/navigation";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { CustomerDiscountCodeCreationForm } from "./customer-code-creation";
import type { AdminDiscount } from "./discount-administration.service";

export function CustomerDiscountCodeCreationDialog({
  customerId,
  customerName,
  discounts,
}: {
  readonly customerId: DotyposCustomerId;
  readonly customerName: string;
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
}) {
  const router = useRouter();
  const locale = useRouteLocale();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
      open
    >
      <DialogContent
        className="max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto"
        locale={locale}
      >
        <DialogHeader>
          <DialogTitle>
            {m.discountsCustomerCodeCreateTitle({ customerName }, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.discountsCustomerCodeCreateDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <CustomerDiscountCodeCreationForm
            completion="back"
            customerId={customerId}
            customerName={customerName}
            discounts={discounts}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
