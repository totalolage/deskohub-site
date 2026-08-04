"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import type { DiscountCodeId } from "@/features/discounts/persistence-contracts";
import type { DotyposCustomerId } from "@/features/reservation/dotypos-customer";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateDiscountAdmin, searchDiscountAdminCustomers } from "./actions";
import type {
  DiscountAdminCustomerSearch,
  DiscountAdminMutation,
} from "./contracts";
import type {
  AdminCustomerSearchResult,
  AdminDiscountGroup,
} from "./discount-administration.service";

const selectClassName =
  "flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20";

const customerSearchLabels = {
  id: "Dotypos customer ID",
  email: "Email",
  phone: "Phone",
} as const satisfies Record<DiscountAdminCustomerSearch["kind"], string>;

const getCustomerSearch = (
  kind: DiscountAdminCustomerSearch["kind"],
  value: string
): DiscountAdminCustomerSearch => {
  if (kind === "id") return { kind, customerId: value as DotyposCustomerId };
  if (kind === "email") return { kind, email: value };
  return { kind, phone: value };
};

export function CustomerSearch({
  compact = false,
}: {
  readonly compact?: boolean;
}) {
  const [kind, setKind] = useState<DiscountAdminCustomerSearch["kind"]>("id");
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
        className={cn(
          "grid gap-3 rounded-xl border border-navy-blue/10 bg-white p-5 md:items-end",
          compact
            ? "md:grid-cols-[9rem_minmax(0,1fr)_auto]"
            : "md:grid-cols-[11rem_minmax(0,1fr)_auto]"
        )}
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          setResult(null);
          const value = new FormData(event.currentTarget)
            .get("query")
            ?.toString()
            .trim();
          if (!value) return;
          execute(getCustomerSearch(kind, value));
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="customer-search-kind">Search by</Label>
          <select
            className={selectClassName}
            id="customer-search-kind"
            onChange={(event) => {
              setKind(
                event.currentTarget.value as DiscountAdminCustomerSearch["kind"]
              );
              setResult(null);
            }}
            value={kind}
          >
            <option value="id">Customer ID</option>
            <option value="email">Exact email</option>
            <option value="phone">Exact phone</option>
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="customer-search-query">
            {customerSearchLabels[kind]}
          </Label>
          <Input
            autoComplete="off"
            id="customer-search-query"
            name="query"
            required
            type={kind === "email" ? "email" : "text"}
          />
        </div>
        <Button disabled={isExecuting} type="submit">
          <Search aria-hidden className="size-4" />
          {isExecuting ? "Searching…" : "Search"}
        </Button>
      </form>

      {error && (
        <p
          className="rounded-xl bg-burned-orange/10 px-4 py-3 text-sm font-semibold text-burned-orange-ink"
          role="alert"
        >
          {error}
        </p>
      )}
      {result && (
        <div
          aria-live="polite"
          className="rounded-xl border border-navy-blue/10 bg-white"
        >
          {result.customers.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-navy-blue/65">
              No active Dotypos customer matched.
            </p>
          ) : (
            <>
              {result.kind === "ambiguous" && (
                <p className="border-b border-navy-blue/10 px-5 py-3 text-sm text-navy-blue/70">
                  Multiple exact matches. Choose the correct customer.
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
                      <code className="mt-1 block text-xs text-navy-blue/65">
                        {customer.id}
                      </code>
                    </div>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/admin/customers/${customer.id}`}>
                        Manage
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
