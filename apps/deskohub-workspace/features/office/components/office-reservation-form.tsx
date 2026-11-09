"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Option, Schema } from "effect";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import type { PreloadedAdvertisedPrice } from "@/features/checkout/advertised-price";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { defaultPhoneRegion, type Locale, m } from "@/features/i18n";
import { ReservationAdvertisedPrice } from "@/features/reservation/components/reservation-advertised-price";
import { ReservationCheckoutForm } from "@/features/reservation/components/reservation-checkout-form";
import { ReservationFormDateInput } from "@/features/reservation/components/reservation-date-input";
import {
  ReservationCustomerFieldsFallback,
  ReservationFormFallback,
  ReservationSkeletonBlock,
  ReservationSkeletonField,
  ReservationSubmitFallback,
} from "@/features/reservation/components/reservation-form-fallback";
import { ReservationFormLabel } from "@/features/reservation/components/reservation-form-label";
import {
  ReservationTypeInput,
  ReservationTypeOption,
  reservationTypeInputLayout,
  reservationTypeOptionLayout,
} from "@/features/reservation/components/reservation-type-input";
import { useAdvertisedOptionPrices } from "@/features/reservation/components/use-advertised-option-prices";
import { useWatchedSelection } from "@/features/reservation/components/use-reservation-selection-url";
import {
  findOfficeSeatAdvertisedPriceRequest,
  getOfficeSeatAdvertisedPriceRequests,
  officeSeatOptions,
} from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationDayCount,
  getOfficeReservationEndsOn,
  getOfficeReservationOrder,
  getOfficeSeatOptions,
  type OfficeReservationData,
  type OfficeReservationInput,
  officeReservationDetailsSchema,
  officeReservationSchema,
} from "@/features/reservation/office-reservation";
import { officeSelectionLink } from "@/features/reservation/office-selection-link";
import type { ReservationCheckoutCustomerForm } from "@/features/reservation/reservation-existing-customer";
import type { PreloadedWorkspaceAvailability } from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { formatMoney } from "@/shared/money/money";
import { cn } from "@/shared/utils";
import { OfficeDayCountInput } from "./office-day-count-input";
import { getOfficeReservationSelectionSummary } from "./office-reservation-selection-summary";
import { useOfficeAvailability } from "./use-office-availability";
import { useOfficeDayCountBounds } from "./use-office-day-count-bounds";

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
    resolver: effectSchemaResolver(
      officeReservationSchema(defaultPhoneRegion(locale))
    ),
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
  const { availabilityResult, maximumEndsOn } = useOfficeAvailability({
    initialAvailability,
    replacementToken,
    today,
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
  const advertisedPrices = useAdvertisedOptionPrices({
    family: officeSeatOptions,
    initialAdvertisedPrices,
    productLabel: getWorkspaceOfficeProductTitle(locale),
    requests: advertisedPriceRequests,
    selected: findOfficeSeatAdvertisedPriceRequest(
      advertisedPriceRequests,
      seats
    ),
  });
  const advertisedOfficeQuoteItem =
    advertisedPrices.selectedPrice?.quote.items[0];
  const { availability, maximumDayCount, unavailableDates } =
    useOfficeDayCountBounds({
      availabilityResult,
      form,
      locale,
      maximumEndsOn,
      selection: watchedSelection,
    });
  const basePriceLabel = selection
    ? m.reservationOfficeBasePriceLabel(
        { dayCount: getOfficeReservationDayCount(selection) },
        { locale }
      )
    : getWorkspaceOfficeProductTitle(locale);

  return (
    <ReservationCheckoutForm
      checkoutCustomer={checkoutCustomer}
      advertisedPrice={advertisedPrices.checkout}
      availability={availability}
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
            render={({ field }) => (
              <FormItem>
                <ReservationFormLabel required>
                  {m.reservationOfficeStartDateLabel({}, { locale })}
                </ReservationFormLabel>
                <ReservationFormDateInput
                  {...field}
                  label={m.reservationOfficeStartDateLabel({}, { locale })}
                  locale={locale}
                  maximum={maximumEndsOn}
                  minimum={today}
                  unavailableDates={unavailableDates}
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
                  const seatRequest = findOfficeSeatAdvertisedPriceRequest(
                    advertisedPriceRequests,
                    seatCount
                  );
                  const seatPrice =
                    seatRequest && advertisedPrices.of(seatRequest)?.amount;

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
