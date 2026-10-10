"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { BigDecimal, Option, Schema } from "effect";
import { CircleAlert, Minus, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import type * as React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import type { InvoiceAdministrationCustomer } from "@/features/accounting/admin/invoice-administration.service";
import { AdministrationAlert } from "@/features/administration/components";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  createAdministrationInvoice,
  previewAdministrationInvoice,
  searchAdministrationInvoiceCustomers,
} from "./actions";

const selectClassName =
  "flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20";

const requiredMessage = "This field is required.";

const maxLengthMessage = (maximumLength: number) =>
  `Use at most ${maximumLength} characters.`;

const invoiceFormRequiredText = (maximumLength: number) =>
  Schema.Trim.check(
    Schema.isNonEmpty({ message: requiredMessage }),
    Schema.isMaxLength(maximumLength, {
      message: maxLengthMessage(maximumLength),
    })
  );

const invoiceFormOptionalText = (maximumLength: number) =>
  Schema.Trim.check(
    Schema.isMaxLength(maximumLength, {
      message: maxLengthMessage(maximumLength),
    })
  );

const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
};

const calendarDateMessage = "Enter a valid calendar date.";

const invoiceFormCalendarDate = Schema.Trim.check(
  Schema.isNonEmpty({ message: requiredMessage }),
  Schema.makeFilter(isCalendarDate, { message: calendarDateMessage })
);

const invoiceFormEmail = Schema.Trim.check(
  Schema.isNonEmpty({ message: requiredMessage }),
  Schema.isMaxLength(255, { message: maxLengthMessage(255) }),
  Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
    message: "Enter a valid invoice email.",
  })
);

const invoiceFormPrice = Schema.Trim.check(
  Schema.isNonEmpty({ message: requiredMessage }),
  Schema.isPattern(/^[+-]?\d+(?:\.\d+)?$/, {
    message: "Enter a valid line price.",
  })
);

const invoiceFormLine = Schema.Struct({
  id: Schema.String,
  description: invoiceFormRequiredText(1000),
  price: invoiceFormPrice,
});

const invoiceFormAddress = {
  line1: invoiceFormRequiredText(180),
  line2: invoiceFormOptionalText(180),
  city: invoiceFormRequiredText(255),
  postalCode: invoiceFormRequiredText(20),
  country: Schema.Trim.check(
    Schema.isPattern(/^[A-Za-z]{2}$/, { message: requiredMessage })
  ),
};

const invoiceFormCustomer = Schema.Union([
  Schema.Struct({
    customerType: Schema.Literal("person"),
    email: invoiceFormEmail,
    firstName: invoiceFormRequiredText(100),
    lastName: invoiceFormRequiredText(100),
    // Business-only values: a type switch retains them in form state, but a
    // person payload never sends them, so they stay unconstrained here.
    companyName: Schema.String,
    companyId: Schema.String,
    vatId: Schema.String,
    phone: invoiceFormOptionalText(20),
    ...invoiceFormAddress,
  }),
  Schema.Struct({
    customerType: Schema.Literal("business"),
    email: invoiceFormEmail,
    firstName: invoiceFormOptionalText(100),
    lastName: invoiceFormOptionalText(100),
    companyName: invoiceFormRequiredText(180),
    companyId: invoiceFormRequiredText(255),
    vatId: invoiceFormOptionalText(255),
    phone: invoiceFormOptionalText(20),
    ...invoiceFormAddress,
  }),
]);

const invoiceFormValues = Schema.Struct({
  customer: invoiceFormCustomer,
  locale: Schema.Literals(["cs-CZ", "en-US"]),
  serviceDate: invoiceFormCalendarDate,
  paid: Schema.Boolean,
  paidOn: Schema.Trim,
  dueDate: Schema.Trim,
  currency: Schema.String.check(
    Schema.isPattern(/^[A-Z]{3}$/, { message: requiredMessage })
  ),
  variableSymbol: Schema.String.check(
    Schema.makeFilter<string>(
      (value) => value.trim() === "" || /^\d{1,10}$/.test(value.trim()),
      { message: "Use at most 10 digits." }
    )
  ),
  lines: Schema.Array(invoiceFormLine).check(
    Schema.isMinLength(1, { message: "Add at least one line." })
  ),
});

