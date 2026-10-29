"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Match } from "effect";
import { AlertTriangle, Clock3, Coffee, Monitor, Wifi } from "lucide-react";
import Image, { getImageProps } from "next/image";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef } from "react";
import { preload } from "react-dom";
import { type Control, useForm } from "react-hook-form";
import {
  type AdvertisedPrice,
  getAdvertisedProductItem,
  isCoworkAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import {
  getCoworkTierCoffeeAddon,
  getCoworkTierWorkstationAddon,
  type WorkspaceCoworkCurrentTier,
  type WorkspaceProductMonitorOption,
  workspaceCoworkCurrentTiers,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMessage,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
  type WorkspaceProductTierCardMessages,
  workspaceProductMonitorDescriptionMessages,
  workspaceProductTierCardMessages,
  workspaceProductTierMessages,
} from "@/features/checkout/product-catalog.i18n";
import openSpaceArtwork from "@/features/cowork/assets/open-space.png";
import reservedDeskArtwork from "@/features/cowork/assets/reserved-desk.png";
import reservedDeskWorkstationArtwork from "@/features/cowork/assets/reserved-desk-workstation.png";
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
import { getReservationAdvertisedTotal } from "@/features/reservation/components/reservation-selection-summary";
import {
  illustratedReservationTypeOptionLayout,
  ReservationTypeInput,
  ReservationTypeOption,
} from "@/features/reservation/components/reservation-type-input";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import {
  useReservationSelectionUrl,
  useWatchedSelection,
} from "@/features/reservation/components/use-reservation-selection-url";
import {
  getCoworkCoffeeAdvertisedPriceRequest,
  getCoworkFormAdvertisedPriceRequests,
} from "@/features/reservation/cowork-advertised-price";
import {
  type CoworkReservationData,
  type CoworkReservationInput,
  coworkReservationSchema,
  getAllowedMonitorOptionsForCoworkTier,
  getCoworkCurrentReservationOrder,
  getCoworkReservationDefaultValues,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import { coworkSelectionLink } from "@/features/reservation/cowork-selection-link";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import {
  formatReservationInputDate,
  getCurrentWorkspaceDate,
} from "@/features/reservation/reservation-date";
import type { ReservationCheckoutCustomerForm } from "@/features/reservation/reservation-existing-customer";
import {
  getCoworkAvailabilityQueries,
  type PreloadedWorkspaceAvailability,
} from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Label } from "@/shared/components/ui/label";
import { formatMoney } from "@/shared/money/money";
import { cn } from "@/shared/utils";
import { CoworkOptionalAddonToggle } from "./cowork-optional-addon-toggle";
import { getCoworkReservationSelectionSummary } from "./cowork-reservation-selection-summary";

type CoworkReservationFormProps = {
  initialReservation?: NormalizedCoworkReservationOrder;
  initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  initialValues?: CoworkReservationInput;
  locale: Locale;
  checkoutSessionId?: CheckoutSessionId;
  checkoutCustomer: ReservationCheckoutCustomerForm;
  initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  replacementToken?: string;
  submittedCode?: CanonicalPromotionCode;
  /** The workspace date the server rendered, which anchors the calendar range. */
  today: string;
};

type CoworkReservationFormFallbackProps = Pick<
  CoworkReservationFormProps,
  "locale"
> & {
  showMonitorOption?: boolean;
};

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
  description: Parameters<typeof getWorkspaceProductMessage>[0];
}> = workspaceProductMonitorOptions.map((option) => ({
  value: option,
  description: workspaceProductMonitorDescriptionMessages[option],
}));

