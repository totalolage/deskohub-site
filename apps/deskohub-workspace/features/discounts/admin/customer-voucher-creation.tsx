"use client";

import { useRouter } from "next/navigation";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { CreateVoucherForm } from "./admin-tables";
import type { AdminCustomerProfile } from "./discount-administration.service";

type VoucherCustomer = Pick<
  AdminCustomerProfile["customer"],
  "displayName" | "id"
>;

export function CustomerVoucherCreationForm({
  completion,
  customer,
}: {
  readonly completion: "back" | "customer";
  readonly customer: VoucherCustomer;
}) {
  const router = useRouter();
  const locale = useRouteLocale();

  return (
    <CreateVoucherForm
      customer={customer}
      onCreated={() => {
        if (completion === "back") router.back();
        else
          router.replace(
            getLocalizedPagePath(
              locale,
              "/[locale]/admin/customers/[customerId]",
              { customerId: customer.id }
            )
          );
      }}
    />
  );
}

export function CustomerVoucherCreationDialog({
  customer,
}: {
  readonly customer: VoucherCustomer;
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
            {m.discountsCustomerVoucherCreateTitle(
              { customerName: customer.displayName },
              { locale }
            )}
          </DialogTitle>
          <DialogDescription>
            {m.discountsCustomerVoucherCreateDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <CustomerVoucherCreationForm completion="back" customer={customer} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
