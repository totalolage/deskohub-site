"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
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
import { CreateDiscountForm } from "./admin-tables";
import { DiscountCodeCreationForm } from "./customer-code-creation";
import type { AdminDiscount } from "./discount-administration.service";

const dialogContentClassName =
  "max-h-[calc(100vh-2rem)] max-w-4xl overflow-y-auto";

export function DiscountCodeCreationDialog({
  discounts,
}: {
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus aria-hidden className="size-4" />
          Create a discount code
        </Button>
      </DialogTrigger>
      <DialogContent className={dialogContentClassName}>
        <DialogHeader>
          <DialogTitle>Create a discount code</DialogTitle>
          <DialogDescription>
            Pair a new code with an existing discount or define both together.
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
          Create a sale discount
        </Button>
      </DialogTrigger>
      <DialogContent className={dialogContentClassName}>
        <DialogHeader>
          <DialogTitle>Create a sale discount</DialogTitle>
          <DialogDescription>
            Define the discount, then use its Calendar ID in an all-day sale
            event.
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
                  <Button type="button">Close</Button>
                </DialogClose>
                <Button
                  onClick={() => setCompletion(null)}
                  type="button"
                  variant="secondary"
                >
                  Create another discount
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
