"use client";

import { Minus, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { AdministrationAlert } from "@/features/administration/notice";
import type { DiscountCodeId } from "@/features/discounts/persistence-contracts";
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
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateDiscountAdmin, searchDiscountAdminCustomers } from "./actions";
import type { DiscountAdminMutation } from "./contracts";
import type {
  AdminCustomerSearchResult,
  AdminDiscountGroup,
} from "./discount-administration.service";

const selectClassName =
  "flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20";

export function CustomerSearch({
  variant = "card",
}: {
  readonly variant?: "card" | "toolbar";
}) {
  const queryId = useId();
  const [result, setResult] = useState<AdminCustomerSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      <form
        className={
          {
            card: "grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
            toolbar:
              "grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
          }[variant]
        }
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setResult(null);
          const value = new FormData(event.currentTarget)
            .get("query")
            ?.toString()
            .trim();
          if (!value) return;
          execute({ query: value });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor={queryId}>Customer name or email</Label>
          <Input
            autoComplete="off"
            id={queryId}
            minLength={2}
            name="query"
            placeholder="Search by name or email"
            required
            type="search"
          />
        </div>
        <Button disabled={isExecuting} type="submit">
          <Search aria-hidden className="size-4" />
          {isExecuting ? "Searching…" : "Find customer"}
        </Button>
      </form>

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
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <AdminMutationForm
      buildMutation={(formData) => ({
        kind: "add-code-customer",
        codeId,
        customerId: formData
          .get("customerId")
          ?.toString()
          .trim() as DotyposCustomerId,
      })}
      formRef={formRef}
      submitLabel="Add customer"
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`audience-customer-${codeId}`}>
          Dotypos customer ID
        </Label>
        <Input
          autoComplete="off"
          id={`audience-customer-${codeId}`}
          name="customerId"
          required
        />
      </div>
    </AdminMutationForm>
  );
}

export function CustomerDiscountGroupForm({
  customerId,
  currentGroupId,
  discountGroups,
}: {
  readonly customerId: DotyposCustomerId;
  readonly currentGroupId: string | null;
  readonly discountGroups: readonly AdminDiscountGroup[];
}) {
  const currentIsAvailable =
    currentGroupId === null ||
    discountGroups.some(({ id }) => id === currentGroupId);

  return (
    <AdminMutationForm
      buildMutation={(formData) => ({
        kind: "set-customer-discount-group",
        customerId,
        discountGroupId: formData.get("discountGroupId")?.toString() || null,
      })}
      submitLabel="Save group"
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`discount-group-${customerId}`}>Discount group</Label>
        <select
          className={selectClassName}
          defaultValue={currentGroupId ?? ""}
          id={`discount-group-${customerId}`}
          name="discountGroupId"
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
        <span className="sr-only" role="alert">
          {error}
        </span>
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

function AdminMutationForm({
  buildMutation,
  children,
  formRef,
  submitLabel,
}: {
  readonly buildMutation: (formData: FormData) => DiscountAdminMutation;
  readonly children: ReactNode;
  readonly formRef?: React.RefObject<HTMLFormElement | null>;
  readonly submitLabel: string;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<{
    readonly kind: "error" | "success";
    readonly message: string;
  } | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateDiscountAdmin, {
    actionName: submitLabel,
    onSuccess: ({ data }) => {
      if (!data) return;
      setFeedback({ kind: "success", message: data.notice });
      formRef?.current?.reset();
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
    <form
      className="grid gap-3"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setFeedback(null);
        execute(buildMutation(new FormData(event.currentTarget)));
      }}
      ref={formRef}
    >
      {children}
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
  );
}
