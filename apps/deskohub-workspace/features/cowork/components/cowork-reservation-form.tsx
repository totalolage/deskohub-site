"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { AlertTriangle, Coffee, Monitor } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPrice,
  isCoworkAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import {
  isWorkspaceProductMonitorOption,
  type WorkspaceCoworkProductTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkProductTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMessage,
  getWorkspaceProductTierTitle,
  workspaceProductMonitorMessages,
  workspaceProductTierCardMessages,
  workspaceProductTierMessages,
} from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { ReservationAdvertisedPrice } from "@/features/reservation/components/reservation-advertised-price";
import { ReservationCheckoutForm } from "@/features/reservation/components/reservation-checkout-form";
import { ReservationDatePicker } from "@/features/reservation/components/reservation-date-picker";
import {
  ReservationCustomerFieldsFallback,
  ReservationSkeletonBlock,
  ReservationSkeletonField,
  ReservationSubmitFallback,
  ReservationFormFallback as SharedReservationFormFallback,
} from "@/features/reservation/components/reservation-form-fallback";
import { ReservationFormLabel } from "@/features/reservation/components/reservation-form-label";
import {
  ReservationTypeInput,
  ReservationTypeOption,
} from "@/features/reservation/components/reservation-type-input";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import {
  getCoworkCoffeeAdvertisedPriceRequest,
  getCoworkTierAdvertisedPriceRequests,
} from "@/features/reservation/cowork-advertised-price";
import {
  type CoworkReservationData,
  type CoworkReservationInput,
  coworkReservationSchema,
  getAllowedMonitorOptionsForCoworkTier,
  getCoworkReservationOrder,
  getCoworkTierIncludesCourtesyCoffee,
  getCoworkTierRequiresMonitorOption,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import {
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
  getWorkspaceAvailabilityQueryFromReservationSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import { formatReservationInputDate } from "@/features/reservation/reservation-date";
import type { CoworkWorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Switch } from "@/shared/components/ui/switch";
import { cn } from "@/shared/utils";

type CoworkReservationFormProps = {
  initialReservation?: NormalizedCoworkReservationOrder;
  initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  initialValues?: CoworkReservationInput;
  locale: Locale;
  checkoutSessionId?: string;
  replacementToken?: string;
};

type CoworkReservationFormFallbackProps = Pick<
  CoworkReservationFormProps,
  "locale"
> & {
  showMonitorOption?: boolean;
};

const coworkReservationFormSchema = Schema.toStandardSchemaV1(
  coworkReservationSchema
);

const tierOptions: ReadonlyArray<{
  value: WorkspaceCoworkProductTier;
  title: Parameters<typeof getWorkspaceProductMessage>[0];
  description: Parameters<typeof getWorkspaceProductMessage>[0];
}> = workspaceCoworkProductTiers.map((tier) => ({
  value: tier,
  ...workspaceProductTierMessages[tier],
}));

const monitorOptions: ReadonlyArray<{
  value: WorkspaceProductMonitorOption;
  title: Parameters<typeof getWorkspaceProductMessage>[0];
  description: Parameters<typeof getWorkspaceProductMessage>[0];
}> = workspaceProductMonitorOptions.map((option) => ({
  value: option,
  ...workspaceProductMonitorMessages[option],
}));

const fallbackTierCards = ["tier-1", "tier-2", "tier-3"] as const;

const getWorkspaceAvailabilityQuery = ({
  date,
  from,
  monitorOption,
  tier,
  to,
}: {
  date?: string;
  from: string;
  monitorOption?: string;
  tier: WorkspaceCoworkProductTier;
  to: string;
}): CoworkWorkspaceAvailabilityQuery => {
  return {
    kind: "cowork",
    from,
    to,
    entryTier: tier,
    ...(date && { date }),
    ...(isWorkspaceProductMonitorOption(monitorOption) && { monitorOption }),
  };
};

const formatDisplayDate = (date: string, locale: Locale) =>
  formatReservationInputDate(
    date,
    locale,
    m.reservationDatePlaceholder({}, { locale })
  );

export function CoworkReservationForm({
  initialReservation,
  initialAdvertisedPrices = [],
  initialValues,
  locale,
  checkoutSessionId,
  replacementToken,
}: CoworkReservationFormProps) {
  const searchParams = useSearchParams();
  const defaultValues = useMemo(
    () =>
      initialValues ??
      (initialReservation
        ? getReservationDefaultValuesFromPayState(initialReservation)
        : getReservationDefaultValuesFromSearchParams(searchParams)),
    [initialReservation, initialValues, searchParams]
  );
  const initialAvailabilityQuery = useMemo(
    () =>
      getWorkspaceAvailabilityQueryFromReservationSearchParams(searchParams),
    [searchParams]
  );
  const form = useForm<CoworkReservationInput, unknown, CoworkReservationData>({
    resolver: standardSchemaResolver(coworkReservationFormSchema),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const [selectedTier, selectedDate, selectedCoffee, selectedMonitorOption] =
    useWatch({
      control: form.control,
      name: ["entryTier", "date", "coffee", "monitorOption"],
    });
  const courtesyCoffeeIncluded =
    getCoworkTierIncludesCourtesyCoffee(selectedTier);
  const shouldShowMonitors = getCoworkTierRequiresMonitorOption(selectedTier);
  const allowedMonitorOptions =
    getAllowedMonitorOptionsForCoworkTier(selectedTier);
  const availabilityQuery = useMemo(
    () =>
      getWorkspaceAvailabilityQuery({
        date: selectedDate,
        from: initialAvailabilityQuery.from,
        monitorOption: selectedMonitorOption,
        tier: selectedTier,
        to: initialAvailabilityQuery.to,
      }),
    [
      initialAvailabilityQuery.from,
      initialAvailabilityQuery.to,
      selectedDate,
      selectedMonitorOption,
      selectedTier,
    ]
  );
  const availabilityQueryResult = useReservationAvailability(
    availabilityQuery,
    { keepPreviousData: true, replacementToken }
  );
  const advertisedPriceRequests = useMemo(() => {
    if (!selectedDate) {
      return [];
    }

    return getCoworkTierAdvertisedPriceRequests({
      coffee: Boolean(selectedCoffee),
      date: selectedDate,
      locale,
    });
  }, [locale, selectedCoffee, selectedDate]);
  const advertisedPriceQueryResults = useAdvertisedPrices(
    advertisedPriceRequests.map(({ request }) => request),
    initialAdvertisedPrices
  );
  const coffeeAdvertisedPriceRequest = useMemo(
    () =>
      selectedDate
        ? getCoworkCoffeeAdvertisedPriceRequest({
            date: selectedDate,
            locale,
            tier: selectedTier,
          })
        : undefined,
    [locale, selectedDate, selectedTier]
  );
  const [coffeeAdvertisedPriceQueryResult] = useAdvertisedPrices(
    coffeeAdvertisedPriceRequest ? [coffeeAdvertisedPriceRequest] : [],
    initialAdvertisedPrices
  );
  const coffeeAdvertisedPrice =
    coffeeAdvertisedPriceQueryResult?.data &&
    isCoworkAdvertisedPrice(coffeeAdvertisedPriceQueryResult.data)
      ? coffeeAdvertisedPriceQueryResult.data
      : undefined;
  const coffeePrice = coffeeAdvertisedPrice?.quote.items.find(
    ({ type }) => type === "coffee"
  )?.amount;
  const coffeePriceLabel = coffeePrice
    ? formatWorkspaceMoney(coffeePrice, locale)
    : undefined;
  const advertisedPricesByTier = new Map<
    WorkspaceCoworkProductTier,
    Extract<AdvertisedPrice, { readonly kind: "cowork" }>
  >();

  for (const [index, queryResult] of advertisedPriceQueryResults.entries()) {
    const request = advertisedPriceRequests[index];
    if (
      request &&
      !queryResult.isError &&
      queryResult.data &&
      isCoworkAdvertisedPrice(queryResult.data)
    ) {
      advertisedPricesByTier.set(request.tier, queryResult.data);
    }
  }

  const selectedAdvertisedPriceIndex = advertisedPriceRequests.findIndex(
    ({ tier }) => tier === selectedTier
  );
  const advertisedPriceQueryResult =
    advertisedPriceQueryResults[selectedAdvertisedPriceIndex];
  const advertisedPrice = advertisedPricesByTier.get(selectedTier) ?? null;
  const { availability } = availabilityQueryResult;
  const unavailableDates = useMemo(
    () => new Set(availability?.unavailableDates ?? []),
    [availability]
  );
  const unavailableCoworkTiers = useMemo(
    () => new Set(availability?.unavailableCoworkTiers ?? []),
    [availability]
  );
  const unavailableMonitorOptions = useMemo(
    () => new Set(availability?.unavailableMonitorOptions ?? []),
    [availability]
  );
  const selectedDateNotices = useMemo(
    () =>
      (availability?.notices ?? []).filter(
        (notice) => notice.date === selectedDate
      ),
    [availability, selectedDate]
  );
  const isSelectedTierUnavailable = unavailableCoworkTiers.has(selectedTier);
  const isSelectedMonitorUnavailable = Boolean(
    selectedMonitorOption &&
      unavailableMonitorOptions.has(selectedMonitorOption)
  );
  const isSelectedDateUnavailable = Boolean(
    selectedDate && unavailableDates.has(selectedDate)
  );
  const isSelectedReservationUnavailable =
    isSelectedTierUnavailable ||
    isSelectedMonitorUnavailable ||
    isSelectedDateUnavailable;
  const selectedReservationUnavailableMessage =
    getReservationAvailabilityUnavailableMessage({
      date: selectedDate,
      dateFallback: m.reservationDatePlaceholder({}, { locale }),
      locale,
      reservation: { kind: "cowork", entryTier: selectedTier },
    });

  useEffect(() => {
    if (shouldShowMonitors) {
      return;
    }

    form.setValue("monitorOption", undefined, { shouldValidate: true });
  }, [form, shouldShowMonitors]);

  return (
    <ReservationCheckoutForm
      advertisedPrice={{
        token: advertisedPrice?.advertisedPriceToken,
        isFetching: Boolean(advertisedPriceQueryResult?.isFetching),
        isError: Boolean(advertisedPriceQueryResult?.isError),
        retry: () => void advertisedPriceQueryResult?.refetch(),
      }}
      afterCustomerFields={
        shouldShowMonitors && (
          <CoworkMonitorField
            allowedMonitorOptions={allowedMonitorOptions}
            control={form.control}
            locale={locale}
            unavailableMonitorOptions={unavailableMonitorOptions}
          />
        )
      }
      availability={{
        isFetching: availabilityQueryResult.isFetching,
        unavailableMessage: isSelectedReservationUnavailable
          ? selectedReservationUnavailableMessage
          : undefined,
      }}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getCoworkReservationOrder}
      locale={locale}
      messagePlaceholder={m.reservationMessagePlaceholder({}, { locale })}
    >
      <FormField
        control={form.control}
        name="entryTier"
        render={({ field }) => (
          <FormItem>
            <ReservationFormLabel required>
              {m.reservationTierLabel({}, { locale })}
            </ReservationFormLabel>
            <FormControl>
              <ReservationTypeInput
                idPrefix="reservation-entry-tier"
                inputRef={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                onChange={field.onChange}
                value={field.value}
              >
                {tierOptions.map((option) => {
                  const optionTitle = getWorkspaceProductMessage(
                    option.title,
                    locale
                  );
                  const isUnavailable = unavailableCoworkTiers.has(
                    option.value
                  );
                  const advertisedProductItem = advertisedPricesByTier
                    .get(option.value)
                    ?.summary.sections.find(({ key }) => key === "order")
                    ?.items.find(
                      (item) =>
                        "product" in item &&
                        item.product.kind === "cowork" &&
                        item.product.tier === option.value
                    );
                  const advertisedDiscounts =
                    advertisedProductItem &&
                    "discounts" in advertisedProductItem
                      ? advertisedProductItem.discounts
                      : undefined;
                  const hasAdvertisedDiscounts = Boolean(
                    advertisedDiscounts?.length
                  );
                  return (
                    <ReservationTypeOption
                      key={option.value}
                      className={
                        {
                          basic: "lg:col-start-1",
                          plus: "lg:col-start-2",
                          profi: "lg:col-start-3",
                        }[option.value]
                      }
                      disabled={isUnavailable}
                      discount={
                        hasAdvertisedDiscounts && advertisedDiscounts
                          ? {
                              labels: advertisedDiscounts.map(
                                ({ discount }) => ({
                                  id: discount.id,
                                  label: discount.label,
                                })
                              ),
                              details:
                                advertisedProductItem &&
                                "originalAmount" in advertisedProductItem &&
                                advertisedProductItem.originalAmount ? (
                                  <CheckoutSummaryDiscountDetails
                                    discounts={advertisedDiscounts}
                                    locale={locale}
                                    productLabel={getWorkspaceProductTierTitle(
                                      option.value,
                                      locale
                                    )}
                                  />
                                ) : undefined,
                            }
                          : undefined
                      }
                      price={
                        advertisedProductItem ? (
                          <ReservationAdvertisedPrice
                            amount={advertisedProductItem.amount}
                            locale={locale}
                            originalAmount={
                              advertisedDiscounts &&
                              "originalAmount" in advertisedProductItem
                                ? advertisedProductItem.originalAmount
                                : undefined
                            }
                            suffix={m.coworkReservationPricePeriodSuffix(
                              {},
                              { locale }
                            )}
                          />
                        ) : (
                          <ReservationSkeletonBlock className="h-4 w-24 bg-aquamarine-green/15" />
                        )
                      }
                      priceReady={Boolean(advertisedProductItem)}
                      title={optionTitle}
                      value={option.value}
                    >
                      <CoworkTierDescription
                        locale={locale}
                        tier={option.value}
                      />
                      <CoworkTierPerks locale={locale} tier={option.value} />
                    </ReservationTypeOption>
                  );
                })}
              </ReservationTypeInput>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-5 [grid-template-areas:'date'_'notice'_'coffee'] md:grid-cols-2 md:[grid-template-areas:'date_coffee'_'notice_notice']">
        <div className="[grid-area:date]">
          <CoworkReservationDateField
            control={form.control}
            locale={locale}
            unavailableDates={unavailableDates}
          />
        </div>

        {selectedDateNotices.length > 0 && (
          <div className="space-y-3 [grid-area:notice]">
            {selectedDateNotices.map((notice) => (
              <p
                key={`${notice.date}-${notice.startsAt}-${notice.endsAt}`}
                aria-live="polite"
                className="flex items-start gap-2 rounded-2xl border border-dashed border-sunset-yellow/45 bg-sunset-yellow/14 px-4 py-3 text-sm leading-6 text-navy-blue/50"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-chilean-fire" />
                <span>
                  {m.reservationAvailabilityPartialNotice(
                    {
                      startsAt: notice.startsAt,
                      endsAt: notice.endsAt,
                    },
                    { locale }
                  )}
                </span>
              </p>
            ))}
          </div>
        )}

        <div className="[grid-area:coffee]">
          <FormField
            control={form.control}
            name="coffee"
            render={({ field }) => (
              <FormItem>
                <ReservationFormLabel>
                  {m.reservationCoffeeLabel({}, { locale })}
                </ReservationFormLabel>
                <FormLabel
                  className={cn(
                    "flex h-13 items-center justify-between gap-3 rounded-[1.1rem] border border-navy-blue/10 bg-linear-to-br from-sunset-yellow/18 to-white px-4 py-3 text-navy-blue transition",
                    !courtesyCoffeeIncluded &&
                      "cursor-pointer hover:border-burned-orange/30",
                    courtesyCoffeeIncluded && "cursor-default"
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Coffee className="h-5 w-5 shrink-0 text-burned-orange" />
                    <FormControl>
                      <Switch
                        checked={courtesyCoffeeIncluded ? true : field.value}
                        disabled={courtesyCoffeeIncluded}
                        onBlur={field.onBlur}
                        onCheckedChange={(checked) =>
                          field.onChange(Boolean(checked))
                        }
                      />
                    </FormControl>
                  </span>
                  <span data-reservation-coffee-price="">
                    {coffeePriceLabel ? (
                      <span className="text-sm font-semibold text-navy-blue before:content-['+']">
                        {coffeePriceLabel}
                      </span>
                    ) : (
                      <ReservationSkeletonBlock className="h-4 w-14 bg-sunset-yellow/25" />
                    )}
                  </span>
                </FormLabel>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </ReservationCheckoutForm>
  );
}

function CoworkTierDescription({
  locale,
  tier,
}: {
  readonly locale: Locale;
  readonly tier: WorkspaceCoworkProductTier;
}) {
  return (
    <div
      className="mb-3 text-sm leading-5 text-navy-blue/62"
      data-reservation-type-description={tier}
    >
      {getWorkspaceProductMessage(
        workspaceProductTierCardMessages[tier].description,
        locale
      )}
    </div>
  );
}

function CoworkTierPerks({
  locale,
  tier,
}: {
  readonly locale: Locale;
  readonly tier: WorkspaceCoworkProductTier;
}) {
  const content = workspaceProductTierCardMessages[tier];

  return (
    <div
      className="space-y-1 pb-4 text-sm leading-5 text-navy-blue/62"
      data-reservation-type-perks={tier}
    >
      <span className="block font-semibold leading-5 text-navy-blue/72">
        {getWorkspaceProductMessage(content.perksLabel, locale)}
      </span>
      <ul className="space-y-0.5">
        {content.perks.map((perk) => {
          const text = getWorkspaceProductMessage(perk.message, locale);

          return (
            <li
              key={`${perk.marker ?? "bullet"}-${text}`}
              className={cn(
                "flex gap-1.5 leading-5",
                perk.highlighted && "text-burned-orange"
              )}
            >
              <span aria-hidden="true" className="w-3 shrink-0 text-center">
                {perk.marker === "plus" ? "+" : "\u2022"}
              </span>
              <span>{text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CoworkMonitorField({
  allowedMonitorOptions,
  control,
  locale,
  unavailableMonitorOptions,
}: {
  readonly allowedMonitorOptions: ReadonlyArray<WorkspaceProductMonitorOption>;
  readonly control: Control<
    CoworkReservationInput,
    unknown,
    CoworkReservationData
  >;
  readonly locale: Locale;
  readonly unavailableMonitorOptions: ReadonlySet<WorkspaceProductMonitorOption>;
}) {
  return (
    <FormField
      control={control}
      name="monitorOption"
      render={({ field }) => (
        <FormItem className="rounded-3xl border border-aquamarine-green/25 bg-aquamarine-green/8 p-4">
          <FormLabel
            className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-aquamarine-ink"
            required
          >
            <Monitor className="h-4 w-4 text-aquamarine-ink" />
            {m.reservationMonitorLabel({}, { locale })}
          </FormLabel>
          <FormControl>
            <div className="grid gap-3 sm:grid-cols-3">
              {monitorOptions
                .filter((option) =>
                  allowedMonitorOptions.includes(option.value)
                )
                .map((option) => {
                  const isSelected = field.value === option.value;
                  const isUnavailable = unavailableMonitorOptions.has(
                    option.value
                  );

                  return (
                    <label
                      key={option.value}
                      className={cn(
                        "cursor-pointer rounded-[1.1rem] border p-3 transition hover:-translate-y-0.5",
                        isUnavailable &&
                          "cursor-not-allowed opacity-45 hover:translate-y-0",
                        isSelected
                          ? "border-aquamarine-green bg-white ring-4 ring-aquamarine-green/15"
                          : "border-navy-blue/10 bg-white/75 hover:border-aquamarine-green/55"
                      )}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        checked={isSelected}
                        value={option.value}
                        disabled={isUnavailable}
                        name={field.name}
                        onBlur={field.onBlur}
                        onChange={() => {
                          if (!isUnavailable) field.onChange(option.value);
                        }}
                        ref={field.ref}
                      />
                      <span className="block font-semibold text-navy-blue">
                        {getWorkspaceProductMessage(option.title, locale)}
                      </span>
                      <span className="mt-1 block text-sm leading-5 text-navy-blue/60">
                        {getWorkspaceProductMessage(option.description, locale)}
                      </span>
                    </label>
                  );
                })}
            </div>
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function CoworkReservationDateField({
  control,
  locale,
  unavailableDates,
}: {
  readonly control: Control<
    CoworkReservationInput,
    unknown,
    CoworkReservationData
  >;
  readonly locale: Locale;
  readonly unavailableDates: ReadonlySet<string>;
}) {
  return (
    <FormField
      control={control}
      name="date"
      render={({ field }) => (
        <FormItem>
          <ReservationFormLabel required>
            {m.reservationDateLabel({}, { locale })}
          </ReservationFormLabel>
          <ReservationDatePicker
            ariaLabel={m.reservationDateLabel({}, { locale })}
            displayValue={formatDisplayDate(field.value, locale)}
            isDateDisabled={(date) => unavailableDates.has(date.toString())}
            locale={locale}
            minimum={() => Temporal.Now.plainDateISO().toString()}
            name={field.name}
            onChange={field.onChange}
            placeholder={m.reservationDatePlaceholder({}, { locale })}
            value={field.value}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function CoworkReservationFormFallback({
  locale,
  showMonitorOption = false,
}: CoworkReservationFormFallbackProps) {
  return (
    <SharedReservationFormFallback
      label={m.reservationFormTitle({}, { locale })}
    >
      <div className="space-y-2">
        <ReservationSkeletonBlock className="h-4 w-28" />
        <div className="grid gap-3 lg:grid-cols-3 lg:gap-x-3 lg:gap-y-3">
          {fallbackTierCards.map((tierCard) => (
            <div
              className="rounded-[1.4rem] border border-navy-blue/10 bg-white p-4"
              key={tierCard}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <ReservationSkeletonBlock className="h-6 w-32" />
                  <ReservationSkeletonBlock className="h-4 w-4 shrink-0 rounded-full" />
                </div>
                <ReservationSkeletonBlock className="h-4 w-24 bg-burned-orange/15" />
                <div className="space-y-2 pt-1">
                  <ReservationSkeletonBlock className="h-3 w-full" />
                  <ReservationSkeletonBlock className="h-3 w-11/12" />
                  <ReservationSkeletonBlock className="h-3 w-4/5" />
                </div>
                <div className="space-y-2 pt-1">
                  <ReservationSkeletonBlock className="h-4 w-24" />
                  <ReservationSkeletonBlock className="h-3 w-full" />
                  <ReservationSkeletonBlock className="h-3 w-10/12" />
                  <ReservationSkeletonBlock className="h-3 w-9/12" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <ReservationSkeletonField />
        <ReservationSkeletonField />
      </div>

      <ReservationCustomerFieldsFallback />

      {showMonitorOption && <SkeletonMonitorOptionField />}

      <div className="space-y-3 pt-1">
        <ReservationSubmitFallback />
        <div className="space-y-2">
          <ReservationSkeletonBlock className="h-4 w-full" />
          <ReservationSkeletonBlock className="h-4 w-4/5" />
        </div>
      </div>
    </SharedReservationFormFallback>
  );
}

function SkeletonMonitorOptionField() {
  return (
    <div className="rounded-3xl border border-aquamarine-green/25 bg-aquamarine-green/8 p-4">
      <div className="space-y-3">
        <ReservationSkeletonBlock className="h-4 w-40 bg-aquamarine-green/15" />
        <div className="grid gap-3 sm:grid-cols-3">
          {monitorOptions.map((option) => (
            <div
              className="rounded-[1.1rem] border border-navy-blue/10 bg-white/75 p-3"
              key={option.value}
            >
              <ReservationSkeletonBlock className="h-5 w-16" />
              <div className="mt-2 space-y-2">
                <ReservationSkeletonBlock className="h-3 w-full" />
                <ReservationSkeletonBlock className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
