"use client";

import { useFormStatus } from "react-dom";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

export function CheckoutDiscountCodeSubmitButton({
  locale,
}: {
  readonly locale: Locale;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      className="h-12 rounded-full px-7 text-sm uppercase tracking-[0.14em]"
      disabled={pending}
      type="submit"
    >
      {pending
        ? m.checkoutDiscountCodeApplying({}, { locale })
        : m.checkoutDiscountCodeApply({}, { locale })}
    </Button>
  );
}
