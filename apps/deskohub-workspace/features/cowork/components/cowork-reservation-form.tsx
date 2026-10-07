"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Match, Schema } from "effect";
import { AlertTriangle, Clock3, Coffee, Monitor, Wifi } from "lucide-react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef } from "react";
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
import openSpaceArtwork from "@/features/cowork/assets/open-space.png";
import reservedDeskArtwork from "@/features/cowork/assets/reserved-desk.png";
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
  const rangeAvailabilityQuery = useMemo(
    () =>
      isWorkspaceCoworkCurrentProductTier(selectedTier)
        ? getWorkspaceAvailabilityQuery({
            from: initialAvailabilityQuery.from,
            tier: selectedTier,
            to: initialAvailabilityQuery.to,
          })
        : undefined,
    [initialAvailabilityQuery.from, initialAvailabilityQuery.to, selectedTier]
  );
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
  const workstationRequirementQuery = useMemo(
    () =>
      selectedTier === "reserved-desk" && selectedDate
        ? getWorkspaceAvailabilityQuery({
            date: selectedDate,
            from: initialAvailabilityQuery.from,
            tier: selectedTier,
            to: initialAvailabilityQuery.to,
          })
        : undefined,
    [
      initialAvailabilityQuery.from,
      initialAvailabilityQuery.to,
      selectedDate,
      selectedTier,
    ]
  );
  const availabilityQueryResult = useReservationAvailability(
    availabilityQuery,
    { replacementToken }
  );
  const rangeAvailabilityQueryResult = useReservationAvailability(
    rangeAvailabilityQuery,
    { replacementToken }
  );
  const workstationRequirementQueryResult = useReservationAvailability(
    workstationRequirementQuery,
    { replacementToken }
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
  const { availability: rangeAvailability } = rangeAvailabilityQueryResult;
  const isAvailabilitySettledForCurrentRange = Boolean(
    rangeAvailabilityQuery &&
      rangeAvailability?.from === rangeAvailabilityQuery.from &&
      rangeAvailability?.to === rangeAvailabilityQuery.to &&
      rangeAvailabilityQueryResult.isSuccess &&
      !rangeAvailabilityQueryResult.isFetching &&
      !rangeAvailabilityQueryResult.isError &&
      !rangeAvailabilityQueryResult.isPlaceholderData
  );
  const currentRangeAvailability = isAvailabilitySettledForCurrentRange
    ? rangeAvailability
    : null;
  const isAvailabilitySettledForSelectedDate = Boolean(
    selectedDate &&
      availabilityQuery?.date === selectedDate &&
      availability?.date === selectedDate &&
      availabilityQueryResult.isSuccess &&
      !availabilityQueryResult.isFetching &&
      !availabilityQueryResult.isError &&
      !availabilityQueryResult.isPlaceholderData
  );
  const currentAvailability = isAvailabilitySettledForSelectedDate
    ? availability
    : null;
  const isWorkstationRequirementSettledForSelectedDate = Boolean(
    selectedDate &&
      workstationRequirementQuery?.date === selectedDate &&
      workstationRequirementQueryResult.availability?.date === selectedDate &&
      workstationRequirementQueryResult.isSuccess &&
      !workstationRequirementQueryResult.isFetching &&
      !workstationRequirementQueryResult.isError &&
      !workstationRequirementQueryResult.isPlaceholderData
  );
  const currentWorkstationRequirementAvailability =
    isWorkstationRequirementSettledForSelectedDate
      ? workstationRequirementQueryResult.availability
      : null;
  const isSelectedAvailabilityUnsettled = Boolean(
    selectedDate &&
      availabilityQuery?.date === selectedDate &&
      !isAvailabilitySettledForSelectedDate
  );
  const isWorkstationRequirementUnsettled = Boolean(
    workstationRequirementQuery &&
      !isWorkstationRequirementSettledForSelectedDate
  );
  const isAvailabilityQueryFetching =
    availabilityQueryResult.isFetching ||
    workstationRequirementQueryResult.isFetching;
  const unavailableCalendarDates = useMemo(
    () =>
      new Set(
        (currentRangeAvailability?.unavailableDates ?? []).filter(
          (date) =>
            selectedTier !== "reserved-desk" ||
            !currentRangeAvailability?.reservedDeskWorkstationRequiredDates.includes(
              date
            )
        )
      ),
    [currentRangeAvailability, selectedTier]
  );
  const currentTierAvailability =
    currentAvailability ?? currentRangeAvailability;
  const unavailableCoworkTiers = useMemo(
    () => new Set(currentTierAvailability?.unavailableCoworkTiers ?? []),
    [currentTierAvailability]
  );
  const unavailableMonitorOptions = useMemo(
    () =>
      new Set(
        currentWorkstationRequirementAvailability?.unavailableMonitorOptions ??
          []
      ),
    [currentWorkstationRequirementAvailability]
  );
  const selectedDateNotices = useMemo(
    () =>
      (currentAvailability?.notices ?? []).filter(
        (notice) => notice.date === selectedDate
      ),
    [currentAvailability, selectedDate]
  );
  const unavailableRequirementMonitorOptions = useMemo(
    () =>
      new Set(
        currentWorkstationRequirementAvailability?.unavailableMonitorOptions ??
          []
      ),
    [currentWorkstationRequirementAvailability]
  );
  const firstAvailableMonitorOption = allowedMonitorOptions.find(
    (option) => !unavailableRequirementMonitorOptions.has(option)
  );
  const isWorkstationRequiredForDate = Boolean(
    isWorkstationRequirementSettledForSelectedDate &&
      selectedTier === "reserved-desk" &&
      selectedDate &&
      currentWorkstationRequirementAvailability?.reservedDeskWorkstationRequiredDates.includes(
        selectedDate
      ) &&
      firstAvailableMonitorOption
  );
  const isWorkstationNormalizationPending = Boolean(
    isWorkstationRequiredForDate &&
      (!selectedMonitorOption ||
        unavailableRequirementMonitorOptions.has(selectedMonitorOption))
  );
  const isSelectedTierUnavailable = Boolean(
    currentAvailability?.unavailableCoworkTiers.includes(selectedTier)
  );
  const isSelectedMonitorUnavailable = Boolean(
    selectedMonitorOption &&
      unavailableMonitorOptions.has(selectedMonitorOption)
  );
  const isSelectedDateUnavailable = Boolean(
    currentAvailability &&
      selectedDate &&
      currentAvailability.unavailableDates.includes(selectedDate) &&
      !(
        selectedTier === "reserved-desk" &&
        currentAvailability.reservedDeskWorkstationRequiredDates.includes(
          selectedDate
        )
      )
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
  const availabilityMessage = isSelectedReservationUnavailable
    ? selectedReservationUnavailableMessage
    : undefined;
  const availabilityConfirmationErrorMessage =
    (isSelectedAvailabilityUnsettled || isWorkstationRequirementUnsettled) &&
    !isAvailabilityQueryFetching
      ? m.coworkReservationAvailabilityError({}, { locale })
      : undefined;

  const autoAddedWorkstation = useRef(false);

  useEffect(() => {
    if (showWorkstationAddon) {
      if (
        !isAvailabilitySettledForSelectedDate ||
        !isWorkstationRequirementSettledForSelectedDate ||
        selectedTier !== "reserved-desk" ||
        form.getValues("entryTier") !== selectedTier ||
        form.getValues("date") !== selectedDate ||
        form.getValues("monitorOption") !== selectedMonitorOption
      ) {
        return;
      }

      if (isWorkstationRequiredForDate) {
        if (!firstAvailableMonitorOption) return;

        if (!selectedMonitorOption) {
          autoAddedWorkstation.current = true;
          form.setValue("monitorOption", firstAvailableMonitorOption, {
            shouldValidate: true,
          });
          return;
        }

        if (unavailableRequirementMonitorOptions.has(selectedMonitorOption)) {
          form.setValue("monitorOption", firstAvailableMonitorOption, {
            shouldValidate: true,
          });
        }
        return;
      }

      if (autoAddedWorkstation.current) {
        autoAddedWorkstation.current = false;
        form.setValue("monitorOption", undefined, { shouldValidate: true });
      }
      return;
    }

    autoAddedWorkstation.current = false;
    form.setValue("monitorOption", undefined, { shouldValidate: true });
    if (!showCoffeeAddon) {
      form.setValue("coffee", true, { shouldValidate: true });
    }
  }, [
    firstAvailableMonitorOption,
    form,
    isAvailabilitySettledForSelectedDate,
    isWorkstationRequirementSettledForSelectedDate,
    isWorkstationRequiredForDate,
    selectedDate,
    selectedMonitorOption,
    selectedTier,
    showCoffeeAddon,
    showWorkstationAddon,
    unavailableRequirementMonitorOptions,
  ]);

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
        isFetching:
          availabilityQueryResult.isFetching ||
          rangeAvailabilityQueryResult.isFetching ||
          workstationRequirementQueryResult.isFetching ||
          isWorkstationNormalizationPending,
        unavailableMessage:
          availabilityMessage ?? availabilityConfirmationErrorMessage,
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
                idPrefix="reservation-entry-tier"
                inputRef={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                onChange={field.onChange}
                presentation="illustrated"
                value={field.value}
              >
                {tierOptions.map((option) => {
                  const artworkSource = {
                    "open-space": openSpaceArtwork,
                    "reserved-desk": reservedDeskArtwork,
                  }[option.value];
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
                  const originalAmount =
                    advertisedProductItem &&
                    "originalAmount" in advertisedProductItem
                      ? advertisedProductItem.originalAmount
                      : undefined;
                  return (
                    <ReservationTypeOption
                      key={option.value}
                      disabled={isUnavailable}
                      illustration={
                        <Image
                          aria-hidden="true"
                          alt=""
                          className={cn(
                            "absolute top-0 right-0 h-auto w-[280%] max-w-[440px] -translate-y-[25%] object-contain object-right-top @min-[400px]/card:translate-x-0",
                            {
                              "open-space": "translate-x-[10%]",
                              "reserved-desk": "translate-x-[20%]",
                            }[option.value]
                          )}
                          height={941}
                          sizes="(min-width: 1024px) 440px, 280px"
                          src={artworkSource}
                          width={1672}
                        />
                      }
                      price={
                        advertisedProductItem ? (
                          <ReservationAdvertisedPrice
                            amount={advertisedProductItem.amount}
                            originalAmountClassName={
                              originalAmount ? "text-[0.6em]" : undefined
                            }
                            locale={locale}
                            originalAmount={originalAmount}
                            suffix={
                              <span className="ml-1 text-sm font-normal normal-case tracking-normal text-navy-blue/60">
                                {m.coworkReservationPricePeriodSuffix(
                                  {},
                                  { locale }
                                )}
                              </span>
                            }
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

      <div data-cowork-date-addon-row className="grid gap-5 lg:grid-cols-2">
        <div data-cowork-date-column className="space-y-5">
          <CoworkReservationDateField
            control={form.control}
            locale={locale}
            unavailableDates={unavailableCalendarDates}
          />

          {selectedDateNotices.length > 0 && (
            <div className="space-y-3">
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
            isWorkstationRequired={isWorkstationRequiredForDate}
            monitorOptionsAvailabilitySettled={
              isWorkstationRequirementSettledForSelectedDate
            }
            locale={locale}
            onManualSelection={() => {
              autoAddedWorkstation.current = false;
            }}
            priceLabel={workstationPriceLabel}
            unavailableMonitorOptions={unavailableMonitorOptions}
          />
        )}
      </div>
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
      className="relative z-10 col-start-1 row-start-3 mb-3 min-h-[5.625rem] max-w-full break-words pt-1 text-sm leading-5 text-navy-blue/70"
      data-cowork-tier-showcase={tier}
      data-reservation-type-description={tier}
    >
      <span className="box-decoration-clone rounded-sm bg-white/85 px-1 py-0.5">
        {getWorkspaceProductMessage(
          workspaceProductTierCardMessages[tier].description,
          locale
        )}
      </span>
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
  const perkIcons = {
    "open-space": [Wifi],
    "reserved-desk": [Clock3, Coffee, Monitor],
  }[tier];
  const perksLabelId = `cowork-tier-perks-label-${tier}`;

  return (
    <div
      className="relative z-10 col-start-1 col-end-3 row-start-4 pb-1 text-sm leading-5 text-navy-blue/70"
      data-reservation-type-perks={tier}
    >
      <span id={perksLabelId} className="sr-only">
        {getWorkspaceProductMessage(content.perksLabel, locale)}
      </span>
      <ul aria-labelledby={perksLabelId} className="space-y-2">
        {content.perks.map((perk, index) => {
          const text = getWorkspaceProductMessage(perk.message, locale);
          const PerkIcon = perkIcons[index];

          return (
            <li
              key={`${perk.marker ?? "bullet"}-${text}`}
              className={cn(
                "flex items-center gap-2 leading-6",
                perk.highlighted && "text-burned-orange"
              )}
            >
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-blue/7 text-navy-blue"
              >
                {PerkIcon && <PerkIcon className="h-4 w-4" focusable="false" />}
              </span>
              <span className="min-w-0 break-words">{text}</span>
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
        <FormItem className="contents" data-cowork-addon-column>
          <div data-cowork-addon-control className="space-y-2">
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
          </div>
        </FormItem>
      )}
    />
  );
}

function CoworkWorkstationAddonField({
  allowedMonitorOptions,
  control,
  isWorkstationRequired,
  monitorOptionsAvailabilitySettled,
  locale,
  onManualSelection,
  priceLabel,
  unavailableMonitorOptions,
}: {
  readonly allowedMonitorOptions: ReadonlyArray<WorkspaceProductMonitorOption>;
  readonly control: Control<
    CoworkReservationInput,
    unknown,
    CoworkReservationData
  >;
  readonly isWorkstationRequired: boolean;
  readonly monitorOptionsAvailabilitySettled: boolean;
  readonly locale: Locale;
  readonly onManualSelection: () => void;
  readonly priceLabel?: string;
  readonly unavailableMonitorOptions: ReadonlySet<WorkspaceProductMonitorOption>;
}) {
  const monitorSetupId = useId();
  const monitorSetupLabelId = `${monitorSetupId}-label`;

  return (
    <FormField
      control={control}
      name="monitorOption"
      render={({ field }) => (
        <FormItem className="contents" data-cowork-addon-column>
          <div data-cowork-addon-control className="space-y-2">
            <CoworkOptionalAddonToggle
              addon="workstation"
              checked={field.value !== undefined || isWorkstationRequired}
              disabled={isWorkstationRequired}
              icon={Monitor}
              info={
                isWorkstationRequired
                  ? {
                      triggerLabel:
                        m.reservationWorkstationRequiredTooltipTrigger(
                          {},
                          { locale }
                        ),
                      content: m.reservationWorkstationRequiredTooltipContent(
                        {},
                        { locale }
                      ),
                    }
                  : undefined
              }
              label={m.reservationWorkstationLabel({}, { locale })}
              onBlur={field.onBlur}
              onCheckedChange={(checked) => {
                if (isWorkstationRequired) return;
                onManualSelection();
                field.onChange(checked ? allowedMonitorOptions[0] : undefined);
              }}
              priceLabel={priceLabel}
            />
          </div>
          {field.value !== undefined && (
            <div
              data-cowork-monitor-options
              className="rounded-3xl border border-aquamarine-green/25 bg-aquamarine-green/8 p-4 lg:col-span-2"
            >
              <Label
                id={monitorSetupLabelId}
                className="block pt-1 text-sm text-navy-blue/60"
              >
                {m.reservationMonitorLabel({}, { locale })}
              </Label>
              <FormControl>
                <div
                  id={monitorSetupId}
                  role="radiogroup"
                  aria-labelledby={monitorSetupLabelId}
                  className="grid gap-3 sm:grid-cols-3"
                >
                  {monitorOptions
                    .filter((option) =>
                      allowedMonitorOptions.includes(option.value)
                    )
                    .map((option) => {
                      const isSelected = field.value === option.value;
                      const isUnavailable = unavailableMonitorOptions.has(
                        option.value
                      );
                      const isDisabled =
                        isUnavailable || !monitorOptionsAvailabilitySettled;

                      return (
                        <label
                          key={option.value}
                          className={cn(
                            "cursor-pointer rounded-[1.1rem] border p-3 transition hover:-translate-y-0.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy-blue",
                            isDisabled &&
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
                            disabled={isDisabled}
                            name={field.name}
                            onBlur={field.onBlur}
                            onChange={() => {
                              if (!isDisabled) {
                                onManualSelection();
                                field.onChange(option.value);
                              }
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
          <FormMessage className="lg:col-span-2" />
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

      <div className="grid gap-5 lg:grid-cols-2">
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
