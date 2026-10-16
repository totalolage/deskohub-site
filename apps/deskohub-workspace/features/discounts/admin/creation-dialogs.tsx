"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { CreateDiscountForm, CreateVoucherForm } from "./admin-tables";
import { DiscountCodeCreationForm } from "./customer-code-creation";
import type { AdminDiscount } from "./discount-administration.service";

const dialogContentClassName =
  "max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto";

export function DiscountCodeCreationDialog({
  discounts,
}: {
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
}) {
  const locale = useRouteLocale();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden className="size-4" />
          {m.discountsCodeCreateButton({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent className={dialogContentClassName} locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.discountsCodeCreateTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.discountsCodeCreateDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <DiscountCodeCreationForm discounts={discounts} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SaleDiscountCreationDialog() {
  const locale = useRouteLocale();
  const [completion, setCompletion] = useState<string | null>(null);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) setCompletion(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden className="size-4" />
          {m.discountsSaleCreateButton({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent className={dialogContentClassName} locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.discountsSaleCreateTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.discountsSaleCreateDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          {completion ? (
            <output
              aria-live="polite"
              className="block rounded-xl bg-aquamarine-green/12 px-4 py-4 text-aquamarine-ink"
            >
              <p className="font-semibold">{completion}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <DialogClose asChild>
                  <Button type="button">
                    {m.discountsDialogClose({}, { locale })}
                  </Button>
                </DialogClose>
                <Button
                  onClick={() => setCompletion(null)}
                  type="button"
                  variant="secondary"
                >
                  {m.discountsSaleCreateAnother({}, { locale })}
                </Button>
              </div>
            </output>
          ) : (
            <CreateDiscountForm onCreated={setCompletion} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function VoucherCreationDialog() {
  const locale = useRouteLocale();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden className="size-4" />
          {m.discountsVoucherCreateButton({}, { locale })}
        </Button>
      </DialogTrigger>
      <DialogContent className={dialogContentClassName} locale={locale}>
        <DialogHeader>
          <DialogTitle>
            {m.discountsVoucherCreateTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription>
            {m.discountsVoucherCreateDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-5">
          <CreateVoucherForm />
        </div>
      </DialogContent>
    </Dialog>
  );
}
