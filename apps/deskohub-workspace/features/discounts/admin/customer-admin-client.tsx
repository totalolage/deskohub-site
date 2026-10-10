"use client";

import {
  DotyposCustomerIdSchema,
  type DotyposDiscountGroupId,
  DotyposDiscountGroupIdSchema,
} from "@deskohub/dotypos";
import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Schema } from "effect";
import { Minus, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { type DefaultValues, type FieldValues, useForm } from "react-hook-form";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { AdministrationAlert } from "@/features/administration/notice";
import type {
  DiscountCodeId,
  VoucherId,
} from "@/features/discounts/persistence-contracts";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateDiscountAdmin, searchDiscountAdminCustomers } from "./actions";
import type { DiscountAdminMutation } from "./contracts";
import type {
  AdminCustomerSearchResult,
  AdminDiscountGroup,
} from "./discount-administration.service";
import {
  customerCodeAudienceFormSchema,
  customerDiscountGroupFormSchema,
} from "./form-schemas";

const selectClassName =
  "flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20";

const decodeDotyposDiscountGroupId = Schema.decodeUnknownSync(
  DotyposDiscountGroupIdSchema
);
const decodeDotyposCustomerId = Schema.decodeUnknownSync(
  DotyposCustomerIdSchema
);

const searchFormSchema = Schema.Struct({
  query: Schema.String.check(
    Schema.makeFilter((value) => value.trim().length >= 2, {
      message: "Enter at least 2 characters.",
    })
  ),
});

