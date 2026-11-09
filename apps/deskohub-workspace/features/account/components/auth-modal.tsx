"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

/**
 * An auth page opened over the current page by a client navigation, such as
 * the header's sign-in. The card inside is the dialog's surface; closing
 * goes back to the page underneath. A document load of the same URL renders
 * the full page instead.
 */
export function AuthModal({
  children,
  description,
  locale,
  title,
}: {
  readonly children: ReactNode;
  readonly description: string;
  readonly locale: Locale;
  readonly title: string;
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
        aria-describedby="auth-modal-description"
        locale={locale}
        className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto border-0 bg-transparent p-0 shadow-none [&>button]:right-4 [&>button]:top-4 [&>div]:bg-white"
      >
        {/* The card shows its own heading, so the dialog's label isn't one. */}
        <DialogHeader className="sr-only">
          <DialogTitle asChild>
            <p>{title}</p>
          </DialogTitle>
          <DialogDescription id="auth-modal-description">
            {description}
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
