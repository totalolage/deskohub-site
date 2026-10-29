"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Option, Predicate, Schema } from "effect";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import {
  type AdvertisedPrice,
  isOfficeAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { ReservationAdvertisedPrice } from "@/features/reservation/components/reservation-advertised-price";
import { ReservationCheckoutForm } from "@/features/reservation/components/reservation-checkout-form";
import { ReservationFormDatePicker } from "@/features/reservation/components/reservation-date-picker";
import {
  ReservationCustomerFieldsFallback,
  ReservationFormFallback,
  ReservationSkeletonBlock,
  ReservationSkeletonField,
  ReservationSubmitFallback,
} from "@/features/reservation/components/reservation-form-fallback";
import { ReservationFormLabel } from "@/features/reservation/components/reservation-form-label";
import { getReservationAdvertisedTotal } from "@/features/reservation/components/reservation-selection-summary";
import {
  ReservationTypeInput,
  ReservationTypeOption,
  reservationTypeInputLayout,
  reservationTypeOptionLayout,
} from "@/features/reservation/components/reservation-type-input";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import {
  useReservationSelectionUrl,
  useWatchedSelection,
} from "@/features/reservation/components/use-reservation-selection-url";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationDayCount,
  getOfficeReservationEndsOn,
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
  getOfficeReservationOrder,
  getOfficeSeatOptions,
  type OfficeReservationData,
  type OfficeReservationInput,
  officeReservationDetailsSchema,
  officeReservationSchema,
} from "@/features/reservation/office-reservation";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import type { ReservationCheckoutCustomerForm } from "@/features/reservation/reservation-existing-customer";
import {
  getOfficeAvailabilityQuery,
  type PreloadedWorkspaceAvailability,
} from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { formatMoney, moneyWithValue } from "@/shared/money/money";
import { cn } from "@/shared/utils";
import { OfficeDayCountInput } from "./office-day-count-input";
import { getOfficeReservationSelectionSummary } from "./office-reservation-selection-summary";

type OfficeReservationFormProps = {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly seatCapacity: number;
  readonly initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly initialValues: OfficeReservationInput;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly submittedCode?: CanonicalPromotionCode;
  readonly today: string;
};

const decodeSelection = Schema.decodeUnknownOption(
  officeReservationDetailsSchema
);

const getSelection = (
  startsOn: string | undefined,
  dayCount: number | undefined,
  seats: number | undefined
) => {
  if (!(startsOn && dayCount)) return undefined;

  return Option.getOrUndefined(
    decodeSelection({
      kind: "office",
      startsOn,
      endsOn: getOfficeReservationEndsOn({ startsOn, dayCount }),
      seats,
    })
  );
};

