import { applyDiscountCodeForm } from "@/features/checkout/actions/apply-discount-code";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import { type Locale, m } from "@/features/i18n";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { CheckoutDiscountCodeSubmitButton } from "./checkout-discount-code-submit-button";

type CheckoutDiscountCodeFormProps = {
  readonly appliedAdjustment?: DiscountAdjustment;
  readonly enabled: boolean;
  readonly fieldError: boolean;
  readonly locale: Locale;
  readonly payStateToken: string;
};

export function CheckoutDiscountCodeForm({
  appliedAdjustment,
  enabled,
  fieldError,
  locale,
  payStateToken,
}: CheckoutDiscountCodeFormProps) {
  if (appliedAdjustment) {
    return (
      <output className="block rounded-2xl border border-aquamarine-green/40 bg-aquamarine-green/12 px-4 py-3 text-sm font-semibold text-navy-blue ring-1 ring-aquamarine-green/10">
        {m.checkoutDiscountCodeApplied(
          {
            discount: formatDiscountAdjustment(appliedAdjustment, locale),
          },
          { locale }
        )}
      </output>
    );
  }

  if (!enabled) return null;

  const errorId = fieldError ? "checkout-discount-code-error" : undefined;
  const action = applyDiscountCodeForm.bind(null, locale, payStateToken);

  return (
    <form action={action} className="space-y-3">
      <Label htmlFor="checkout-discount-code">
        {m.checkoutDiscountCodeLabel({}, { locale })}
      </Label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="checkout-discount-code"
          aria-describedby={errorId}
          aria-invalid={fieldError ? true : undefined}
          autoCapitalize="characters"
          autoComplete="off"
          className="h-12 rounded-full px-5 uppercase"
          data-ph-mask
          name="submittedCode"
          placeholder={m.checkoutDiscountCodePlaceholder({}, { locale })}
          spellCheck={false}
        />
        <CheckoutDiscountCodeSubmitButton locale={locale} />
      </div>
      {fieldError && (
        <p
          className="text-sm text-destructive"
          id="checkout-discount-code-error"
          role="alert"
        >
          {m.checkoutDiscountCodeUnavailable({}, { locale })}
        </p>
      )}
    </form>
  );
}
