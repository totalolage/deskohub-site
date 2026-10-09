"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { AlertTriangle } from "lucide-react";
import { type FormEvent, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { applyDiscountCodeForm } from "@/features/checkout/actions/apply-discount-code";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import type { DiscountAdjustment } from "@/features/discounts/contracts";
import { type Locale, m } from "@/features/i18n";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { CheckoutDiscountCodeSubmitButton } from "./checkout-discount-code-submit-button";
import { DiscountRejectionAnalytics } from "./discount-rejection-analytics";

const checkoutDiscountCodeFormSchema = Schema.Struct({
  submittedCode: Schema.String,
});

type CheckoutDiscountCodeFormValues =
  typeof checkoutDiscountCodeFormSchema.Type;

type CheckoutDiscountCodeFormProps = {
  readonly appliedAdjustment?: DiscountAdjustment;
  readonly defaultCode?: string;
  readonly enabled: boolean;
  readonly fieldError: boolean;
  readonly locale: Locale;
  readonly payStateToken: string;
  readonly rejectionId?: string;
};

export function CheckoutDiscountCodeForm({
  appliedAdjustment,
  defaultCode,
  enabled,
  fieldError,
  locale,
  payStateToken,
  rejectionId,
}: CheckoutDiscountCodeFormProps) {
  const form = useForm<CheckoutDiscountCodeFormValues>({
    defaultValues: { submittedCode: defaultCode ?? "" },
    mode: "onSubmit",
    resolver: effectSchemaResolver(checkoutDiscountCodeFormSchema),
  });
  const { isSubmitting } = form.formState;
  const previousDefaultCode = useRef(defaultCode);

  useEffect(() => {
    if (previousDefaultCode.current === defaultCode) return;
    previousDefaultCode.current = defaultCode;
    form.reset({ submittedCode: defaultCode ?? "" });
  }, [defaultCode, form]);

  if (appliedAdjustment) {
    return (
      <output className="block rounded-2xl border border-aquamarine-green/40 bg-aquamarine-green/12 px-4 py-3 text-sm font-semibold text-aquamarine-ink ring-1 ring-aquamarine-green/10">
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
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget);
    void form.handleSubmit(async () => action(formData))(event);
  };

  return (
    <form
      action={action}
      className="space-y-3"
      id="checkout-discount-code-form"
      noValidate
      onSubmit={submit}
    >
      <Label htmlFor="checkout-discount-code">
        {m.checkoutDiscountCodeLabel({}, { locale })}
      </Label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          {...form.register("submittedCode")}
          defaultValue={defaultCode ?? ""}
          id="checkout-discount-code"
          aria-describedby={errorId}
          aria-invalid={fieldError ? true : undefined}
          autoCapitalize="characters"
          autoComplete="off"
          className="h-12 rounded-full px-5 uppercase"
          data-ph-mask
          placeholder={m.checkoutDiscountCodePlaceholder({}, { locale })}
          spellCheck={false}
        />
        <CheckoutDiscountCodeSubmitButton
          locale={locale}
          pending={isSubmitting}
        />
      </div>
      {fieldError && (
        <>
          <DiscountRejectionAnalytics key={rejectionId} />
          <p
            className="flex items-start gap-2 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-burned-orange-ink"
            id="checkout-discount-code-error"
            role="alert"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-burned-orange"
            />
            <span className="min-w-0">
              {m.checkoutDiscountCodeUnavailable({}, { locale })}
            </span>
          </p>
        </>
      )}
    </form>
  );
}