// The artwork spans 280% of the card's two-fifths illustration column, capped
// at 440px: about 340px in the two-card grid from md, else ~112vw - 128px.
const tierArtworkImage = {
  height: 941,
  sizes: "(min-width: 768px) 340px, min(440px, calc(112vw - 128px))",
  width: 1672,
} as const;

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
  checkoutCustomer,
  initialAvailability,
  replacementToken,
  submittedCode,
  today,
}: CoworkReservationFormProps) {
  const searchParams = useSearchParams();
  const defaultValues =
    initialValues ??
    (initialReservation
      ? getCoworkReservationDefaultValues(initialReservation)
      : coworkSelectionLink.read(searchParams));
  const form = useForm<CoworkReservationInput, unknown, CoworkReservationData>({
    resolver: effectSchemaResolver(coworkReservationSchema),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const selection = useWatchedSelection(coworkSelectionLink, form.control);
  const {
    entryTier: selectedTier,
    date: selectedDate,
    coffee: selectedCoffee,
    monitorOption: selectedMonitorOption,
  } = selection;
  useReservationSelectionUrl(coworkSelectionLink, selection);
  const showCoffeeAddon = getCoworkTierCoffeeAddon(selectedTier) === "optional";
  const showWorkstationAddon =
    getCoworkTierWorkstationAddon(selectedTier) === "optional";
  const allowedMonitorOptions =
    getAllowedMonitorOptionsForCoworkTier(selectedTier);
  const {
    range: rangeAvailabilityQuery,
    selection: availabilityQuery,
    workstationRequirement: workstationRequirementQuery,
  } = useMemo(
    () =>
      getCoworkAvailabilityQueries({
        date: selectedDate,
        entryTier: selectedTier,
        monitorOption: selectedMonitorOption,
        today,
      }),
    [selectedDate, selectedMonitorOption, selectedTier, today]
  );
  const availabilityQueryResult = useReservationAvailability(
    availabilityQuery,
    { initialAvailability, replacementToken }
  );
  const rangeAvailabilityQueryResult = useReservationAvailability(
    rangeAvailabilityQuery,
    { initialAvailability, replacementToken }
  );
  const workstationRequirementQueryResult = useReservationAvailability(
    workstationRequirementQuery,
    { initialAvailability, replacementToken }
  );
  const advertisedPriceRequests = useMemo(() => {
    if (!selectedDate) {
      return [];
    }

    return getCoworkFormAdvertisedPriceRequests({
      coffee: Boolean(selectedCoffee),
      date: selectedDate,
      locale,
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
    ? formatMoney(coffeePrice, locale)
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
    ? formatMoney(workstationPrice, locale)
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
  const isSelectionAvailabilityPending =
    availabilityQueryResult.isPending ||
    workstationRequirementQueryResult.isPending;
  const unavailableCalendarDates = new Set(
    (currentRangeAvailability?.unavailableDates ?? []).filter(
      (date) =>
        selectedTier !== "reserved-desk" ||
        !currentRangeAvailability?.reservedDeskWorkstationRequiredDates.includes(
          date
        )
    )
  );
  const currentTierAvailability =
    currentAvailability ?? currentRangeAvailability;
  const unavailableCoworkTiers = new Set(
    currentTierAvailability?.unavailableCoworkTiers ?? []
  );
  // Memoized because the workstation normalization effect depends on it.
  const unavailableMonitorOptions = useMemo(
    () =>
      new Set(
        currentWorkstationRequirementAvailability?.unavailableMonitorOptions ??
          []
      ),
    [currentWorkstationRequirementAvailability]
  );
  const selectedDateNotices = (currentAvailability?.notices ?? []).filter(
    (notice) => notice.date === selectedDate
  );
  const firstAvailableMonitorOption = allowedMonitorOptions.find(
    (option) => !unavailableMonitorOptions.has(option)
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
        unavailableMonitorOptions.has(selectedMonitorOption))
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
    !isSelectionAvailabilityPending
      ? m.reservationAvailabilityError({}, { locale })
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

        if (unavailableMonitorOptions.has(selectedMonitorOption)) {
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
    unavailableMonitorOptions,
  ]);

  return (
    <ReservationCheckoutForm
      checkoutCustomer={checkoutCustomer}
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
        total: advertisedPrice
          ? getReservationAdvertisedTotal(advertisedPrice.quote.payment)
          : undefined,
      }}
      availability={{
        isPending:
          isSelectionAvailabilityPending ||
          rangeAvailabilityQueryResult.isPending ||
          isWorkstationNormalizationPending,
        unavailableMessage:
          availabilityMessage ?? availabilityConfirmationErrorMessage,
      }}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getCoworkCurrentReservationOrder}
      locale={locale}
      selectionSummary={getCoworkReservationSelectionSummary(
        {
          entryTier: selectedTier,
          date: selectedDate,
          coffee: selectedCoffee,
          monitorOption: selectedMonitorOption,
        },
        locale
      )}
      selection={{
        kind: coworkSelectionLink.kind,
        fromSearchParams: (searchParams) =>
          coworkSelectionLink.readSelection(searchParams),
      }}
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
                onChange={(tier) => {
                  field.onChange(tier);
                  if (getCoworkTierWorkstationAddon(tier) !== "optional") {
                    autoAddedWorkstation.current = false;
                    form.setValue("monitorOption", undefined);
                  }
                  if (getCoworkTierCoffeeAddon(tier) !== "optional") {
                    form.setValue("coffee", true);
                  }
                }}
                presentation="illustrated"
                value={field.value}
              >
                {tierOptions.map((option) => {
                  const artworkSource = {
                    "open-space": openSpaceArtwork,
                    "reserved-desk":
                      selectedMonitorOption === undefined
                        ? reservedDeskArtwork
                        : reservedDeskWorkstationArtwork,
                  }[option.value];
                  const optionTitle = getWorkspaceProductMessage(
                    option.title,
                    locale
                  );
                  const isUnavailable = unavailableCoworkTiers.has(
                    option.value
                  );
                  const tierAdvertisedPrice = advertisedPricesByTier.get(
                    option.value
                  );
                  const advertisedProductItem =
                    tierAdvertisedPrice &&
                    getAdvertisedProductItem(tierAdvertisedPrice, {
                      kind: "cowork",
                      tier: option.value,
                    });
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
                          {...tierArtworkImage}
                          // The initially selected tier's artwork is the LCP.
                          {...(option.value === defaultValues.entryTier && {
                            fetchPriority: "high",
                            preload: true,
                          })}
                          src={artworkSource}
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

      <div data-cowork-date-addon-row className="grid gap-5 md:grid-cols-2">
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

/**
 * A tier card's description. The loading fallback's `placeholder` copy
 * leaves out the form's data hooks, so only the form's copy matches them.
 */
function CoworkTierDescription({
  locale,
  placeholder = false,
  tier,
}: {
  readonly locale: Locale;
  readonly placeholder?: boolean;
  readonly tier: WorkspaceCoworkCurrentTier;
}) {
  return (
    <div
      className="relative z-10 col-start-1 row-start-3 mb-3 min-h-[5.625rem] max-w-full break-words pt-1 text-sm leading-5 text-navy-blue/70"
      {...(!placeholder && {
        "data-cowork-tier-showcase": tier,
        "data-reservation-type-description": tier,
      })}
    >
      <span className="box-decoration-clone rounded-sm bg-white/85 px-1 py-0.5 group-has-[input:checked]:bg-[color:color-mix(in_srgb,var(--color-burned-orange)_8%,white)]/85">
        {getWorkspaceProductMessage(
          workspaceProductTierCardMessages[tier].description,
          locale
        )}
      </span>
    </div>
  );
}

/**
 * A tier card's perks. The loading fallback's `placeholder` copy leaves out
 * the form's data hooks and element IDs.
 */
function CoworkTierPerks({
  locale,
  placeholder = false,
  tier,
}: {
  readonly locale: Locale;
  readonly placeholder?: boolean;
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
      {...(!placeholder && { "data-reservation-type-perks": tier })}
    >
      {placeholder ? (
        <span className="sr-only">
          {getWorkspaceProductMessage(content.perksLabel, locale)}
        </span>
      ) : (
        <span id={perksLabelId} className="sr-only">
          {getWorkspaceProductMessage(content.perksLabel, locale)}
        </span>
      )}
      <ul
        {...(!placeholder && { "aria-labelledby": perksLabelId })}
        className="space-y-2"
      >
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
          <CoworkOptionalAddonToggle
            addon="coffee"
            checked={field.value}
            icon={Coffee}
            label={m.reservationCoffeeLabel({}, { locale })}
            onBlur={field.onBlur}
            onCheckedChange={(checked) => field.onChange(Boolean(checked))}
            priceLabel={priceLabel}
          >
            <FormMessage />
          </CoworkOptionalAddonToggle>
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
  const visibleMonitorOptions = monitorOptions.filter((option) =>
    allowedMonitorOptions.includes(option.value)
  );
  const isMonitorOptionDisabled = (option: WorkspaceProductMonitorOption) =>
    unavailableMonitorOptions.has(option) || !monitorOptionsAvailabilitySettled;
  const selectableMonitorOptions = visibleMonitorOptions.filter(
    (option) => !isMonitorOptionDisabled(option.value)
  );
  // RHF keeps one focus target per field, so validation focus lands on the
  // selected radio, or the first one the visitor can choose.
  const getMonitorFocusOption = (selectedOption: string | undefined) =>
    (
      selectableMonitorOptions.find(
        (option) => option.value === selectedOption
      ) ??
      selectableMonitorOptions[0] ??
      visibleMonitorOptions[0]
    )?.value;

  return (
    <FormField
      control={control}
      name="monitorOption"
      render={({ field }) => (
        <FormItem className="contents" data-cowork-addon-column>
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
          {field.value !== undefined && (
            <div
              data-cowork-monitor-options
              className="rounded-3xl border border-aquamarine-green/25 bg-aquamarine-green/8 p-4 md:col-span-2"
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
                  {visibleMonitorOptions.map((option) => {
                    const isSelected = field.value === option.value;
                    const isDisabled = isMonitorOptionDisabled(option.value);

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
                          ref={
                            option.value === getMonitorFocusOption(field.value)
                              ? field.ref
                              : undefined
                          }
                        />
                        <span className="block font-semibold text-navy-blue">
                          {getWorkspaceProductMonitorTitle(
                            option.value,
                            locale
                          )}
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
          <FormMessage className="md:col-span-2" />
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
            minimum={() => getCurrentWorkspaceDate().toString()}
            name={field.name}
            onBlur={field.onBlur}
            onChange={field.onChange}
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
  preloadDefaultTierArtwork();

  return (
    <SharedReservationFormFallback
      label={m.reservationFormTitle({}, { locale })}
      overview={
        <div className="space-y-2">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
            {m.reservationTierLabel({}, { locale })}
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {workspaceCoworkCurrentTiers.map((tier) => (
              <div
                className={cn(
                  illustratedReservationTypeOptionLayout,
                  "bg-white outline outline-1 -outline-offset-1 outline-navy-blue/10"
                )}
                key={tier}
              >
                <div className="col-start-1 col-end-3 row-start-1 mb-2 flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 break-words text-[1.375rem] font-semibold leading-7 lg:text-2xl lg:leading-8">
                    {getWorkspaceProductTierTitle(tier, locale)}
                  </p>
                  <span
                    aria-hidden="true"
                    className="mt-1 h-6 w-6 shrink-0 rounded-full border-2 border-navy-blue/25 sm:h-7 sm:w-7"
                  />
                </div>
                {/* Prices load with the form; the copy around them is static. */}
                <div
                  aria-hidden="true"
                  className="col-start-1 row-start-2 mb-2 py-1"
                >
                  <ReservationSkeletonBlock className="h-8 w-28 bg-aquamarine-green/15 lg:h-9" />
                </div>
                <CoworkTierDescription
                  locale={locale}
                  placeholder
                  tier={tier}
                />
                <CoworkTierPerks locale={locale} placeholder tier={tier} />
              </div>
            ))}
          </div>
        </div>
      }
    >
      <div className="grid gap-5 md:grid-cols-2">
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

/**
 * Starts the default tier artwork, the page's LCP, while the form streams in.
 * React dedupes it with the selected tier image's own preload.
 */
function preloadDefaultTierArtwork() {
  const { props } = getImageProps({
    ...tierArtworkImage,
    alt: "",
    fetchPriority: "high",
    src: openSpaceArtwork,
  });
  preload(props.src, {
    as: "image",
    fetchPriority: "high",
    imageSizes: props.sizes,
    imageSrcSet: props.srcSet,
  });
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
