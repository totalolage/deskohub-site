"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Option } from "effect";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useFormContext, useWatch } from "react-hook-form";
import {
  administrationHref,
  localizeAdministrationHref,
} from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { AdministrationAlert } from "@/features/administration/notice";
import { discountLabelFor } from "@/features/discounts/discount-label";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { Button } from "@/shared/components/ui/button";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { defaultWorkspaceCurrencyCode } from "@/shared/money/currencies";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateDiscountAdmin } from "./actions";
import {
  DiscountCodeConfigurationFields,
  DiscountDefinitionFields,
} from "./admin-tables";
import type { AdminDiscount } from "./discount-administration.service";
import { toDiscountCodeCreationMutation } from "./discount-code-creation-mutation";
import {
  createDiscountCodeCreationFormSchema,
  type DiscountCodeCreationFormValues,
} from "./form-schemas";

const discountCodeCreationFormDefaults = (
  discounts: readonly Pick<AdminDiscount, "id" | "labels">[]
): DiscountCodeCreationFormValues => ({
  discountKind: discounts.length > 0 ? "existing" : "new",
  discountId: discounts[0]?.id ?? "",
  labelEn: "",
  labelCs: "",
  adjustmentKind: "percentage",
  percentage: "10",
  fixedAmountValue: "10000",
  fixedAmountCurrency: defaultWorkspaceCurrencyCode,
  products: [],
  code: "",
  enabled: true,
  validFrom: "",
  validUntil: "",
  maxUses: "",
  maxUsesPerCustomer: "",
  serviceDateFrom: "",
  serviceDateUntil: "",
});

export function DiscountCodeCreationForm({
  completion,
  customerId,
  customerName,
  discounts,
}: {
  readonly completion?: "back" | "customer";
  readonly customerId?: DotyposCustomerId;
  readonly customerName?: string;
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
}) {
  const router = useRouter();
  const locale = useRouteLocale();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const customerPath = customerId
    ? administrationHref("/[locale]/admin/customers/[customerId]", {
        customerId,
      })
    : null;
  const close = () => {
    if (completion === "back") router.back();
    else if (customerPath)
      router.replace(localizeAdministrationHref(customerPath, locale));
  };
  const form = useForm<DiscountCodeCreationFormValues>({
    defaultValues: discountCodeCreationFormDefaults(discounts),
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(
      createDiscountCodeCreationFormSchema(locale)
    ),
  });
  const checkFormMessage = () =>
    m.discountsCodeCreateFailedCheckForm({}, { locale });
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    onSuccess: ({ data }) => {
      if (!data) return;
      if (!customerPath) {
        setSuccess(data.notice);
        router.refresh();
        return;
      }
      close();
    },
    onError: ({ error: actionError }) =>
      setError(actionError.serverError ?? checkFormMessage()),
    onTransportError: () =>
      setError(m.discountsCodeCreateFailedRetry({}, { locale })),
  });

  if (success) {
    return (
      <DiscountCodeCreatedNotice
        notice={success}
        onCreateAnother={() => {
          setSuccess(null);
          form.reset();
        }}
      />
    );
  }

  const submit = (values: DiscountCodeCreationFormValues) => {
    setError(null);
    Option.match(toDiscountCodeCreationMutation(values, customerId), {
      onNone: () => setError(checkFormMessage()),
      onSome: execute,
    });
  };

  return (
    <Form {...form}>
      <form
        aria-label={m.discountsCodeCreateSubmit({}, { locale })}
        noValidate
        onSubmit={form.handleSubmit(submit)}
      >
        {customerName && (
          <div className="rounded-xl bg-aquamarine-green/12 px-4 py-3 text-sm text-aquamarine-ink">
            {m.discountsCodeCustomerRestriction({ customerName }, { locale })}
          </div>
        )}

        <DiscountChoice
          className={customerName ? "mt-6" : undefined}
          discounts={discounts}
        />
        <ChosenDiscountFields discounts={discounts} />

        <div className="my-7 border-t border-navy-blue/10" />
        <div>
          <h2 className="text-lg">
            {m.discountsCodeDetailsTitle({}, { locale })}
          </h2>
          <p className="mb-4 mt-1 text-sm text-navy-blue/65">
            {m.discountsCodeDetailsDescription({}, { locale })}
          </p>
          <DiscountCodeConfigurationFields />
        </div>

        {error && (
          <AdministrationAlert
            className="mt-5 font-semibold"
            role="alert"
            status="error"
          >
            {error}
          </AdministrationAlert>
        )}

        <DiscountCodeCreationActions
          isExecuting={isExecuting}
          onCancel={close}
          showCancel={Boolean(customerId)}
        />
      </form>
    </Form>
  );
}

