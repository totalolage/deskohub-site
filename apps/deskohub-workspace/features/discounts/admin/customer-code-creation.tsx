"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { AdministrationAlert } from "@/features/administration/notice";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { Button } from "@/shared/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Label } from "@/shared/components/ui/label";
import { defaultWorkspaceCurrency } from "@/shared/money/currencies";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateDiscountAdmin } from "./actions";
import {
  DiscountCodeConfigurationFields,
  DiscountDefinitionFields,
} from "./admin-tables";
import type { CreateCustomerDiscountCodeAdminInput } from "./contracts";
import type { AdminDiscount } from "./discount-administration.service";
import { getDiscountAdminValidationMessage } from "./form-feedback";
import {
  toCreateDiscountInput,
  toDiscountCodeConfigurationInput,
} from "./form-input";
import {
  type DiscountCodeCreationFormValues,
  discountCodeCreationFormSchema,
} from "./form-schemas";

const decodeStoredDiscountId = Schema.decodeUnknownSync(storedDiscountIdSchema);

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
  fixedAmountCurrency: defaultWorkspaceCurrency.code,
  products: [],
  code: "",
  enabled: true,
  validFrom: "",
  validUntil: "",
  maxUses: "",
  maxUsesPerCustomer: "",
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
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const customerPath = customerId ? `/admin/customers/${customerId}` : null;
  const close = () => {
    if (completion === "back") router.back();
    else if (customerPath) router.replace(customerPath);
  };
  const form = useForm<DiscountCodeCreationFormValues>({
    defaultValues: discountCodeCreationFormDefaults(discounts),
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(discountCodeCreationFormSchema),
  });
  const discountKind =
    useWatch({ control: form.control, name: "discountKind" }) ?? "existing";
  const { register } = form;
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName: "createCustomerDiscountCode",
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
      setError(
        actionError.serverError ??
          getDiscountAdminValidationMessage(actionError.validationErrors) ??
          "The discount code could not be created. Check the form and try again."
      ),
    onTransportError: () =>
      setError("The discount code could not be created. Try again."),
  });

  if (success) {
    return (
      <output
        aria-live="polite"
        className="rounded-xl bg-aquamarine-green/12 px-4 py-4 text-aquamarine-ink"
      >
        <p className="font-semibold">{success}</p>
        <Button
          className="mt-4"
          onClick={() => {
            setSuccess(null);
            form.reset();
          }}
          type="button"
          variant="secondary"
        >
          Create another code
        </Button>
      </output>
    );
  }

  const submit = (values: DiscountCodeCreationFormValues) => {
    setError(null);
    const discount: CreateCustomerDiscountCodeAdminInput["discount"] =
      values.discountKind === "existing"
        ? {
            kind: "existing" as const,
            discountId: decodeStoredDiscountId(values.discountId),
          }
        : {
            kind: "new" as const,
            discount: toCreateDiscountInput(values),
          };
    const code = toDiscountCodeConfigurationInput(values);
    if (customerId) {
      execute({
        kind: "create-customer-code",
        customerId,
        code,
        discount,
      });
    } else {
      execute({
        kind: "create-code",
        code,
        discount,
      });
    }
  };

  return (
    <Form {...form}>
      <form
        aria-label="Create discount code"
        noValidate
        onSubmit={form.handleSubmit(submit)}
      >
        {customerName && (
          <div className="rounded-xl bg-aquamarine-green/12 px-4 py-3 text-sm text-aquamarine-ink">
            The new code will only be available to {customerName}.
          </div>
        )}

        <fieldset className={customerName ? "mt-6" : undefined}>
          <legend className="text-sm font-semibold">Discount</legend>
          <p className="mt-1 text-sm text-navy-blue/65">
            Choose what the code should apply.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Label className="flex cursor-pointer gap-3 rounded-xl border border-navy-blue/15 bg-white p-4 has-[:checked]:border-burned-orange has-[:checked]:ring-2 has-[:checked]:ring-burned-orange/15">
              <input
                aria-label="Use an existing discount"
                className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
                disabled={discounts.length === 0}
                type="radio"
                value="existing"
                {...register("discountKind")}
              />
              <span>
                <span className="block font-semibold">
                  Use an existing discount
                </span>
                <span className="mt-1 block text-xs leading-5 text-navy-blue/65">
                  Pair the code with a discount that is already configured.
                </span>
              </span>
            </Label>
            <Label className="flex cursor-pointer gap-3 rounded-xl border border-navy-blue/15 bg-white p-4 has-[:checked]:border-burned-orange has-[:checked]:ring-2 has-[:checked]:ring-burned-orange/15">
              <input
                aria-label="Create a new discount"
                className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
                type="radio"
                value="new"
                {...register("discountKind")}
              />
              <span>
                <span className="block font-semibold">
                  Create a new discount
                </span>
                <span className="mt-1 block text-xs leading-5 text-navy-blue/65">
                  Define the adjustment and eligible products here.
                </span>
              </span>
            </Label>
          </div>
        </fieldset>

        <div className="mt-6">
          {discountKind === "existing" && (
            <FormField
              control={form.control}
              name="discountId"
              render={({ field }) => (
                <FormItem className="grid gap-2">
                  <FormLabel>Discount</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20"
                      required
                    >
                      {discounts.map((discount) => (
                        <option key={discount.id} value={discount.id}>
                          {discount.labels["en-US"]}
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

        <div className="my-7 border-t border-navy-blue/10" />
        <div>
          <h2 className="text-lg">Code details</h2>
          <p className="mb-4 mt-1 text-sm text-navy-blue/65">
            Set the code and its availability window.
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

        <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-navy-blue/10 pt-5">
          {customerId && (
            <Button onClick={close} type="button" variant="secondary">
              Cancel
            </Button>
          )}
          <Button disabled={isExecuting} type="submit">
            <Plus aria-hidden className="size-4" />
            {isExecuting ? "Creating…" : "Create discount code"}
          </Button>
        </div>
      </form>
    </Form>
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