export function CustomerSearch({
  variant = "card",
}: {
  readonly variant?: "card" | "toolbar";
}) {
  const [result, setResult] = useState<AdminCustomerSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ query: string }>({
    defaultValues: { query: "" },
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(searchFormSchema),
  });
  const { execute, isExecuting } = useWorkspaceAction(
    searchDiscountAdminCustomers,
    {
      actionName: "searchDiscountAdminCustomers",
      onSuccess: ({ data }) => {
        if (!data) return;
        setError(null);
        setResult(data);
      },
      onError: ({ error: actionError }) => {
        setResult(null);
        setError(
          actionError.serverError ??
            "The customer search could not be completed."
        );
      },
      onTransportError: () => {
        setResult(null);
        setError("The customer search could not be completed.");
      },
    }
  );

  return (
    <div className="space-y-4">
      <Form {...form}>
        <form
          className={
            {
              card: "grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
              toolbar:
                "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
            }[variant]
          }
          noValidate
          onSubmit={form.handleSubmit((values) => {
            setError(null);
            setResult(null);
            const query = values.query.trim();
            if (!query) return;
            execute({ query });
          })}
        >
          <FormField
            control={form.control}
            name="query"
            render={({ field, fieldState }) => (
              <FormItem className="grid gap-1.5">
                <FormLabel>Customer name or email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    minLength={2}
                    placeholder="Search by name or email"
                    required
                    type="search"
                    variant={fieldState.error ? "error" : "default"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button disabled={isExecuting} type="submit">
            <Search aria-hidden className="size-4" />
            {isExecuting ? "Searching…" : "Find customer"}
          </Button>
        </form>
      </Form>

      {error && (
        <AdministrationAlert
          className="font-semibold"
          role="alert"
          status="error"
        >
          {error}
        </AdministrationAlert>
      )}
      {result && (
        <div
          aria-live="polite"
          className="rounded-xl border border-navy-blue/10 bg-white"
        >
          {result.customers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-navy-blue/65">
              No customer matched.
            </p>
          ) : (
            <>
              {result.kind === "ambiguous" && (
                <p className="border-b border-navy-blue/10 px-5 py-3 text-sm text-navy-blue/70">
                  Multiple matches. Choose the correct customer.
                </p>
              )}
              <ul className="divide-y divide-navy-blue/10">
                {result.customers.map((customer) => (
                  <li
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                    key={customer.id}
                  >
                    <div>
                      <p className="font-semibold">{customer.displayName}</p>
                      <p className="mt-1 text-sm text-navy-blue/65">
                        {[customer.email, customer.phone]
                          .filter(Boolean)
                          .join(" · ") || "No contact details"}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/admin/customers/${customer.id}`}>
                        Open customer
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function AddCodeCustomerForm({
  codeId,
}: {
  readonly codeId: DiscountCodeId;
}) {
  return (
    <AdminMutationForm
      buildMutation={(values) => ({
        kind: "add-code-customer",
        codeId,
        customerId: decodeDotyposCustomerId(values.customerId.trim()),
      })}
      defaultValues={{ customerId: "" }}
      schema={customerCodeAudienceFormSchema}
      submitLabel="Add customer"
    >
      {({ control }) => (
        <FormField
          control={control}
          name="customerId"
          render={({ field, fieldState }) => (
            <FormItem className="grid gap-1.5">
              <FormLabel htmlFor={`audience-customer-${codeId}`}>
                Dotypos customer ID
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  id={`audience-customer-${codeId}`}
                  required
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </AdminMutationForm>
  );
}

export function AddVoucherCustomerForm({
  voucherId,
}: {
  readonly voucherId: VoucherId;
}) {
  return (
    <AdminMutationForm
      buildMutation={(values) => ({
        kind: "add-voucher-customer",
        voucherId,
        customerId: decodeDotyposCustomerId(values.customerId.trim()),
      })}
      defaultValues={{ customerId: "" }}
      schema={customerCodeAudienceFormSchema}
      submitLabel="Add customer"
    >
      {({ control }) => (
        <FormField
          control={control}
          name="customerId"
          render={({ field, fieldState }) => (
            <FormItem className="grid gap-1.5">
              <FormLabel htmlFor={`voucher-audience-customer-${voucherId}`}>
                Dotypos customer ID
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  autoComplete="off"
                  id={`voucher-audience-customer-${voucherId}`}
                  required
                  variant={fieldState.error ? "error" : "default"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </AdminMutationForm>
  );
}

export function CustomerDiscountGroupForm({
  customerId,
  currentGroupId,
  discountGroups,
}: {
  readonly customerId: DotyposCustomerId;
  readonly currentGroupId: DotyposDiscountGroupId | null;
  readonly discountGroups: readonly AdminDiscountGroup[];
}) {
  const currentIsAvailable =
    currentGroupId === null ||
    discountGroups.some(({ id }) => id === currentGroupId);

  return (
    <AdminMutationForm
      buildMutation={(values) => ({
        kind: "set-customer-discount-group",
        customerId,
        discountGroupId:
          values.discountGroupId === ""
            ? null
            : decodeDotyposDiscountGroupId(values.discountGroupId),
      })}
      defaultValues={{ discountGroupId: currentGroupId ?? "" }}
      resetOnSuccessTo="submitted"
      schema={customerDiscountGroupFormSchema}
      submitLabel="Save group"
    >
      {({ register }) => (
        <div className="grid gap-1.5">
          <Label htmlFor={`discount-group-${customerId}`}>Discount group</Label>
          <select
            className={selectClassName}
            id={`discount-group-${customerId}`}
            {...register("discountGroupId")}
          >
            <option value="">No discount group</option>
            {!currentIsAvailable && currentGroupId && (
              <option value={currentGroupId}>
                Unavailable group ({currentGroupId})
              </option>
            )}
            {discountGroups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name} ({group.basisPoints / 100}%)
              </option>
            ))}
          </select>
        </div>
      )}
    </AdminMutationForm>
  );
}

export function AdminMutationButton({
  children,
  confirmation,
  mutation,
  variant = "secondary",
}: {
  readonly children: ReactNode;
  readonly confirmation?: string;
  readonly mutation: DiscountAdminMutation;
  readonly variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName: mutation.kind,
    onSuccess: () => router.refresh(),
    onError: ({ error: actionError }) =>
      setError(actionError.serverError ?? "The change could not be saved."),
    onTransportError: () =>
      setError("The change could not be saved. Try again."),
  });

  return (
    <>
      <Button
        disabled={isExecuting}
        onClick={() => {
          setError(null);
          if (!confirmation || globalThis.confirm(confirmation)) {
            execute(mutation);
          }
        }}
        size="sm"
        type="button"
        variant={variant}
      >
        {isExecuting ? "Saving…" : children}
      </Button>
      {error && (
        <AdministrationAlert className="mt-3" role="alert" status="error">
          {error}
        </AdministrationAlert>
      )}
    </>
  );
}

export function CustomerCodeAction({
  audienceSize,
  code,
  codeId,
  customerId,
  customerName,
  eligible,
}: {
  readonly audienceSize: number;
  readonly code: string;
  readonly codeId: DiscountCodeId;
  readonly customerId: DotyposCustomerId;
  readonly customerName: string;
  readonly eligible: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName: "manageCustomerCodeEligibility",
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
    onError: ({ error: actionError }) =>
      setError(actionError.serverError ?? "The change could not be saved."),
    onTransportError: () =>
      setError("The change could not be saved. Try again."),
  });

  const label = eligible
    ? `Remove ${customerName} from ${code}`
    : `Add ${customerName} to ${code}`;
  const Icon = eligible ? Minus : Plus;
  const isOnlyCustomer = eligible && audienceSize === 1;
  let dialogTitle = `Limit ${code} to ${customerName}?`;
  let dialogDescription = `${code} is currently available to every customer. Limiting it will make ${customerName} the only eligible customer.`;
  if (isOnlyCustomer) {
    dialogTitle = "Remove the only eligible customer?";
    dialogDescription = `Removing ${customerName} would leave ${code} without an audience, which makes it available to every customer. Choose whether to delete the code or make it available to all.`;
  } else if (eligible) {
    dialogTitle = `Remove ${customerName}?`;
    dialogDescription = `${customerName} will no longer be able to use ${code}.`;
  } else if (audienceSize > 0) {
    dialogTitle = `Add ${customerName} to ${code}?`;
    dialogDescription = `${code} is currently limited to ${audienceSize} other customers. Adding ${customerName} will make it available to ${audienceSize + 1} customers.`;
  }

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setError(null);
        setOpen(nextOpen);
      }}
      open={open}
    >
      <DialogTrigger asChild>
        <Button
          aria-label={label}
          className="relative z-10 size-8"
          size="icon"
          title={label}
          variant="ghost"
        >
          <Icon aria-hidden className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>
        {error && (
          <p
            className="mt-4 text-sm font-semibold text-burned-orange-ink"
            role="alert"
          >
            {error}
          </p>
        )}
        <DialogFooter>
          {isOnlyCustomer && (
            <>
              <Button
                disabled={isExecuting}
                onClick={() => execute({ kind: "delete-code", id: codeId })}
                type="button"
                variant="secondary"
              >
                Delete code
              </Button>
              <Button
                className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
                disabled={isExecuting}
                onClick={() =>
                  execute({ kind: "make-code-unrestricted", codeId })
                }
                type="button"
              >
                Make available to all
              </Button>
            </>
          )}
          {!isOnlyCustomer && eligible && (
            <>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
                disabled={isExecuting}
                onClick={() =>
                  execute({
                    kind: "remove-code-customer",
                    codeId,
                    customerId,
                  })
                }
                type="button"
              >
                Remove customer
              </Button>
            </>
          )}
          {!eligible && (
            <>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  {audienceSize > 0 ? "Cancel" : "Keep available to all"}
                </Button>
              </DialogClose>
              <Button
                className="bg-burned-orange-ink hover:bg-burned-orange-ink/90"
                disabled={isExecuting}
                onClick={() =>
                  execute({
                    kind: "add-code-customer",
                    codeId,
                    customerId,
                  })
                }
                type="button"
              >
                {audienceSize > 0 ? "Add customer" : "Limit to only this user"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminMutationForm<Input extends FieldValues, Values = Input>({
  buildMutation,
  children,
  defaultValues,
  resetOnSuccessTo = "initial",
  schema,
  submitLabel,
}: {
  readonly buildMutation: (values: Values) => DiscountAdminMutation;
  readonly children: (api: {
    readonly control: ReturnType<
      typeof useForm<Input, unknown, Values>
    >["control"];
    readonly register: ReturnType<
      typeof useForm<Input, unknown, Values>
    >["register"];
  }) => ReactNode;
  readonly defaultValues: DefaultValues<Input>;
  /**
   * Edit forms rebase onto the submitted values so a follow-up edit submits
   * the saved state plus the new change; audience-add forms clear.
   */
  readonly resetOnSuccessTo?: "initial" | "submitted";
  readonly schema: Schema.Codec<Values, Input>;
  readonly submitLabel: string;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{
    readonly kind: "error" | "success";
    readonly message: string;
  } | null>(null);
  const form = useForm<Input, unknown, Values>({
    defaultValues,
    mode: "onSubmit",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(schema),
  });
  // Snapshot taken at submit entry so the success reset cannot absorb values
  // edited while the request is in flight.
  const [submittedValues, setSubmittedValues] = useState<Input | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName: submitLabel,
    onSuccess: ({ data }) => {
      if (!data) return;
      setFeedback({ kind: "success", message: data.notice });
      // Rebase the defaults onto the submitted snapshot while retaining every
      // current value, so dirty state recomputes against the snapshot and an
      // in-flight edit that reverted a field to its original value survives.
      form.reset(
        resetOnSuccessTo === "submitted"
          ? (submittedValues ?? undefined)
          : undefined,
        resetOnSuccessTo === "submitted" ? { keepValues: true } : undefined
      );
      router.refresh();
    },
    onError: ({ error }) =>
      setFeedback({
        kind: "error",
        message: error.serverError ?? "The change could not be saved.",
      }),
    onTransportError: () =>
      setFeedback({
        kind: "error",
        message: "The change could not be saved. Try again.",
      }),
  });

  return (
    <Form {...form}>
      <form
        className="grid gap-3"
        noValidate
        onSubmit={form.handleSubmit((values) => {
          setFeedback(null);
          setSubmittedValues(form.getValues());
          execute(buildMutation(values));
        })}
      >
        {children({ control: form.control, register: form.register })}
        {feedback && (
          <p
            className={
              feedback.kind === "error"
                ? "text-sm font-semibold text-burned-orange-ink"
                : "text-sm font-semibold text-aquamarine-ink"
            }
            role={feedback.kind === "error" ? "alert" : "status"}
          >
            {feedback.message}
          </p>
        )}
        <Button
          className="justify-self-start"
          disabled={isExecuting}
          type="submit"
        >
          {isExecuting ? "Saving…" : submitLabel}
        </Button>
      </form>
    </Form>
  );
}