function DiscountCodeCreatedNotice({
  notice,
  onCreateAnother,
}: {
  readonly notice: string;
  readonly onCreateAnother: () => void;
}) {
  const locale = useRouteLocale();
  return (
    <output
      aria-live="polite"
      className="rounded-xl bg-aquamarine-green/12 px-4 py-4 text-aquamarine-ink"
    >
      <p className="font-semibold">{notice}</p>
      <Button
        className="mt-4"
        onClick={onCreateAnother}
        type="button"
        variant="secondary"
      >
        {m.discountsCodeCreateAnother({}, { locale })}
      </Button>
    </output>
  );
}

function DiscountChoice({
  className,
  discounts,
}: {
  readonly className: string | undefined;
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
}) {
  const locale = useRouteLocale();
  const { register } = useFormContext<DiscountCodeCreationFormValues>();
  return (
    <fieldset className={className}>
      <legend className="text-sm font-semibold">
        {m.discountsDiscountLabel({}, { locale })}
      </legend>
      <p className="mt-1 text-sm text-navy-blue/65">
        {m.discountsCodeDiscountChoiceDescription({}, { locale })}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ChoiceCard tone="plain">
          <input
            aria-label={m.discountsCodeDiscountExisting({}, { locale })}
            className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
            disabled={discounts.length === 0}
            type="radio"
            value="existing"
            {...register("discountKind")}
          />
          <span className="text-sm">
            <span className="block font-semibold">
              {m.discountsCodeDiscountExisting({}, { locale })}
            </span>
            <span className="mt-1 block text-xs leading-5 text-navy-blue/65">
              {m.discountsCodeDiscountExistingDescription({}, { locale })}
            </span>
          </span>
        </ChoiceCard>
        <ChoiceCard tone="plain">
          <input
            aria-label={m.discountsCodeDiscountNew({}, { locale })}
            className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
            type="radio"
            value="new"
            {...register("discountKind")}
          />
          <span className="text-sm">
            <span className="block font-semibold">
              {m.discountsCodeDiscountNew({}, { locale })}
            </span>
            <span className="mt-1 block text-xs leading-5 text-navy-blue/65">
              {m.discountsCodeDiscountNewDescription({}, { locale })}
            </span>
          </span>
        </ChoiceCard>
      </div>
    </fieldset>
  );
}

function ChosenDiscountFields({
  discounts,
}: {
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
}) {
  const locale = useRouteLocale();
  const { control } = useFormContext<DiscountCodeCreationFormValues>();
  const discountKind =
    useWatch({ control, name: "discountKind" }) ?? "existing";
  return (
    <div className="mt-6">
      {discountKind === "existing" && (
        <FormField
          control={control}
          name="discountId"
          render={({ field }) => (
            <FormItem className="grid gap-2">
              <FormLabel>{m.discountsDiscountLabel({}, { locale })}</FormLabel>
              <FormControl>
                <select
                  {...field}
                  className="flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20"
                  required
                >
                  {discounts.map((discount) => (
                    <option key={discount.id} value={discount.id}>
                      {discountLabelFor(discount.labels, locale)}
                    </option>
                  ))}
                </select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {discountKind === "new" && <DiscountDefinitionFields />}
    </div>
  );
}

function DiscountCodeCreationActions({
  isExecuting,
  onCancel,
  showCancel,
}: {
  readonly isExecuting: boolean;
  readonly onCancel: () => void;
  readonly showCancel: boolean;
}) {
  const locale = useRouteLocale();
  return (
    <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-navy-blue/10 pt-5">
      {showCancel && (
        <Button onClick={onCancel} type="button" variant="secondary">
          {m.discountsCancel({}, { locale })}
        </Button>
      )}
      <Button disabled={isExecuting} type="submit">
        <Plus aria-hidden className="size-4" />
        {isExecuting
          ? m.discountsCreating({}, { locale })
          : m.discountsCodeCreateSubmit({}, { locale })}
      </Button>
    </div>
  );
}

export function CustomerDiscountCodeCreationForm({
  completion,
  customerId,
  customerName,
  discounts,
}: {
  readonly completion: "back" | "customer";
  readonly customerId: DotyposCustomerId;
  readonly customerName: string;
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
}) {
  return (
    <DiscountCodeCreationForm
      completion={completion}
      customerId={customerId}
      customerName={customerName}
      discounts={discounts}
    />
  );
}
