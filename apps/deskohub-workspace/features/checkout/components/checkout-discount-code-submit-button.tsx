"use client";

import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

export function CheckoutDiscountCodeSubmitButton({
  locale,
  pending,
}: {
  readonly locale: Locale;
  readonly pending: boolean;
}) {
  return (
    <Button size="lg" caps pending={pending} type="submit">
      {pending
        ? m.checkoutDiscountCodeApplying({}, { locale })
        : m.checkoutDiscountCodeApply({}, { locale })}
    </Button>
  );
}
