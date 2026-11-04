"use client";

import { CircleAlert } from "lucide-react";
import { AdministrationAlert } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

/** Confirms a reviewed manual invoice against its rendered preview before it is created and sent. */
export function InvoiceReviewDialog({
  createError,
  isCreating,
  isPreviewing,
  locale,
  onCreate,
  onOpenChange,
  open,
  previewError,
  previewUrl,
  reviewTotal,
}: {
  readonly createError: string | null;
  readonly isCreating: boolean;
  readonly isPreviewing: boolean;
  readonly locale: Locale;
  readonly onCreate: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly previewError: string | null;
  readonly previewUrl: string | null;
  /** `null` when a line price can't be summed in the invoice currency. */
  readonly reviewTotal: string | null;
}) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden"
        locale={locale}
      >
        <DialogHeader>
          <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-red-100 text-red-800">
            <CircleAlert aria-hidden className="size-6" />
          </div>
          <DialogTitle>
            {m.accountingInvoiceFormConfirmTitle({}, { locale })}
          </DialogTitle>
          <DialogDescription className="text-base leading-6">
            {m.accountingInvoiceFormConfirmDescription({}, { locale })}
          </DialogDescription>
        </DialogHeader>
        {open && (
          <InvoiceReviewPreview
            isPreviewing={isPreviewing}
            locale={locale}
            previewUrl={previewUrl}
          />
        )}
        {open && reviewTotal === null && (
          <AdministrationAlert role="alert" status="error">
            {m.accountingInvoiceFormInvalidTotal({}, { locale })}
          </AdministrationAlert>
        )}
        {createError && (
          <AdministrationAlert role="alert" status="error">
            {createError}
          </AdministrationAlert>
        )}
        {previewError && (
          <AdministrationAlert role="alert" status="error">
            {previewError}
          </AdministrationAlert>
        )}
        <InvoiceReviewActions
          isCreating={isCreating}
          isPreviewing={isPreviewing}
          locale={locale}
          onCreate={onCreate}
          open={open}
          previewUrl={previewUrl}
          reviewTotal={reviewTotal}
        />
      </DialogContent>
    </Dialog>
  );
}

function InvoiceReviewPreview({
  isPreviewing,
  locale,
  previewUrl,
}: {
  readonly isPreviewing: boolean;
  readonly locale: Locale;
  readonly previewUrl: string | null;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-navy-blue/10 bg-navy-blue/5">
      {isPreviewing && (
        <div
          aria-live="polite"
          className="grid min-h-96 place-items-center text-sm text-navy-blue/65"
        >
          {m.accountingInvoiceFormPreviewGenerating({}, { locale })}
        </div>
      )}
      {previewUrl && (
        <>
          <iframe
            className="h-[60dvh] min-h-96 w-full bg-white"
            src={previewUrl}
            title={m.accountingInvoiceFormPreviewTitle({}, { locale })}
          />
          <div className="border-t border-navy-blue/10 p-3 text-right text-sm">
            <a
              className="font-semibold text-burned-orange underline-offset-4 hover:underline"
              href={previewUrl}
              rel="noreferrer"
              target="_blank"
            >
              {m.accountingInvoiceFormPreviewOpen({}, { locale })}
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function InvoiceReviewActions({
  isCreating,
  isPreviewing,
  locale,
  onCreate,
  open,
  previewUrl,
  reviewTotal,
}: {
  readonly isCreating: boolean;
  readonly isPreviewing: boolean;
  readonly locale: Locale;
  readonly onCreate: () => void;
  readonly open: boolean;
  readonly previewUrl: string | null;
  readonly reviewTotal: string | null;
}) {
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button disabled={isCreating} type="button" variant="secondary">
          {m.accountingInvoiceFormGoBack({}, { locale })}
        </Button>
      </DialogClose>
      <Button
        disabled={
          isCreating ||
          isPreviewing ||
          !open ||
          !previewUrl ||
          reviewTotal === null
        }
        onClick={onCreate}
        tone="danger"
        type="button"
      >
        {isCreating
          ? m.accountingInvoiceFormCreating({}, { locale })
          : m.accountingInvoiceFormCreate({}, { locale })}
      </Button>
    </DialogFooter>
  );
}