export const invoiceFormSchema = invoiceFormValues.check(
  // Only the payment date chosen by the "Already paid" toggle is visible,
  // so only that field carries a validation rule.
  Schema.makeFilter<InvoiceFormValues>((value) => {
    const paymentDate = (value.paid ? value.paidOn : value.dueDate).trim();
    if (paymentDate !== "" && isCalendarDate(paymentDate)) return true;
    return {
      path: [value.paid ? "paidOn" : "dueDate"],
      issue: paymentDate === "" ? requiredMessage : calendarDateMessage,
    };
  })
);

type InvoiceFormValues = typeof invoiceFormValues.Type;

export type InvoiceFormInput = typeof invoiceFormSchema.Encoded;

export type InvoiceFormOutput = typeof invoiceFormSchema.Type;

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
  const draftRef = useRef<{
    readonly fingerprint: string;
    readonly invoiceId: string;
  } | null>(null);
  const searchId = useId();
  const initialLineId = useId();
  const paidId = useId();
  const [customer, setCustomer] =
    useState<InvoiceAdministrationCustomer | null>(null);
  const [customerMode, setCustomerMode] = useState<"existing" | "new">(
    "existing"
  );
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    readonly InvoiceAdministrationCustomer[]
  >([]);
  const [review, setReview] = useState<ReturnType<
    typeof readInvoiceForm
  > | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const form = useForm<InvoiceFormInput, unknown, InvoiceFormOutput>({
    defaultValues: {
      customer: {
        customerType: "person",
        email: "",
        firstName: "",
        lastName: "",
        companyName: "",
        companyId: "",
        vatId: "",
        phone: "",
        line1: "",
        line2: "",
        city: "",
        postalCode: "",
        country: "CZ",
      },
      locale: "cs-CZ",
      serviceDate: defaultServiceDate,
      paid: false,
      paidOn: defaultServiceDate,
      dueDate: defaultDueDate,
      currency: defaultCurrency,
      variableSymbol: suggestedVariableSymbol,
      lines: [{ id: initialLineId, description: "", price: "" }],
    },
    mode: "onBlur",
    reValidateMode: "onChange",
    resolver: effectSchemaResolver(invoiceFormSchema),
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "lines",
  });
  const customerType =
    useWatch({
      control: form.control,
      name: "customer.customerType",
    }) ?? "person";
  const currency =
    useWatch({ control: form.control, name: "currency" }) ?? defaultCurrency;
  const paid = useWatch({ control: form.control, name: "paid" }) ?? false;
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
        if (data) {
          draftRef.current = null;
          router.push(`/admin/invoices/${data.invoiceId}`);
        }
      },
      onError: ({ error: actionError }) =>
        setCreateError(
          actionError.serverError ?? "The invoice could not be created."
        ),
      onTransportError: () =>
        setCreateError("The invoice could not be created."),
    }
  );
  const { execute: preview, isExecuting: isPreviewing } = useWorkspaceAction(
    previewAdministrationInvoice,
    {
      actionName: "previewAdministrationInvoice",
      onSuccess: ({ data }) => {
        if (!data) return;
        setPreviewError(null);
        setPreviewUrl(data.dataUrl);
      },
      onError: ({ error: actionError }) =>
        setPreviewError(
          actionError.serverError ??
            "The invoice preview could not be generated."
        ),
      onTransportError: () =>
        setPreviewError("The invoice preview could not be generated."),
    }
  );

  const customerFormDefaults = (
    next: InvoiceAdministrationCustomer | null
  ): InvoiceFormInput["customer"] => ({
    customerType: next?.details.kind ?? "person",
    email: next?.details.email ?? "",
    firstName: next?.details.firstName ?? "",
    lastName: next?.details.lastName ?? "",
    companyName:
      next?.details.kind === "business" ? (next.details.companyName ?? "") : "",
    companyId:
      next?.details.kind === "business" ? (next.details.companyId ?? "") : "",
    vatId: next?.details.kind === "business" ? (next.details.vatId ?? "") : "",
    phone: next?.details.phone ?? "",
    line1: next?.details.address.line1 ?? "",
    line2: next?.details.address.line2 ?? "",
    city: next?.details.address.city ?? "",
    postalCode: next?.details.address.postalCode ?? "",
    country: next?.details.address.country || "CZ",
  });

  const applyCustomer = (next: InvoiceAdministrationCustomer | null) => {
    setCustomer(next);
    form.reset({ ...form.getValues(), customer: customerFormDefaults(next) });
  };

  const openReview = (values: InvoiceFormOutput) => {
    setCreateError(null);
    // The draft UUID is idempotent for an equivalent normalized payload
    // (trimming and hidden-field normalization included) and rotates when the
    // normalized submitted payload changes: the server rejects a reused id
    // with different input.
    const payload = readInvoiceFormPayload({
      customer,
      customerMode,
      suggestedVariableSymbol,
      values,
    });
    const fingerprint = JSON.stringify(payload);
    const bound = draftRef.current;
    const invoiceId =
      bound && bound.fingerprint === fingerprint
        ? bound.invoiceId
        : getInvoiceDraftId(null);
    draftRef.current = { fingerprint, invoiceId };
    const nextReview = { invoiceId, ...payload };
    setPreviewError(null);
    setPreviewUrl(null);
    setReview(nextReview);
    const exponent =
      currencies.find(({ code }) => code === nextReview.currency)?.exponent ??
      0;
    if (getInvoiceReviewTotal(nextReview.lines, exponent) !== null) {
      preview({
        ...nextReview,
        variableSymbol: nextReview.variableSymbol ?? suggestedVariableSymbol,
      });
    }
  };

  const runSearch = () => {
    const normalizedQuery = query.trim();
    if (isSearching || normalizedQuery.length < 2) return;
    setSearchError(null);
    setSearchResults([]);
    setHasSearched(false);
    search({ query: normalizedQuery });
  };

  const currencyExponent =
    currencies.find(({ code }) => code === currency)?.exponent ?? 0;
  const reviewCurrencyExponent = review
    ? (currencies.find(({ code }) => code === review.currency)?.exponent ?? 0)
    : 0;
  const reviewTotal = review
    ? getInvoiceReviewTotal(review.lines, reviewCurrencyExponent)
    : null;

  return (
    <>
      <Form {...form}>
        <form
          className="space-y-6"
          noValidate
          onSubmit={(event) => {
            // Bound at event time so the draft ref is only read outside
            // render.
            form.handleSubmit(openReview)(event);
          }}
        >
          <section className="rounded-2xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl">Customer</h2>
                <p className="mt-1 text-sm text-navy-blue/65">
                  Select a Dotypos customer or enter a new one. Confirmed
                  details are saved to Dotypos.
                </p>
              </div>
              <fieldset className="flex rounded-lg bg-navy-blue/5 p-1">
                <legend className="sr-only">Customer source</legend>
                {(["existing", "new"] as const).map((mode) => (
                  <Button
                    aria-pressed={customerMode === mode}
                    className="rounded-sm"
                    key={mode}
                    onClick={() => {
                      setCustomerMode(mode);
                      if (mode === "new") applyCustomer(null);
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
                            <p className="font-semibold">
                              {result.displayName}
                            </p>
                            <p className="text-sm text-navy-blue/65">
                              {result.email || "No email"}
                            </p>
                          </div>
                          <Button
                            onClick={() => {
                              applyCustomer(result);
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
                    <span className="font-semibold">
                      {customer.displayName}
                    </span>
                    <Button
                      onClick={() => applyCustomer(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Change
                    </Button>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="customer.customerType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Customer type</FormLabel>
                        <FormControl>
                          <select
                            className={selectClassName}
                            onChange={(event) =>
                              field.onChange(
                                event.target.value as "person" | "business"
                              )
                            }
                            value={field.value}
                          >
                            <option value="person">Individual</option>
                            <option value="business">Business</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customer.email"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>Invoice email</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            required
                            type="email"
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customer.firstName"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>
                          {customerType === "business"
                            ? "Contact first name (optional)"
                            : "First name"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            required={customerType === "person"}
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customer.lastName"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>
                          {customerType === "business"
                            ? "Contact last name (optional)"
                            : "Last name"}
                        </FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            required={customerType === "person"}
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {customerType === "business" && (
                    <>
                      <FormField
                        control={form.control}
                        name="customer.companyName"
                        render={({
                          field: { onChange, ...field },
                          fieldState,
                        }) => (
                          <FormItem>
                            <FormLabel>Company name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                onInput={onChange}
                                required
                                variant={fieldState.error ? "error" : "default"}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="customer.companyId"
                        render={({
                          field: { onChange, ...field },
                          fieldState,
                        }) => (
                          <FormItem>
                            <FormLabel>Company ID</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                onInput={onChange}
                                required
                                variant={fieldState.error ? "error" : "default"}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="customer.vatId"
                        render={({
                          field: { onChange, ...field },
                          fieldState,
                        }) => (
                          <FormItem>
                            <FormLabel>VAT ID (optional)</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                onInput={onChange}
                                variant={fieldState.error ? "error" : "default"}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  )}
                  <FormField
                    control={form.control}
                    name="customer.phone"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>Phone (optional)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            type="tel"
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customer.line1"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>Address</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            required
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customer.line2"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>Address line 2 (optional)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customer.city"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            required
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customer.postalCode"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>Postal code</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            required
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="customer.country"
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>Country code</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            maxLength={2}
                            minLength={2}
                            onInput={onChange}
                            required
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">Invoice</h2>
            <FormField
              control={form.control}
              name="paid"
              render={({ field }) => (
                <FormItem>
                  <FormLabel
                    className="mt-5 flex cursor-pointer items-center gap-3 rounded-xl border border-navy-blue/10 bg-navy-blue/2.5 p-4"
                    htmlFor={paidId}
                  >
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        id={paidId}
                        onCheckedChange={(checked) =>
                          field.onChange(Boolean(checked))
                        }
                      />
                    </FormControl>
                    <span className="text-sm font-semibold">Already paid</span>
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <FormField
                control={form.control}
                name="serviceDate"
                render={({ field: { onChange, ...field }, fieldState }) => (
                  <FormItem>
                    <FormLabel>Service date</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onInput={onChange}
                        required
                        type="date"
                        variant={fieldState.error ? "error" : "default"}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {paid ? (
                <FormField
                  control={form.control}
                  key="paid"
                  name="paidOn"
                  render={({ field: { onChange, ...field }, fieldState }) => (
                    <FormItem>
                      <FormLabel>Paid on</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onInput={onChange}
                          required
                          type="date"
                          variant={fieldState.error ? "error" : "default"}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  key="due"
                  name="dueDate"
                  render={({ field: { onChange, ...field }, fieldState }) => (
                    <FormItem>
                      <FormLabel>Due date</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          onInput={onChange}
                          required
                          type="date"
                          variant={fieldState.error ? "error" : "default"}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={form.control}
                name="locale"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Language</FormLabel>
                    <FormControl>
                      <select
                        className={selectClassName}
                        onChange={(event) =>
                          field.onChange(
                            event.target.value as InvoiceFormOutput["locale"]
                          )
                        }
                        value={field.value}
                      >
                        <option value="cs-CZ">Czech</option>
                        <option value="en-US">English</option>
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Currency</FormLabel>
                    <FormControl>
                      <select
                        className={selectClassName}
                        onChange={(event) => field.onChange(event.target.value)}
                        value={field.value}
                      >
                        {currencies.map((currency) => (
                          <option key={currency.code} value={currency.code}>
                            {currency.code} — {currency.name}
                          </option>
                        ))}
                      </select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="variableSymbol"
                render={({
                  field: { onChange, onBlur, ...field },
                  fieldState,
                }) => (
                  <FormItem>
                    <FormLabel>Variable symbol</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="numeric"
                        maxLength={10}
                        onBlur={(event) => {
                          onBlur();
                          if (!event.currentTarget.value.trim()) {
                            onChange(suggestedVariableSymbol);
                          }
                        }}
                        onFocus={(event) => {
                          if (
                            event.currentTarget.value ===
                            suggestedVariableSymbol
                          )
                            event.currentTarget.select();
                        }}
                        onInput={onChange}
                        pattern="[0-9]{1,10}"
                        required
                        variant={fieldState.error ? "error" : "default"}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </section>

          <section className="rounded-2xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl">Line items</h2>
                <p className="mt-1 text-sm text-navy-blue/65">
                  Enter signed prices with up to {currencyExponent} decimal
                  places.
                </p>
              </div>
              <Button
                onClick={() =>
                  append({
                    id: crypto.randomUUID(),
                    description: "",
                    price: "",
                  })
                }
                size="sm"
                type="button"
                variant="secondary"
              >
                <Plus aria-hidden className="size-4" /> Add line
              </Button>
            </div>
            <div className="mt-5 space-y-3">
              {fields.map((line, index) => (
                <div
                  className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
                  key={line.id}
                >
                  <FormField
                    control={form.control}
                    name={`lines.${index}.description`}
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>Description {index + 1}</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            onInput={onChange}
                            required
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lines.${index}.price`}
                    render={({ field: { onChange, ...field }, fieldState }) => (
                      <FormItem>
                        <FormLabel>Price</FormLabel>
                        <FormControl>
                          <InvoicePriceInput
                            exponent={currencyExponent}
                            onBlur={field.onBlur}
                            onChange={onChange}
                            ref={field.ref}
                            value={field.value}
                            variant={fieldState.error ? "error" : "default"}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    aria-label={`Remove line ${index + 1}`}
                    disabled={fields.length === 1}
                    onClick={() => remove(index)}
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
              disabled={
                isCreating || (customerMode === "existing" && !customer)
              }
              type="submit"
            >
              Review invoice
            </Button>
          </div>
        </form>
      </Form>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isCreating) {
            setCreateError(null);
            setPreviewError(null);
            setPreviewUrl(null);
            setReview(null);
          }
        }}
        open={Boolean(review)}
      >
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden">
          <DialogHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-red-100 text-red-800">
              <CircleAlert aria-hidden className="size-6" />
            </div>
            <DialogTitle>This action creates and sends the invoice</DialogTitle>
            <DialogDescription className="text-base leading-6">
              The invoice is immutable after creation. Clicking the final button
              immediately emails it to the customer and Deskohub’s internal
              recipient. The final invoice number, issue time, and automatically
              suggested variable symbol are assigned after confirmation.
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-navy-blue/10 bg-navy-blue/5">
              {isPreviewing && (
                <div
                  aria-live="polite"
                  className="grid min-h-96 place-items-center text-sm text-navy-blue/65"
                >
                  Generating PDF preview…
                </div>
              )}
              {previewUrl && (
                <>
                  <iframe
                    className="h-[60dvh] min-h-96 w-full bg-white"
                    src={previewUrl}
                    title="Invoice PDF preview"
                  />
                  <div className="border-t border-navy-blue/10 p-3 text-right text-sm">
                    <a
                      className="font-semibold text-burned-orange underline-offset-4 hover:underline"
                      href={previewUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open PDF preview
                    </a>
                  </div>
                </>
              )}
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
          {previewError && (
            <AdministrationAlert role="alert" status="error">
              {previewError}
            </AdministrationAlert>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={isCreating} type="button" variant="secondary">
                Go back
              </Button>
            </DialogClose>
            <Button
              disabled={
                isCreating ||
                isPreviewing ||
                !review ||
                !previewUrl ||
                reviewTotal === null
              }
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
  lines: readonly { readonly price: string }[],
  exponent = Number.POSITIVE_INFINITY
) => {
  const amounts: BigDecimal.BigDecimal[] = [];
  for (const line of lines) {
    const amount = BigDecimal.fromString(line.price);
    if (Option.isNone(amount) || amount.value.scale > exponent) return null;
    amounts.push(amount.value);
  }
  return BigDecimal.format(BigDecimal.sumAll(amounts));
};

export const getInvoiceDraftId = (current: string | null) =>
  current ?? crypto.randomUUID();

export const isInvoicePriceInput = (value: string, exponent: number) =>
  new RegExp(
    exponent === 0 ? "^[+-]?\\d*$" : `^[+-]?\\d*(?:\\.\\d{0,${exponent}})?$`
  ).test(value);

const invoicePricePattern = (exponent: number) =>
  exponent === 0 ? "[+-]?\\d+" : `[+-]?\\d+(?:\\.\\d{1,${exponent}})?`;

// The price gate must also observe native `change` events (typed into the
// field without a preceding `input` event, as some browsers and automation
// dispatch them): React's synthetic `onChange` does not fire for those here,
// so the DOM value could drift from the form state it is supposed to gate.
function InvoicePriceInput({
  exponent,
  onBlur,
  onChange,
  ref,
  value,
  variant,
  ...labelProps
}: {
  readonly exponent: number;
  readonly onBlur: () => void;
  readonly onChange: (price: string) => void;
  readonly ref?: (node: HTMLInputElement | null) => void;
  readonly value: string;
  readonly variant: "default" | "error";
} & Omit<React.ComponentProps<"input">, "onChange" | "ref" | "value">) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const handleNativeChange = (event: Event) => {
      const price = (event.currentTarget as HTMLInputElement).value;
      if (!isInvoicePriceInput(price, exponent)) {
        // Rejected input never reaches form state, so restore the DOM to the
        // accepted value instead of letting it drift.
        input.value = value;
        return;
      }
      if (price !== value) onChange(price);
    };
    input.addEventListener("change", handleNativeChange);
    return () => input.removeEventListener("change", handleNativeChange);
  }, [exponent, onChange, value]);

  return (
    <Input
      inputMode="decimal"
      onBlur={onBlur}
      onChange={(event) => {
        const price = event.target.value;
        if (!isInvoicePriceInput(price, exponent)) return;
        onChange(price);
      }}
      onInput={(event) => {
        // Mirrors the other form fields: real typing dispatches input
        // events, which React's synthetic onChange does not always surface.
        const price = event.currentTarget.value;
        if (!isInvoicePriceInput(price, exponent)) return;
        if (price !== value) onChange(price);
      }}
      pattern={invoicePricePattern(exponent)}
      placeholder="0.00"
      ref={(node) => {
        inputRef.current = node;
        ref?.(node);
      }}
      required
      value={value}
      variant={variant}
      {...labelProps}
    />
  );
}

export function readInvoiceForm(input: {
  readonly customer: InvoiceAdministrationCustomer | null;
  readonly customerMode: "existing" | "new";
  readonly invoiceId: string;
  readonly suggestedVariableSymbol: string;
  readonly values: InvoiceFormOutput;
}) {
  return {
    invoiceId: input.invoiceId,
    ...readInvoiceFormPayload(input),
  };
}

export function readInvoiceFormPayload(input: {
  readonly customer: InvoiceAdministrationCustomer | null;
  readonly customerMode: "existing" | "new";
  readonly suggestedVariableSymbol: string;
  readonly values: InvoiceFormOutput;
}) {
  const formCustomer = input.values.customer;
  const address = {
    line1: formCustomer.line1,
    ...(formCustomer.line2 && { line2: formCustomer.line2 }),
    city: formCustomer.city,
    postalCode: formCustomer.postalCode,
    country: formCustomer.country.toUpperCase(),
  };
  const contact = {
    email: formCustomer.email,
    ...(formCustomer.phone && { phone: formCustomer.phone }),
    address,
  };
  const details =
    formCustomer.customerType === "business"
      ? {
          ...contact,
          kind: "business" as const,
          ...(formCustomer.firstName && { firstName: formCustomer.firstName }),
          ...(formCustomer.lastName && { lastName: formCustomer.lastName }),
          companyName: formCustomer.companyName,
          companyId: formCustomer.companyId,
          ...(formCustomer.vatId && { vatId: formCustomer.vatId }),
        }
      : {
          ...contact,
          kind: "person" as const,
          firstName: formCustomer.firstName,
          lastName: formCustomer.lastName,
        };
  // The suggestion is computed when the page loads and goes stale once
  // another invoice is issued. Send only an operator-edited symbol; the
  // server derives the default from the final invoice number.
  const enteredVariableSymbol = input.values.variableSymbol.trim();
  const variableSymbol =
    enteredVariableSymbol === input.suggestedVariableSymbol
      ? ""
      : enteredVariableSymbol;
  return {
    customer:
      input.customerMode === "existing" && input.customer
        ? {
            kind: "existing" as const,
            customerId: input.customer.id,
            details,
          }
        : { kind: "new" as const, details },
    locale: input.values.locale,
    serviceDate: input.values.serviceDate,
    payment: input.values.paid
      ? { status: "paid" as const, date: input.values.paidOn }
      : { status: "due" as const, date: input.values.dueDate },
    currency: input.values.currency,
    ...(variableSymbol && { variableSymbol }),
    lines: input.values.lines.map(({ description, price }) => ({
      description,
      price,
    })),
  };
}
