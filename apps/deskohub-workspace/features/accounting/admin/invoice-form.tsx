"use client";

import { BigDecimal, Option } from "effect";
import { CircleAlert, Minus, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useId, useRef, useState } from "react";
import { AdministrationAlert } from "@/features/administration/components";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import {
  createAdministrationInvoice,
  searchAdministrationInvoiceCustomers,
} from "./actions";
import type { InvoiceAdministrationCustomer } from "./invoice-administration.service";

type Line = {
  readonly id: string;
  readonly description: string;
  readonly price: string;
};

const selectClassName =
  "flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20";

const field = (form: FormData, name: string) =>
  form.get(name)?.toString().trim() ?? "";

export function InvoiceCreationForm({
  currencies,
  defaultCurrency,
  defaultDueDate,
  defaultServiceDate,
  suggestedVariableSymbol,
}: {
  readonly currencies: readonly {
    readonly code: string;
    readonly exponent: number;
    readonly name: string;
  }[];
  readonly defaultCurrency: string;
  readonly defaultDueDate: string;
  readonly defaultServiceDate: string;
  readonly suggestedVariableSymbol: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const searchId = useId();
  const [customer, setCustomer] =
    useState<InvoiceAdministrationCustomer | null>(null);
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    "existing"
  );
  const [customerType, setCustomerType] = useState<"person" | "business">(
    "person"
  );
  const [query, setQuery] = useState("");
  const [invoiceId] = useState(() => crypto.randomUUID());
  const [searchResults, setSearchResults] = useState<
    readonly InvoiceAdministrationCustomer[]
  >([]);
  const [lines, setLines] = useState<readonly Line[]>(() => [
    { id: crypto.randomUUID(), description: "", price: "" },
  ]);
  const [review, setReview] = useState<ReturnType<
    typeof readInvoiceForm
  > | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const { execute: search, isExecuting: isSearching } = useWorkspaceAction(
    searchAdministrationInvoiceCustomers,
    {
      actionName: "searchAdministrationInvoiceCustomers",
      onSuccess: ({ data }) => {
        if (!data) return;
        setSearchError(null);
        setSearchResults(data);
        setHasSearched(true);
      },
      onError: ({ error: actionError }) =>
        setSearchError(actionError.serverError ?? "Customer search failed."),
      onTransportError: () => setSearchError("Customer search failed."),
    }
  );
  const { execute: create, isExecuting: isCreating } = useWorkspaceAction(
    createAdministrationInvoice,
    {
      actionName: "createAdministrationInvoice",
      onSuccess: ({ data }) => {
        if (data) router.push(`/admin/invoices/${data.invoiceId}`);
      },
      onError: ({ error: actionError }) =>
        setCreateError(
          actionError.serverError ?? "The invoice could not be created."
        ),
      onTransportError: () =>
        setCreateError("The invoice could not be created."),
    }
  );

  const openReview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreateError(null);
    const form = new FormData(event.currentTarget);
    setReview(
      readInvoiceForm({
        customer,
        customerMode,
        customerType,
        form,
        invoiceId,
        lines,
      })
    );
  };

  const runSearch = () => {
    const normalizedQuery = query.trim();
    if (isSearching || normalizedQuery.length < 2) return;
    setSearchError(null);
    setSearchResults([]);
    setHasSearched(false);
    search({ query: normalizedQuery });
  };

  const reviewTotal = review ? getInvoiceReviewTotal(review.lines) : null;

  return (
    <>
      <form className="space-y-6" onSubmit={openReview} ref={formRef}>
        <section className="rounded-2xl border border-navy-blue/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl">Customer</h2>
              <p className="mt-1 text-sm text-navy-blue/65">
                Select a Dotypos customer or enter a new one. Confirmed details
                are saved to Dotypos.
              </p>
            </div>
            <fieldset className="flex rounded-lg bg-navy-blue/5 p-1">
              <legend className="sr-only">Customer source</legend>
              {(["existing", "new"] as const).map((mode) => (
                <Button
                  aria-pressed={customerMode === mode}
                  key={mode}
                  onClick={() => {
                    setCustomerMode(mode);
                    if (mode === "new") setCustomer(null);
                  }}
                  size="sm"
                  type="button"
                  variant={customerMode === mode ? "primary" : "ghost"}
                >
                  {mode === "existing" ? "Existing" : "New"}
                </Button>
              ))}
            </fieldset>
          </div>

          {customerMode === "existing" && !customer && (
            <div className="mt-5 space-y-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <div className="grid gap-1.5">
                  <Label htmlFor={searchId}>Name or email</Label>
                  <Input
                    autoComplete="off"
                    id={searchId}
                    minLength={2}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSearchError(null);
                      setSearchResults([]);
                      setHasSearched(false);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") return;
                      event.preventDefault();
                      runSearch();
                    }}
                    placeholder="Search Dotypos customers"
                    type="search"
                    value={query}
                  />
                </div>
                <Button
                  disabled={isSearching || query.trim().length < 2}
                  onClick={runSearch}
                  type="button"
                >
                  <Search aria-hidden className="size-4" />
                  {isSearching ? "Searching…" : "Search"}
                </Button>
              </div>
              <div aria-live="polite">
                {searchError && (
                  <AdministrationAlert role="alert" status="error">
                    {searchError}
                  </AdministrationAlert>
                )}
                {hasSearched && searchResults.length === 0 && (
                  <p className="rounded-xl border border-navy-blue/10 px-4 py-6 text-center text-sm text-navy-blue/65">
                    No customer matched.
                  </p>
                )}
                {searchResults.length > 0 && (
                  <ul className="divide-y divide-navy-blue/10 rounded-xl border border-navy-blue/10">
                    {searchResults.map((result) => (
                      <li
                        className="flex items-center justify-between gap-4 p-4"
                        key={result.id}
                      >
                        <div>
                          <p className="font-semibold">{result.displayName}</p>
                          <p className="text-sm text-navy-blue/65">
                            {result.email || "No email"}
                          </p>
                        </div>
                        <Button
                          onClick={() => {
                            setCustomer(result);
                            setCustomerType(result.details.kind);
                            setSearchResults([]);
                            setHasSearched(false);
                          }}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          Select
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {(customerMode === "new" || customer) && (
            <div
              className="mt-5 space-y-5"
              key={customer?.id ?? "new-customer"}
            >
              {customer && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-aquamarine-green/10 px-4 py-3">
                  <span className="font-semibold">{customer.displayName}</span>
                  <Button
                    onClick={() => setCustomer(null)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    Change
                  </Button>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Customer type" name="customerType">
                  <select
                    className={selectClassName}
                    defaultValue={customerType}
                    id="customerType"
                    name="customerType"
                    onChange={(event) =>
                      setCustomerType(
                        event.target.value as "person" | "business"
                      )
                    }
                  >
                    <option value="person">Individual</option>
                    <option value="business">Business</option>
                  </select>
                </FormField>
                <FormField label="Invoice email" name="email">
                  <Input
                    defaultValue={customer?.details.email}
                    id="email"
                    name="email"
                    required
                    type="email"
                  />
                </FormField>
                <FormField
                  label={
                    customerType === "business"
                      ? "Contact first name (optional)"
                      : "First name"
                  }
                  name="firstName"
                >
                  <Input
                    defaultValue={customer?.details.firstName}
                    id="firstName"
                    name="firstName"
                    required={customerType === "person"}
                  />
                </FormField>
                <FormField
                  label={
                    customerType === "business"
                      ? "Contact last name (optional)"
                      : "Last name"
                  }
                  name="lastName"
                >
                  <Input
                    defaultValue={customer?.details.lastName}
                    id="lastName"
                    name="lastName"
                    required={customerType === "person"}
                  />
                </FormField>
                {customerType === "business" && (
                  <>
                    <FormField label="Company name" name="companyName">
                      <Input
                        defaultValue={
                          customer?.details.kind === "business"
                            ? customer.details.companyName
                            : ""
                        }
                        id="companyName"
                        name="companyName"
                        required
                      />
                    </FormField>
                    <FormField label="Company ID" name="companyId">
                      <Input
                        defaultValue={
                          customer?.details.kind === "business"
                            ? customer.details.companyId
                            : ""
                        }
                        id="companyId"
                        name="companyId"
                        required
                      />
                    </FormField>
                    <FormField label="VAT ID (optional)" name="vatId">
                      <Input
                        defaultValue={
                          customer?.details.kind === "business"
                            ? customer.details.vatId
                            : ""
                        }
                        id="vatId"
                        name="vatId"
                      />
                    </FormField>
                  </>
                )}
                <FormField label="Phone (optional)" name="phone">
                  <Input
                    defaultValue={customer?.details.phone}
                    id="phone"
                    name="phone"
                    type="tel"
                  />
                </FormField>
                <FormField label="Address" name="line1">
                  <Input
                    defaultValue={customer?.details.address.line1}
                    id="line1"
                    name="line1"
                    required
                  />
                </FormField>
                <FormField label="Address line 2 (optional)" name="line2">
                  <Input
                    defaultValue={customer?.details.address.line2}
                    id="line2"
                    name="line2"
                  />
                </FormField>
                <FormField label="City" name="city">
                  <Input
                    defaultValue={customer?.details.address.city}
                    id="city"
                    name="city"
                    required
                  />
                </FormField>
                <FormField label="Postal code" name="postalCode">
                  <Input
                    defaultValue={customer?.details.address.postalCode}
                    id="postalCode"
                    name="postalCode"
                    required
                  />
                </FormField>
                <FormField label="Country code" name="country">
                  <Input
                    defaultValue={customer?.details.address.country || "CZ"}
                    id="country"
                    maxLength={2}
                    minLength={2}
                    name="country"
                    required
                  />
                </FormField>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-navy-blue/10 bg-white p-5 sm:p-6">
          <h2 className="text-xl">Invoice</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Service date" name="serviceDate">
              <Input
                defaultValue={defaultServiceDate}
                id="serviceDate"
                name="serviceDate"
                required
                type="date"
              />
            </FormField>
            <FormField label="Due date" name="dueDate">
              <Input
                defaultValue={defaultDueDate}
                id="dueDate"
                name="dueDate"
                required
                type="date"
              />
            </FormField>
            <FormField label="Language" name="locale">
              <select
                className={selectClassName}
                defaultValue="cs-CZ"
                id="locale"
                name="locale"
              >
                <option value="cs-CZ">Czech</option>
                <option value="en-US">English</option>
              </select>
            </FormField>
            <FormField label="Currency" name="currency">
              <select
                className={selectClassName}
                defaultValue={defaultCurrency}
                id="currency"
                name="currency"
              >
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} — {currency.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Variable symbol" name="variableSymbol">
              <Input
                defaultValue={suggestedVariableSymbol}
                id="variableSymbol"
                inputMode="numeric"
                maxLength={10}
                name="variableSymbol"
                onBlur={(event) => {
                  if (!event.currentTarget.value.trim())
                    event.currentTarget.value = suggestedVariableSymbol;
                }}
                onFocus={(event) => {
                  if (event.currentTarget.value === suggestedVariableSymbol)
                    event.currentTarget.select();
                }}
                pattern="[0-9]{1,10}"
                required
              />
            </FormField>
          </div>
        </section>

        <section className="rounded-2xl border border-navy-blue/10 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl">Line items</h2>
              <p className="mt-1 text-sm text-navy-blue/65">
                Enter signed prices using the selected currency.
              </p>
            </div>
            <Button
              onClick={() =>
                setLines((current) => [
                  ...current,
                  { id: crypto.randomUUID(), description: "", price: "" },
                ])
              }
              size="sm"
              type="button"
              variant="secondary"
            >
              <Plus aria-hidden className="size-4" /> Add line
            </Button>
          </div>
          <div className="mt-5 space-y-3">
            {lines.map((line, index) => (
              <div
                className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
                key={line.id}
              >
                <FormField
                  label={`Description ${index + 1}`}
                  name={`description-${line.id}`}
                >
                  <Input
                    id={`description-${line.id}`}
                    name={`description-${line.id}`}
                    required
                  />
                </FormField>
                <FormField label="Price" name={`price-${line.id}`}>
                  <Input
                    id={`price-${line.id}`}
                    inputMode="decimal"
                    name={`price-${line.id}`}
                    placeholder="0.00"
                    required
                  />
                </FormField>
                <Button
                  aria-label={`Remove line ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() =>
                    setLines((current) =>
                      current.filter(({ id }) => id !== line.id)
                    )
                  }
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Minus aria-hidden className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end">
          <Button
            disabled={isCreating || (customerMode === "existing" && !customer)}
            type="submit"
          >
            Review invoice
          </Button>
        </div>
      </form>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isCreating) {
            setCreateError(null);
            setReview(null);
          }
        }}
        open={Boolean(review)}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-2xl flex-col overflow-hidden">
          <DialogHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-red-100 text-red-800">
              <CircleAlert aria-hidden className="size-6" />
            </div>
            <DialogTitle>This action creates and sends the invoice</DialogTitle>
            <DialogDescription className="text-base leading-6">
              The invoice is immutable after creation. Clicking the final button
              immediately emails it to the customer and Deskohub’s internal
              recipient.
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="min-h-0 overflow-y-auto">
              <dl className="grid gap-3 rounded-xl bg-navy-blue/5 p-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-navy-blue/60">Customer</dt>
                  <dd className="font-semibold">
                    {review.customer.details.kind === "business"
                      ? review.customer.details.companyName
                      : `${review.customer.details.firstName} ${review.customer.details.lastName}`}
                  </dd>
                </div>
                <div>
                  <dt className="text-navy-blue/60">Email</dt>
                  <dd className="font-semibold">
                    {review.customer.details.email}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-navy-blue/60">Billing identity</dt>
                  <dd className="font-semibold">
                    {review.customer.details.kind === "business" && (
                      <>
                        {review.customer.details.companyName} · Company ID{" "}
                        {review.customer.details.companyId}
                        {review.customer.details.vatId && (
                          <> · VAT ID {review.customer.details.vatId}</>
                        )}
                        <br />
                      </>
                    )}
                    {review.customer.details.address.line1}
                    {review.customer.details.address.line2 && (
                      <>, {review.customer.details.address.line2}</>
                    )}
                    <br />
                    {review.customer.details.address.postalCode}{" "}
                    {review.customer.details.address.city},{" "}
                    {review.customer.details.address.country}
                  </dd>
                </div>
                <div>
                  <dt className="text-navy-blue/60">Service / due</dt>
                  <dd className="font-semibold">
                    {review.serviceDate} / {review.dueDate}
                  </dd>
                </div>
                <div>
                  <dt className="text-navy-blue/60">Currency / VS</dt>
                  <dd className="font-semibold">
                    {review.currency} / {review.variableSymbol || "automatic"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-navy-blue/60">Line items</dt>
                  <dd className="mt-1 space-y-1 font-semibold">
                    {review.lines.map((line, index) => (
                      <span
                        className="flex justify-between gap-4"
                        key={`${line.description}-${index}`}
                      >
                        <span>{line.description}</span>
                        <span>
                          {line.price} {review.currency}
                        </span>
                      </span>
                    ))}
                    <span className="mt-2 flex justify-between gap-4 border-t border-navy-blue/10 pt-2 text-base">
                      <span>Total</span>
                      <span>
                        {reviewTotal ?? "Invalid price"} {review.currency}
                      </span>
                    </span>
                  </dd>
                </div>
              </dl>
            </div>
          )}
          {review && reviewTotal === null && (
            <AdministrationAlert role="alert" status="error">
              Correct the invalid line price before creating the invoice.
            </AdministrationAlert>
          )}
          {createError && (
            <AdministrationAlert role="alert" status="error">
              {createError}
            </AdministrationAlert>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={isCreating} type="button" variant="secondary">
                Go back
              </Button>
            </DialogClose>
            <Button
              disabled={isCreating || !review || reviewTotal === null}
              onClick={() => {
                if (review) {
                  setCreateError(null);
                  create(review);
                }
              }}
              type="button"
              className="bg-red-700 text-white hover:bg-red-800"
            >
              {isCreating ? "Creating and sending…" : "Create and send invoice"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const getInvoiceReviewTotal = (
  lines: readonly { readonly price: string }[]
) => {
  const amounts: BigDecimal.BigDecimal[] = [];
  for (const line of lines) {
    const amount = BigDecimal.fromString(line.price);
    if (Option.isNone(amount)) return null;
    amounts.push(amount.value);
  }
  return BigDecimal.format(BigDecimal.sumAll(amounts));
};

function FormField({
  children,
  label,
  name,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
  readonly name: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      {children}
    </div>
  );
}

export function readInvoiceForm(input: {
  readonly customer: InvoiceAdministrationCustomer | null;
  readonly customerMode: "existing" | "new";
  readonly customerType: "person" | "business";
  readonly form: FormData;
  readonly invoiceId: string;
  readonly lines: readonly Line[];
}) {
  const address = {
    line1: field(input.form, "line1"),
    ...(field(input.form, "line2") && { line2: field(input.form, "line2") }),
    city: field(input.form, "city"),
    postalCode: field(input.form, "postalCode"),
    country: field(input.form, "country").toUpperCase(),
  };
  const firstName = field(input.form, "firstName");
  const lastName = field(input.form, "lastName");
  const contact = {
    email: field(input.form, "email"),
    ...(field(input.form, "phone") && { phone: field(input.form, "phone") }),
    address,
  };
  const details =
    input.customerType === "business"
      ? {
          ...contact,
          kind: "business" as const,
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          companyName: field(input.form, "companyName"),
          companyId: field(input.form, "companyId"),
          ...(field(input.form, "vatId") && {
            vatId: field(input.form, "vatId"),
          }),
        }
      : { ...contact, kind: "person" as const, firstName, lastName };
  const variableSymbol = field(input.form, "variableSymbol");
  return {
    invoiceId: input.invoiceId,
    customer:
      input.customerMode === "existing" && input.customer
        ? { kind: "existing" as const, customerId: input.customer.id, details }
        : { kind: "new" as const, details },
    locale: field(input.form, "locale") as "cs-CZ" | "en-US",
    serviceDate: field(input.form, "serviceDate"),
    dueDate: field(input.form, "dueDate"),
    currency: field(input.form, "currency"),
    variableSymbol,
    lines: input.lines.map(({ id }) => ({
      description: field(input.form, `description-${id}`),
      price: field(input.form, `price-${id}`),
    })),
  };
}
