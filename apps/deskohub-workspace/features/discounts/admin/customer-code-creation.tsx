"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { StoredDiscountId } from "@/features/discounts/persistence-contracts";
import { Button } from "@/shared/components/ui/button";
import { Label } from "@/shared/components/ui/label";
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
  readDiscountCodeConfigurationForm,
  readDiscountForm,
} from "./form-input";

export function CustomerDiscountCodeCreationForm({
  completion,
  customerId,
  customerName,
  discounts,
}: {
  readonly completion: "back" | "customer";
  readonly customerId: string;
  readonly customerName: string;
  readonly discounts: readonly Pick<AdminDiscount, "id" | "labels">[];
}) {
  const router = useRouter();
  const [discountKind, setDiscountKind] = useState<"existing" | "new">(
    discounts.length > 0 ? "existing" : "new"
  );
  const [error, setError] = useState<string | null>(null);
  const customerPath = `/admin/customers/${customerId}`;
  const close = () => {
    if (completion === "back") router.back();
    else router.replace(customerPath);
  };
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName: "createCustomerDiscountCode",
    onSuccess: ({ data }) => {
      if (!data) return;
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

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    const discount: CreateCustomerDiscountCodeAdminInput["discount"] =
      discountKind === "existing"
        ? {
            kind: "existing",
            discountId: formData
              .get("discountId")
              ?.toString() as StoredDiscountId,
          }
        : { kind: "new", discount: readDiscountForm(formData) };
    execute({
      kind: "create-customer-code",
      customerId,
      code: readDiscountCodeConfigurationForm(formData),
      discount,
    });
  };

  return (
    <form aria-label="Create discount code" onSubmit={submit}>
      <div className="rounded-xl bg-aquamarine-green/12 px-4 py-3 text-sm text-aquamarine-ink">
        The new code will only be available to {customerName}.
      </div>

      <fieldset className="mt-6">
        <legend className="text-sm font-semibold">Discount</legend>
        <p className="mt-1 text-sm text-navy-blue/65">
          Choose what the code should apply.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Label className="flex cursor-pointer gap-3 rounded-xl border border-navy-blue/15 bg-white p-4 has-[:checked]:border-burned-orange has-[:checked]:ring-2 has-[:checked]:ring-burned-orange/15">
            <input
              aria-label="Use an existing discount"
              checked={discountKind === "existing"}
              className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
              disabled={discounts.length === 0}
              name="discountKind"
              onChange={() => setDiscountKind("existing")}
              type="radio"
              value="existing"
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
              checked={discountKind === "new"}
              className="mt-1 size-4 accent-[var(--brand-burned-orange)]"
              name="discountKind"
              onChange={() => setDiscountKind("new")}
              type="radio"
              value="new"
            />
            <span>
              <span className="block font-semibold">Create a new discount</span>
              <span className="mt-1 block text-xs leading-5 text-navy-blue/65">
                Define the adjustment and eligible products here.
              </span>
            </span>
          </Label>
        </div>
      </fieldset>

      <div className="mt-6">
        {discountKind === "existing" ? (
          <Label className="grid gap-2">
            <span>Discount</span>
            <select
              className="flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20"
              name="discountId"
              required
            >
              {discounts.map((discount) => (
                <option key={discount.id} value={discount.id}>
                  {discount.labels["en-US"]}
                </option>
              ))}
            </select>
          </Label>
        ) : (
          <DiscountDefinitionFields />
        )}
      </div>

      <div className="my-7 border-t border-navy-blue/10" />
      <div>
        <h2 className="text-lg">Code details</h2>
        <p className="mb-4 mt-1 text-sm text-navy-blue/65">
          Set the code, availability window, and optional usage limit.
        </p>
        <DiscountCodeConfigurationFields />
      </div>

      {error && (
        <p
          className="mt-5 rounded-xl bg-burned-orange/10 px-4 py-3 text-sm font-semibold text-burned-orange-ink"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-navy-blue/10 pt-5">
        <Button onClick={close} type="button" variant="secondary">
          Cancel
        </Button>
        <Button disabled={isExecuting} type="submit">
          <Plus aria-hidden className="size-4" />
          {isExecuting ? "Creating…" : "Create discount code"}
        </Button>
      </div>
    </form>
  );
}
