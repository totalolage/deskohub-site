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
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { getLocalizedPagePath } from "@/features/i18n/routing";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
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
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import { formatCount } from "@/shared/utils/number";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import {
  createAdministrationInvoice,
  previewAdministrationInvoice,
  searchAdministrationInvoiceCustomers,
} from "./actions";
import { getInvoiceCustomerName } from "./invoice-display";

const selectClassName =
  "flex min-h-10 w-full rounded-lg border border-navy-blue/20 bg-white px-3 py-2 text-sm outline-none transition focus:border-burned-orange focus:ring-2 focus:ring-burned-orange/20";

const isCalendarDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
};

export const createInvoiceFormSchema = (locale: Locale) => {
  const requiredMessage = m.accountingInvoiceFormRequired({}, { locale });
  const calendarDateMessage = m.accountingInvoiceFormCalendarDateInvalid(
    {},
    { locale }
  );
  const maxLength = (maximumLength: number) =>
    Schema.isMaxLength(maximumLength, {
      message: m.accountingInvoiceFormMaxLength({ maximumLength }, { locale }),
    });
  const requiredText = (maximumLength: number) =>
    Schema.Trim.check(
      Schema.isNonEmpty({ message: requiredMessage }),
      maxLength(maximumLength)
    );
  const optionalText = (maximumLength: number) =>
    Schema.Trim.check(maxLength(maximumLength));
  const email = Schema.Trim.check(
    Schema.isNonEmpty({ message: requiredMessage }),
    maxLength(255),
    Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, {
      message: m.accountingInvoiceFormEmailInvalid({}, { locale }),
    })
  );
  const address = {
    line1: requiredText(180),
    line2: optionalText(180),
    city: requiredText(255),
    postalCode: requiredText(20),
    country: Schema.Trim.check(
      Schema.isPattern(/^[A-Za-z]{2}$/, { message: requiredMessage })
    ),
  };
  const values = Schema.Struct({
    customer: Schema.Union([
      Schema.Struct({
        customerType: Schema.Literal("person"),
        email,
        firstName: requiredText(100),
        lastName: requiredText(100),
        // Business-only values: a type switch retains them in form state, but
        // a person payload never sends them, so they stay unconstrained here.
        companyName: Schema.String,
        companyId: Schema.String,
        vatId: Schema.String,
        phone: optionalText(20),
        ...address,
      }),
      Schema.Struct({
        customerType: Schema.Literal("business"),
        email,
        firstName: optionalText(100),
        lastName: optionalText(100),
        companyName: requiredText(180),
        companyId: requiredText(255),
        vatId: optionalText(255),
        phone: optionalText(20),
        ...address,
      }),
    ]),
    locale: Schema.Literals(["cs-CZ", "en-US"]),
    serviceDate: Schema.Trim.check(
      Schema.isNonEmpty({ message: requiredMessage }),
      Schema.makeFilter(isCalendarDate, { message: calendarDateMessage })
    ),
    paid: Schema.Boolean,
    paidOn: Schema.Trim,
    dueDate: Schema.Trim,
    currency: Schema.String.check(
      Schema.isPattern(/^[A-Z]{3}$/, { message: requiredMessage })
    ),
    variableSymbol: Schema.String.check(
      Schema.makeFilter<string>(
        (value) => value.trim() === "" || /^\d{1,10}$/.test(value.trim()),
        {
          message: m.accountingInvoiceFormVariableSymbolInvalid({}, { locale }),
        }
      )
    ),
    lines: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        description: requiredText(1000),
        price: Schema.Trim.check(
          Schema.isNonEmpty({ message: requiredMessage }),
          Schema.isPattern(/^[+-]?\d+(?:\.\d+)?$/, {
            message: m.accountingInvoiceFormPriceInvalid({}, { locale }),
          })
        ),
      })
    ).check(
      Schema.isMinLength(1, {
        message: m.accountingInvoiceFormLinesRequired({}, { locale }),
      })
    ),
  });
  return values.check(
    // Only the payment date chosen by the "Already paid" toggle is visible,
    // so only that field carries a validation rule.
    Schema.makeFilter<typeof values.Type>((value) => {
      const paymentDate = (value.paid ? value.paidOn : value.dueDate).trim();
      if (paymentDate !== "" && isCalendarDate(paymentDate)) return true;
      return {
        path: [value.paid ? "paidOn" : "dueDate"],
        issue: paymentDate === "" ? requiredMessage : calendarDateMessage,
      };
    })
  );
};