export function OfficeReservationForm({
  checkoutSessionId,
  checkoutCustomer,
  seatCapacity,
  initialAdvertisedPrices = [],
  initialAvailability,
  initialValues,
  locale,
  replacementToken,
  submittedCode,
  today,
}: OfficeReservationFormProps) {
  const form = useForm<OfficeReservationInput, unknown, OfficeReservationData>({
    resolver: effectSchemaResolver(officeReservationSchema),
    defaultValues: initialValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const watchedSelection = useWatchedSelection(
    officeSelectionLink,
    form.control
  );
  const { startsOn, dayCount, seats } = watchedSelection;
  const selection = useMemo(
    () => getSelection(startsOn, dayCount, seats),
    [dayCount, seats, startsOn]
  );
  const maximumEndsOn = getOfficeReservationMaximumEndsOn(
    Temporal.PlainDate.from(today)
  ).toString();
  const availabilityQuery = useMemo(
    () => getOfficeAvailabilityQuery(today),
    [today]
  );
  const availabilityResult = useReservationAvailability(availabilityQuery, {
    initialAvailability,
    replacementToken,
  });
  const advertisedPriceRequests = useMemo(
    () =>
      selection
        ? getOfficeSeatAdvertisedPriceRequests({
            seatCapacity,
            locale,
            startsOn: selection.startsOn,
            endsOn: selection.endsOn,
            submittedCode,
          })
        : [],
    [seatCapacity, locale, selection, submittedCode]
  );
  const advertisedPriceResults = useAdvertisedPrices(
    advertisedPriceRequests,
    initialAdvertisedPrices
  );
  const advertisedPricesBySeats = new Map<
    number,
    Extract<AdvertisedPrice, { readonly kind: "office" }>
  >();

  for (const [index, result] of advertisedPriceResults.entries()) {
    const request = advertisedPriceRequests[index];
    if (
      request &&
      !result.isError &&
      result.data &&
      isOfficeAdvertisedPrice(result.data)
    ) {
      advertisedPricesBySeats.set(
        request.reservation.details.seats,
        result.data
      );
    }
  }

  const selectedAdvertisedPriceIndex = advertisedPriceRequests.findIndex(
    (request) => request.reservation.details.seats === seats
  );
  const advertisedPriceResult =
    advertisedPriceResults[selectedAdvertisedPriceIndex];
  const advertisedPrice = Predicate.isNumber(seats)
    ? advertisedPricesBySeats.get(seats)
    : undefined;
  const advertisedOfficeQuoteItem = advertisedPrice?.quote.items[0];
  const unavailableDates = useMemo(
    () => new Set(availabilityResult.availability?.unavailableDates ?? []),
    [availabilityResult.availability]
  );
  const maximumDayCount = startsOn
    ? getOfficeReservationMaximumDayCount({
        startsOn,
        maximumEndsOn: Temporal.PlainDate.from(maximumEndsOn),
        unavailableDates: [...unavailableDates],
      })
    : 0;
  useEffect(() => {
    if (
      maximumDayCount > 0 &&
      Predicate.isNumber(dayCount) &&
      dayCount > maximumDayCount
    ) {
      form.setValue("dayCount", maximumDayCount, { shouldValidate: true });
    }
  }, [dayCount, form, maximumDayCount]);
  useReservationSelectionUrl(
    officeSelectionLink,
    startsOn && Predicate.isNumber(dayCount) && dayCount <= maximumDayCount
      ? watchedSelection
      : undefined
  );
  const unavailable = Boolean(
    startsOn &&
      (maximumDayCount === 0 ||
        (Predicate.isNumber(dayCount) && dayCount > maximumDayCount))
  );
  const availabilityMessage = unavailable
    ? m.reservationOfficeUnavailable({}, { locale })
    : undefined;
  const availabilityErrorMessage =
    availabilityResult.isError && !availabilityResult.isPending
      ? m.reservationAvailabilityError({}, { locale })
      : undefined;
  const basePriceLabel = selection
    ? m.reservationOfficeBasePriceLabel(
        { dayCount: getOfficeReservationDayCount(selection) },
        { locale }
      )
    : getWorkspaceOfficeProductTitle(locale);

  return (
    <ReservationCheckoutForm
      checkoutCustomer={checkoutCustomer}
      advertisedPrice={{
        token: advertisedPrice?.advertisedPriceToken,
        isFetching: advertisedPriceResult?.isFetching ?? false,
        isError: advertisedPriceResult?.isError ?? false,
        retry: () => void advertisedPriceResult?.refetch(),
        sale: advertisedPrice
          ? {
              discounts: advertisedPrice.quote.payment.discounts,
              productLabel: getWorkspaceOfficeProductTitle(locale),
            }
          : undefined,
        total: advertisedPrice
          ? getReservationAdvertisedTotal(advertisedPrice.quote.payment)
          : undefined,
      }}
      availability={{
        isPending: availabilityResult.isPending,
        unavailableMessage: availabilityMessage ?? availabilityErrorMessage,
      }}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getOfficeReservationOrder}
      locale={locale}
      selectionSummary={getOfficeReservationSelectionSummary(
        { startsOn, dayCount, seats },
        locale
      )}
      selection={{
        kind: officeSelectionLink.kind,
        fromSearchParams: (searchParams) =>
          officeSelectionLink.readSelection(searchParams, {
            seatCapacity,
            today,
          }),
      }}
    >
      <fieldset className="flex flex-col gap-y-2">
        <legend className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72 after:content-['_*']">
          {m.reservationOfficeDateRangeLabel({}, { locale })}
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="startsOn"
            render={({ field, fieldState }) => (
              <FormItem>
                <ReservationFormLabel required>
                  {m.reservationOfficeStartDateLabel({}, { locale })}
                </ReservationFormLabel>
                <ReservationFormDatePicker
                  ariaLabel={m.reservationOfficeStartDateLabel({}, { locale })}
                  isDateDisabled={(date) =>
                    unavailableDates.has(date.toString())
                  }
                  locale={locale}
                  maximum={maximumEndsOn}
                  minimum={today}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={field.onChange}
                  value={field.value}
                  variant={fieldState.error ? "error" : "default"}
                />
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="dayCount"
            render={({ field, fieldState }) => (
              <FormItem>
                <ReservationFormLabel required>
                  {m.reservationOfficeDayCountLabel({}, { locale })}
                </ReservationFormLabel>
                <FormControl>
                  <OfficeDayCountInput
                    disabled={maximumDayCount === 0}
                    maximum={Math.max(1, maximumDayCount)}
                    name={field.name}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    ref={field.ref}
                    value={field.value}
                    variant={fieldState.error ? "error" : "default"}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </fieldset>

      <div
        className="rounded-[1.4rem] border border-aquamarine-green/25 bg-aquamarine-green/8 px-5 py-4"
        data-office-base-price
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="font-semibold text-navy-blue">{basePriceLabel}</span>
          {advertisedOfficeQuoteItem ? (
            <ReservationAdvertisedPrice
              amount={advertisedOfficeQuoteItem.accessAmount}
              className="text-lg font-bold"
              locale={locale}
            />
          ) : (
            <ReservationSkeletonBlock className="h-5 w-28 bg-aquamarine-green/15" />
          )}
        </div>
      </div>

      <FormField
        control={form.control}
        name="seats"
        render={({ field }) => (
          <FormItem>
            <ReservationFormLabel required>
              {m.reservationOfficeSeatCountLabel({}, { locale })}
            </ReservationFormLabel>
            <FormControl>
              <ReservationTypeInput
                aria-required="true"
                className={officeSeatOptionsLayout}
                idPrefix="office-seats"
                inputRef={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                onChange={(value) => field.onChange(Number(value))}
                value={String(field.value)}
              >
                {getOfficeSeatOptions(seatCapacity).map((seatCount) => {
                  const optionTitle = m.reservationOfficeSeatCountOption(
                    { count: seatCount },
                    { locale }
                  );
                  const optionAdvertisedPrice =
                    advertisedPricesBySeats.get(seatCount);
                  const quotedSeatAmount =
                    optionAdvertisedPrice?.quote.items[0].seatAmount;
                  const seatPrice = quotedSeatAmount
                    ? moneyWithValue(
                        quotedSeatAmount.value * seatCount,
                        quotedSeatAmount
                      )
                    : undefined;

                  return (
                    <ReservationTypeOption
                      key={seatCount}
                      className={officeSeatOptionLayout}
                      price={
                        seatPrice ? (
                          <span className="before:content-['+']">
                            {formatMoney(seatPrice, locale)}
                          </span>
                        ) : (
                          <ReservationSkeletonBlock className="h-5 w-24 bg-aquamarine-green/15" />
                        )
                      }
                      priceReady={Boolean(seatPrice)}
                      title={optionTitle}
                      value={String(seatCount)}
                    />
                  );
                })}
              </ReservationTypeInput>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </ReservationCheckoutForm>
  );
}

/** Seat cards wrap and share each row, balancing any office capacity. */
const officeSeatOptionsLayout = "flex flex-wrap gap-3 space-y-0";
const officeSeatOptionLayout =
  "flex-[1_1_13rem] pb-4 lg:row-start-auto lg:row-span-1 lg:grid-rows-none";

/**
 * How many seat cards the loading fallback shows. The office capacity comes
 * from Dotypos inside the streamed content, so the fallback can only estimate
 * it.
 */
export const officeSeatOptionsFallbackCount = 4;

export function OfficeReservationFormFallback({ locale }: { locale: Locale }) {
  return (
    <ReservationFormFallback
      label={m.reservationOfficeFormTitle({}, { locale })}
    >
      <div className="flex flex-col gap-y-2">
        <ReservationSkeletonBlock className="h-4 w-40" />
        <div className="grid gap-3 sm:grid-cols-2">
          <ReservationSkeletonField />
          <ReservationSkeletonField />
        </div>
      </div>
      <ReservationSkeletonBlock className="h-18 w-full rounded-[1.4rem]" />
      <div className="space-y-2">
        <ReservationSkeletonBlock className="h-4 w-64" />
        <div
          className={cn(reservationTypeInputLayout, officeSeatOptionsLayout)}
        >
          {getOfficeSeatOptions(officeSeatOptionsFallbackCount).map(
            (seatCount) => (
              <div
                key={seatCount}
                className={cn(
                  reservationTypeOptionLayout,
                  officeSeatOptionLayout,
                  "bg-white outline outline-1 -outline-offset-1 outline-navy-blue/10"
                )}
                data-office-seat-option-fallback=""
              >
                <div className="mt-4 mb-3 flex items-start justify-between gap-2">
                  <ReservationSkeletonBlock className="h-6 w-20" />
                  <ReservationSkeletonBlock className="mt-1 h-4 w-4 shrink-0" />
                </div>
                <div className="mb-3 flex">
                  <ReservationSkeletonBlock className="h-5 w-24 bg-aquamarine-green/15" />
                </div>
              </div>
            )
          )}
        </div>
      </div>
      <ReservationCustomerFieldsFallback />
      <ReservationSubmitFallback />
    </ReservationFormFallback>
  );
}
