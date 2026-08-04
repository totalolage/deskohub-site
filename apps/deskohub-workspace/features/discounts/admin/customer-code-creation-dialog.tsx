"use client";

import { useRouter } from "next/navigation";
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

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
      open
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create discount code for {customerName}</DialogTitle>
          <DialogDescription>
            Create a code restricted to this customer and choose the discount it
            applies.
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