type InvoiceFormSchema = ReturnType<typeof createInvoiceFormSchema>;

export type InvoiceFormInput = InvoiceFormSchema["Encoded"];

export type InvoiceFormOutput = InvoiceFormSchema["Type"];

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
  const locale = useRouteLocale();
  // A currency outside the offered list accepts whole units only.
  const getCurrencyExponent = (code: string) =>
    currencies.find((option) => option.code === code)?.exponent ?? 0;
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
    resolver: effectSchemaResolver(createInvoiceFormSchema(locale)),
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
      onSuccess: ({ data }) => {
        if (!data) return;
        setSearchError(null);
        setSearchResults(data);
        setHasSearched(true);
      },
      onError: ({ error: actionError }) =>
        setSearchError(
          actionError.serverError ??
            m.accountingInvoiceFormSearchError({}, { locale })
        ),
      onTransportError: () =>
        setSearchError(m.accountingInvoiceFormSearchError({}, { locale })),
    }
  );
  const { execute: create, isExecuting: isCreating } = useWorkspaceAction(
    createAdministrationInvoice,
    {
      onSuccess: ({ data }) => {
        if (data) {
          draftRef.current = null;
          router.push(
            getLocalizedPagePath(
              locale,
              "/[locale]/admin/invoices/[invoiceId]",
              { invoiceId: data.invoiceId }
            )
          );
        }
      },
      onError: ({ error: actionError }) =>
        setCreateError(
          actionError.serverError ??
            m.accountingInvoiceFormCreateError({}, { locale })
        ),
      onTransportError: () =>
        setCreateError(m.accountingInvoiceFormCreateError({}, { locale })),
    }
  );
  const { execute: preview, isExecuting: isPreviewing } = useWorkspaceAction(
    previewAdministrationInvoice,
    {
      onSuccess: ({ data }) => {
        if (!data) return;
        setPreviewError(null);
        setPreviewUrl(data.dataUrl);
      },
      onError: ({ error: actionError }) =>
        setPreviewError(
          actionError.serverError ??
            m.accountingInvoiceFormPreviewError({}, { locale })
        ),
      onTransportError: () =>
        setPreviewError(m.accountingInvoiceFormPreviewError({}, { locale })),
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
    if (
      getInvoiceReviewTotal(
        nextReview.lines,
        getCurrencyExponent(nextReview.currency)
      ) !== null
    ) {
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

  const currencyExponent = getCurrencyExponent(currency);
  const reviewTotal = review
    ? getInvoiceReviewTotal(review.lines, getCurrencyExponent(review.currency))
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
                <h2 className="text-xl">
                  {m.accountingInvoiceFormCustomerHeading({}, { locale })}
                </h2>
                <p className="mt-1 text-sm text-navy-blue/65">
                  {m.accountingInvoiceFormCustomerIntro({}, { locale })}
                </p>
              </div>
              <SegmentedControl
                label={m.accountingInvoiceFormCustomerSource({}, { locale })}
                name="customerSource"
                onValueChange={(mode) => {
                  setCustomerMode(mode);
                  if (mode === "new") applyCustomer(null);
                }}
                options={[
                  {
                    label: m.accountingInvoiceFormCustomerSourceExisting(
                      {},
                      { locale }
                    ),
                    value: "existing",
                  },
                  {
                    label: m.accountingInvoiceFormCustomerSourceNew(
                      {},
                      { locale }
                    ),
                    value: "new",
                  },
                ]}
                value={customerMode}
              />
            </div>

            {customerMode === "existing" && !customer && (
              <div className="mt-5 space-y-3">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                  <div className="grid gap-1.5">
                    <Label htmlFor={searchId}>
                      {m.accountingInvoiceFormSearchLabel({}, { locale })}
                    </Label>
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
                      placeholder={m.accountingInvoiceFormSearchPlaceholder(
                        {},
                        { locale }
                      )}
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
                    {isSearching
                      ? m.accountingInvoiceFormSearching({}, { locale })
                      : m.accountingInvoiceFormSearch({}, { locale })}
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
                      {m.accountingInvoiceFormSearchEmpty({}, { locale })}
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
                              {getInvoiceCustomerName(result, locale)}
                            </p>
                            <p className="text-sm text-navy-blue/65">
                              {result.email ||
                                m.accountingInvoiceFormCustomerNoEmail(
                                  {},
                                  { locale }
                                )}
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
                            {m.accountingInvoiceFormSelectCustomer(
                              {},
                              { locale }
                            )}
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
                      {getInvoiceCustomerName(customer, locale)}
                    </span>
                    <Button
                      onClick={() => applyCustomer(null)}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      {m.accountingInvoiceFormChangeCustomer({}, { locale })}
                    </Button>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="customer.customerType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          {m.accountingInvoiceFormCustomerType({}, { locale })}
                        </FormLabel>
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
                            <option value="person">
                              {m.accountingInvoiceFormCustomerTypePerson(
                                {},
                                { locale }
                              )}
                            </option>
                            <option value="business">
                              {m.accountingInvoiceFormCustomerTypeBusiness(
                                {},
                                { locale }
                              )}
                            </option>
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
                        <FormLabel>
                          {m.accountingInvoiceFormEmail({}, { locale })}
                        </FormLabel>
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
                            ? m.accountingInvoiceFormContactFirstName(
                                {},
                                { locale }
                              )
                            : m.accountingInvoiceFormFirstName({}, { locale })}
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
                            ? m.accountingInvoiceFormContactLastName(
                                {},
                                { locale }
                              )
                            : m.accountingInvoiceFormLastName({}, { locale })}
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
                            <FormLabel>
                              {m.accountingInvoiceFormCompanyName(
                                {},
                                { locale }
                              )}
                            </FormLabel>
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
                            <FormLabel>
                              {m.accountingInvoiceFormCompanyId({}, { locale })}
                            </FormLabel>
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
                            <FormLabel>
                              {m.accountingInvoiceFormVatId({}, { locale })}
                            </FormLabel>
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
                        <FormLabel>
                          {m.accountingInvoiceFormPhone({}, { locale })}
                        </FormLabel>
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
                        <FormLabel>
                          {m.accountingInvoiceFormAddressLine1({}, { locale })}
                        </FormLabel>
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
                        <FormLabel>
                          {m.accountingInvoiceFormAddressLine2({}, { locale })}
                        </FormLabel>
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
                        <FormLabel>
                          {m.accountingInvoiceFormCity({}, { locale })}
                        </FormLabel>
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
                        <FormLabel>
                          {m.accountingInvoiceFormPostalCode({}, { locale })}
                        </FormLabel>
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
                        <FormLabel>
                          {m.accountingInvoiceFormCountryCode({}, { locale })}
                        </FormLabel>
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
            <h2 className="text-xl">
              {m.accountingInvoiceFormInvoiceHeading({}, { locale })}
            </h2>
            <FormField
              control={form.control}
              name="paid"
              render={({ field }) => (
                <FormItem>
                  <FormLabel asChild htmlFor={paidId}>
                    <ChoiceCard align="center" className="mt-5">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          id={paidId}
                          onCheckedChange={(checked) =>
                            field.onChange(Boolean(checked))
                          }
                        />
                      </FormControl>
                      <span className="text-sm font-semibold">
                        {m.accountingInvoiceFormAlreadyPaid({}, { locale })}
                      </span>
                    </ChoiceCard>
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
                    <FormLabel>
                      {m.accountingInvoiceFormServiceDate({}, { locale })}
                    </FormLabel>
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
                      <FormLabel>
                        {m.accountingInvoiceFormPaidOn({}, { locale })}
                      </FormLabel>
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
                      <FormLabel>
                        {m.accountingInvoiceFormDueDate({}, { locale })}
                      </FormLabel>
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
                    <FormLabel>
                      {m.accountingInvoiceFormLanguage({}, { locale })}
                    </FormLabel>
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
                        <option value="cs-CZ">
                          {m.accountingInvoiceFormLanguageCzech({}, { locale })}
                        </option>
                        <option value="en-US">
                          {m.accountingInvoiceFormLanguageEnglish(
                            {},
                            { locale }
                          )}
                        </option>
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
                    <FormLabel>
                      {m.accountingInvoiceFormCurrency({}, { locale })}
                    </FormLabel>
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
                    <FormLabel>
                      {m.accountingInvoiceFormVariableSymbol({}, { locale })}
                    </FormLabel>
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
                <h2 className="text-xl">
                  {m.accountingInvoiceFormLinesHeading({}, { locale })}
                </h2>
                <p className="mt-1 text-sm text-navy-blue/65">
                  {m.accountingInvoiceFormLinesHint(
                    { decimalPlaces: currencyExponent },
                    { locale }
                  )}
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
                <Plus aria-hidden className="size-4" />{" "}
                {m.accountingInvoiceFormAddLine({}, { locale })}
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
                        <FormLabel>
                          {m.accountingInvoiceFormLineDescription(
                            { lineNumber: formatCount(index + 1, locale) },
                            { locale }
                          )}
                        </FormLabel>
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
                        <FormLabel>
                          {m.accountingInvoiceFormLinePrice({}, { locale })}
                        </FormLabel>
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
                    aria-label={m.accountingInvoiceFormRemoveLine(
                      { lineNumber: formatCount(index + 1, locale) },
                      { locale }
                    )}
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
              {m.accountingInvoiceFormReview({}, { locale })}
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
        <DialogContent
          className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden"
          locale={locale}
        >
          <DialogHeader>
            <div className="mb-2 flex size-11 items-center justify-center rounded-full bg-red-100 text-red-800">
              <CircleAlert aria-hidden className="size-6" />
            </div>
            <DialogTitle>
              {m.accountingInvoiceFormConfirmTitle({}, { locale })}
            </DialogTitle>
            <DialogDescription className="text-base leading-6">
              {m.accountingInvoiceFormConfirmDescription({}, { locale })}
            </DialogDescription>
          </DialogHeader>
          {review && (
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-navy-blue/10 bg-navy-blue/5">
              {isPreviewing && (
                <div
                  aria-live="polite"
                  className="grid min-h-96 place-items-center text-sm text-navy-blue/65"
                >
                  {m.accountingInvoiceFormPreviewGenerating({}, { locale })}
                </div>
              )}
              {previewUrl && (
                <>
                  <iframe
                    className="h-[60dvh] min-h-96 w-full bg-white"
                    src={previewUrl}
                    title={m.accountingInvoiceFormPreviewTitle({}, { locale })}
                  />
                  <div className="border-t border-navy-blue/10 p-3 text-right text-sm">
                    <a
                      className="font-semibold text-burned-orange underline-offset-4 hover:underline"
                      href={previewUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {m.accountingInvoiceFormPreviewOpen({}, { locale })}
                    </a>
                  </div>
                </>
              )}
            </div>
          )}
          {review && reviewTotal === null && (
            <AdministrationAlert role="alert" status="error">
              {m.accountingInvoiceFormInvalidTotal({}, { locale })}
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
                {m.accountingInvoiceFormGoBack({}, { locale })}
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
              tone="danger"
              type="button"
            >
              {isCreating
                ? m.accountingInvoiceFormCreating({}, { locale })
                : m.accountingInvoiceFormCreate({}, { locale })}
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

/** Czech operators type a decimal comma; the price keeps the canonical dot. */
export const normalizeInvoicePriceInput = (value: string) =>
  value.replace(",", ".");

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
      const price = normalizeInvoicePriceInput(
        (event.currentTarget as HTMLInputElement).value
      );
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
        const price = normalizeInvoicePriceInput(event.target.value);
        if (!isInvoicePriceInput(price, exponent)) return;
        onChange(price);
      }}
      onInput={(event) => {
        // Mirrors the other form fields: real typing dispatches input
        // events, which React's synthetic onChange does not always surface.
        const price = normalizeInvoicePriceInput(event.currentTarget.value);
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
