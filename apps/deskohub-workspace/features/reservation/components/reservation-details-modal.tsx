"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

export function ReservationDetailsModal({
  children,
  locale,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
}) {
  const router = useRouter();

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
      open
    >
      <DialogContent
        aria-describedby="reservation-details-modal-description"
        className="max-h-[calc(100dvh-2rem)] max-w-5xl overflow-y-auto p-0 [&>button]:bg-white [&>button]:text-navy-blue [&>button]:shadow-md [&>button]:hover:bg-white/90 [&>button]:hover:text-navy-blue [&>button]:focus-visible:outline-none [&>button]:focus-visible:ring-2 [&>button]:focus-visible:ring-offset-2 [&>button]:focus-visible:ring-offset-navy-blue [&>button]:focus-visible:ring-sunset-yellow"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>
            {m.checkoutStatusSummaryTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription id="reservation-details-modal-description">
            {m.checkoutStatusMetadataDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
