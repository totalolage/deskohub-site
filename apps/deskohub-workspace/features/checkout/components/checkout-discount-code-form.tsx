"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { applyDiscountCode } from "@/features/checkout/actions/apply-discount-code";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import { useFeatureFlagEnabled } from "@/features/feature-flags/react";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type CheckoutDiscountCodeFormProps = {
  readonly appliedAdjustment?: DiscountAdjustment;
  readonly checkoutNavigationPending: boolean;
  readonly initialEnabled: boolean;
  readonly locale: Locale;
  readonly payStateToken: string;
};

export function CheckoutDiscountCodeForm({
  appliedAdjustment,
  checkoutNavigationPending,
  initialEnabled,
  locale,
  payStateToken,
}: CheckoutDiscountCodeFormProps) {
  const router = useRouter();
  const enabled = useFeatureFlagEnabled("discount_codes", initialEnabled);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const checkoutNavigationPendingRef = useRef(checkoutNavigationPending);
  useEffect(() => {
    checkoutNavigationPendingRef.current = checkoutNavigationPending;
  }, [checkoutNavigationPending]);
  const { execute, isExecuting } = useWorkspaceAction(applyDiscountCode, {
    actionName: "applyDiscountCode",
    onSuccess: ({ data }) => {
      if (checkoutNavigationPendingRef.current) return;

      if (!data || data.status === "unavailable") {
        setFieldError(m.checkoutDiscountCodeUnavailable({}, { locale }));
        return;
      }

      router.replace(data.freshPayUrl);
    },
    onError: () => {
      setFieldError(m.checkoutDiscountCodeUnavailable({}, { locale }));
    },
    onTransportError: () => {
      setFieldError(m.checkoutDiscountCodeUnavailable({}, { locale }));
    },
  });

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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isExecuting || checkoutNavigationPending) return;

    setFieldError(null);
    const submittedCode = new FormData(event.currentTarget).get(
      "submittedCode"
    );
    execute({
      locale,
      payStateToken,
      submittedCode: typeof submittedCode === "string" ? submittedCode : "",
    });
  };

  return (
    <form className="space-y-3" onSubmit={submit}>
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
          disabled={isExecuting || checkoutNavigationPending}
          name="submittedCode"
          placeholder={m.checkoutDiscountCodePlaceholder({}, { locale })}
          spellCheck={false}
        />
        <Button
          className="h-12 rounded-full px-7 text-sm uppercase tracking-[0.14em]"
          disabled={isExecuting || checkoutNavigationPending}
          type="submit"
        >
          {isExecuting
            ? m.checkoutDiscountCodeApplying({}, { locale })
            : m.checkoutDiscountCodeApply({}, { locale })}
        </Button>
      </div>
      {!!fieldError && (
        <p
          className="text-sm text-destructive"
          id="checkout-discount-code-error"
          role="alert"
        >
          {fieldError}
        </p>
      )}
    </form>
  );
}
