"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Match, Schema } from "effect";
import { AlertTriangle, Coffee, Monitor } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPrice,
  isCoworkAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import {
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  isWorkspaceCoworkCurrentProductTier,
  isWorkspaceProductMonitorOption,
  type WorkspaceCoworkCurrentTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMessage,
  getWorkspaceProductTierTitle,
  type WorkspaceProductTierCardMessages,
  workspaceProductMonitorMessages,
  workspaceProductTierCardMessages,
  workspaceProductTierMessages,
} from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { ReservationAdvertisedPrice } from "@/features/reservation/components/reservation-advertised-price";
import { ReservationCheckoutForm } from "@/features/reservation/components/reservation-checkout-form";
import { ReservationFormDatePicker } from "@/features/reservation/components/reservation-date-picker";
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
  getCoworkCurrentReservationOrder,
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
  FormMessage,
} from "@/shared/components/ui/form";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/utils";
import { CoworkOptionalAddonToggle } from "./cowork-optional-addon-toggle";

type CoworkReservationFormProps = {
  initialReservation?: NormalizedCoworkReservationOrder;
  initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  initialValues?: CoworkReservationInput;
  locale: Locale;
  checkoutSessionId?: CheckoutSessionId;
  replacementToken?: string;
  submittedCode?: CanonicalPromotionCode;
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
  value: WorkspaceCoworkCurrentTier;
  title: Parameters<typeof getWorkspaceProductMessage>[0];
  description: Parameters<typeof getWorkspaceProductMessage>[0];
}> = workspaceCoworkCurrentTiers.map((tier) => ({
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

const fallbackTierCards = ["offer-1", "offer-2"] as const;

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
  tier: WorkspaceCoworkCurrentTier;
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
  submittedCode,
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
  const showCoffeeAddon = getCoworkTierCoffeeAddon(selectedTier) === "optional";
  const showWorkstationAddon =
    getCoworkTierWorkstationAddon(selectedTier) === "optional";
  const allowedMonitorOptions =
    getAllowedMonitorOptionsForCoworkTier(selectedTier);
  const availabilityQuery = useMemo(
    () =>
      isWorkspaceCoworkCurrentProductTier(selectedTier)
        ? getWorkspaceAvailabilityQuery({
            date: selectedDate,
            from: initialAvailabilityQuery.from,
            monitorOption: selectedMonitorOption,
            tier: selectedTier,
            to: initialAvailabilityQuery.to,
          })
        : undefined,
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

    // Both Reserved Desk advertised variants are requested so the paid
    // workstation addon price is visible before the toggle is flipped. The
    // canonical monitor option is display-only: workstation presence, not the
    // chosen configuration, determines the advertised amount, so the request
    // fingerprint never changes with the selected monitor option.
    return getCoworkTierAdvertisedPriceRequests({
      date: selectedDate,
      locale,
      offers: [
        { entryTier: "open-space", coffee: Boolean(selectedCoffee) },
        { entryTier: "reserved-desk", coffee: true },
        {
          entryTier: "reserved-desk",
          coffee: true,
          monitorOption: workspaceProductMonitorOptions[0],
        },
      ],
      submittedCode,
    });
  }, [locale, selectedCoffee, selectedDate, submittedCode]);
  const advertisedPriceQueryResults = useAdvertisedPrices(
    advertisedPriceRequests,
    initialAdvertisedPrices
  );
  const coffeeAdvertisedPriceRequest = useMemo(
    () =>
      selectedDate && selectedTier === "open-space"
        ? getCoworkCoffeeAdvertisedPriceRequest({
            date: selectedDate,
            locale,
            submittedCode,
            tier: selectedTier,
          })
        : undefined,
    [locale, selectedDate, selectedTier, submittedCode]
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
    string,
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
      const { entryTier } = request.reservation.details;
      // Both Reserved Desk variants share the tier key; the tier card shows
      // the base product price, identical across the workstation variants.
      if (!advertisedPricesByTier.has(entryTier)) {
        advertisedPricesByTier.set(entryTier, queryResult.data);
      }
    }
  }

  const workstationAdvertisedPriceQueryResult =
    advertisedPriceQueryResults[
      advertisedPriceRequests.findIndex(({ reservation }) =>
        Match.value(reservation.details).pipe(
          Match.when(
            { entryTier: "reserved-desk", workstation: true },
            () => true
          ),
          Match.when(
            { entryTier: "reserved-desk", workstation: false },
            () => false
          ),
          Match.when({ entryTier: "open-space" }, () => false),
          Match.when({ entryTier: "basic" }, () => false),
          Match.when({ entryTier: "plus" }, () => false),
          Match.when({ entryTier: "profi" }, () => false),
          Match.exhaustive
        )
      )
    ];
  const workstationAdvertisedPrice =
    workstationAdvertisedPriceQueryResult?.data &&
    !workstationAdvertisedPriceQueryResult.isError &&
    isCoworkAdvertisedPrice(workstationAdvertisedPriceQueryResult.data)
      ? workstationAdvertisedPriceQueryResult.data
      : undefined;
  const workstationPrice = workstationAdvertisedPrice?.quote.items.find(
    ({ type }) => type === "workstation"
  )?.amount;
  const workstationPriceLabel = workstationPrice
    ? formatWorkspaceMoney(workstationPrice, locale)
    : undefined;

  const selectedAdvertisedPriceIndex = advertisedPriceRequests.findIndex(
    ({ reservation }) =>
      Match.value(reservation.details).pipe(
        Match.when(
          { entryTier: "open-space" },
          () => selectedTier === "open-space"
        ),
        Match.when(
          { entryTier: "reserved-desk", workstation: true },
          () =>
            selectedTier === "reserved-desk" &&
            selectedMonitorOption !== undefined
        ),
        Match.when(
          { entryTier: "reserved-desk", workstation: false },
          () =>
            selectedTier === "reserved-desk" &&
            selectedMonitorOption === undefined
        ),
        Match.when({ entryTier: "basic" }, () => false),
        Match.when({ entryTier: "plus" }, () => false),
        Match.when({ entryTier: "profi" }, () => false),
        Match.exhaustive
      )
  );
  const advertisedPriceQueryResult =
    advertisedPriceQueryResults[selectedAdvertisedPriceIndex];
  const selectedAdvertisedPrice =
    advertisedPriceQueryResult?.data &&
    !advertisedPriceQueryResult.isError &&
    isCoworkAdvertisedPrice(advertisedPriceQueryResult.data)
      ? advertisedPriceQueryResult.data
      : undefined;
  const advertisedPrice = selectedAdvertisedPrice ?? null;
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
    if (showWorkstationAddon) {
      return;
    }

    form.setValue("monitorOption", undefined, { shouldValidate: true });
    if (!showCoffeeAddon) {
      form.setValue("coffee", true, { shouldValidate: true });
    }
  }, [form, showCoffeeAddon, showWorkstationAddon]);

  return (
    <ReservationCheckoutForm
      advertisedPrice={{
        token: advertisedPrice?.advertisedPriceToken,
        isFetching: Boolean(advertisedPriceQueryResult?.isFetching),
        isError: Boolean(advertisedPriceQueryResult?.isError),
        retry: () => void advertisedPriceQueryResult?.refetch(),
        sale: advertisedPrice
          ? {
              discounts: advertisedPrice.quote.payment.discounts,
              productLabel: getWorkspaceProductTierTitle(selectedTier, locale),
            }
          : undefined,
      }}
      availability={{
        isFetching: availabilityQueryResult.isFetching,
        unavailableMessage: isSelectedReservationUnavailable
          ? selectedReservationUnavailableMessage
          : undefined,
      }}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getCoworkCurrentReservationOrder}
      locale={locale}
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
                aria-required="true"
                className="lg:grid-cols-2"
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
                  return (
                    <ReservationTypeOption
                      key={option.value}
                      disabled={isUnavailable}
                      price={
                        advertisedProductItem ? (
                          <ReservationAdvertisedPrice
                            amount={advertisedProductItem.amount}
                            locale={locale}
                            originalAmount={
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

      <div className="grid gap-5 [grid-template-areas:'date'_'notice']">
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
      </div>

      {showCoffeeAddon && (
        <CoworkCoffeeAddonField
          control={form.control}
          locale={locale}
          priceLabel={coffeePriceLabel}
        />
      )}

      {showWorkstationAddon && (
        <CoworkWorkstationAddonField
          allowedMonitorOptions={allowedMonitorOptions}
          control={form.control}
          locale={locale}
          priceLabel={workstationPriceLabel}
          unavailableMonitorOptions={unavailableMonitorOptions}
        />
      )}
    </ReservationCheckoutForm>
  );
}

function CoworkTierDescription({
  locale,
  tier,
}: {
  readonly locale: Locale;
  readonly tier: WorkspaceCoworkCurrentTier;
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
  readonly tier: WorkspaceCoworkCurrentTier;
}) {
  const content: WorkspaceProductTierCardMessages =
    workspaceProductTierCardMessages[tier];

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

function CoworkCoffeeAddonField({
  control,
  locale,
  priceLabel,
}: {
  readonly control: Control<
    CoworkReservationInput,
    unknown,
    CoworkReservationData
  >;
  readonly locale: Locale;
  readonly priceLabel?: string;
}) {
  return (
    <FormField
      control={control}
      name="coffee"
      render={({ field }) => (
        <FormItem>
          <CoworkOptionalAddonToggle
            addon="coffee"
            checked={field.value}
            icon={Coffee}
            label={m.reservationCoffeeLabel({}, { locale })}
            onBlur={field.onBlur}
            onCheckedChange={(checked) => field.onChange(Boolean(checked))}
            priceLabel={priceLabel}
          />
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function CoworkWorkstationAddonField({
  allowedMonitorOptions,
  control,
  locale,
  priceLabel,
  unavailableMonitorOptions,
}: {
  readonly allowedMonitorOptions: ReadonlyArray<WorkspaceProductMonitorOption>;
  readonly control: Control<
    CoworkReservationInput,
    unknown,
    CoworkReservationData
  >;
  readonly locale: Locale;
  readonly priceLabel?: string;
  readonly unavailableMonitorOptions: ReadonlySet<WorkspaceProductMonitorOption>;
}) {
  return (
    <FormField
      control={control}
      name="monitorOption"
      render={({ field }) => (
        <FormItem>
          <CoworkOptionalAddonToggle
            addon="workstation"
            checked={field.value !== undefined}
            icon={Monitor}
            label={m.reservationWorkstationLabel({}, { locale })}
            onBlur={field.onBlur}
            onCheckedChange={(checked) =>
              field.onChange(checked ? allowedMonitorOptions[0] : undefined)
            }
            priceLabel={priceLabel}
          />
          {field.value !== undefined && (
            <div className="rounded-3xl border border-aquamarine-green/25 bg-aquamarine-green/8 p-4">
              <Label className="block pt-1 text-sm text-navy-blue/60">
                {m.reservationMonitorLabel({}, { locale })}
              </Label>
              <FormControl>
                <div role="radiogroup" className="grid gap-3 sm:grid-cols-3">
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
                            {getWorkspaceProductMessage(
                              option.description,
                              locale
                            )}
                          </span>
                        </label>
                      );
                    })}
                </div>
              </FormControl>
            </div>
          )}
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
          <ReservationFormDatePicker
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
        <div className="grid gap-3 lg:grid-cols-2 lg:gap-x-3 lg:gap-y-3">
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

      <div className="grid gap-5">
        <ReservationSkeletonField />
        <ReservationSkeletonField />
      </div>

      {showMonitorOption && <SkeletonMonitorOptionField />}

      <ReservationCustomerFieldsFallback />

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
