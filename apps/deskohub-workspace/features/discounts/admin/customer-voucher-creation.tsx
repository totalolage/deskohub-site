"use client";

import { useRouter } from "next/navigation";
import { localizeAdministrationHref } from "@/features/administration/administration-href";
import { useRouteLocale } from "@/features/i18n/use-route-locale";
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
            localizeAdministrationHref(
              `/admin/customers/${customer.id}`,
              locale
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

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
      open
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create voucher for {customer.displayName}</DialogTitle>
          <DialogDescription>
            Issue promotional credit that only this customer can spend.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <CustomerVoucherCreationForm completion="back" customer={customer} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
