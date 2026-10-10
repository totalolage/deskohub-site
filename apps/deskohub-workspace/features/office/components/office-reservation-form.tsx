"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { Option, Predicate, Schema } from "effect";
import { type ComponentProps, useEffect, useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPrice,
  isOfficeAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import {
  formatWorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
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
import {
  ReservationTypeInput,
  ReservationTypeOption,
} from "@/features/reservation/components/reservation-type-input";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import {
  getOfficeReservationDayCount,
  getOfficeReservationDefaultValues,
  getOfficeReservationEndsOn,
  getOfficeReservationMaximumDayCount,
  getOfficeReservationMaximumEndsOn,
  getOfficeReservationOrder,
  getOfficeSeatOptions,
  type NormalizedOfficeReservationOrder,
  type OfficeReservationData,
  type OfficeReservationInput,
  officeReservationDetailsSchema,
  officeReservationSchema,
} from "@/features/reservation/office-reservation";
import type { ReservationExistingCustomerForm } from "@/features/reservation/reservation-existing-customer";
import type { OfficeWorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";

type OfficeReservationFormProps = {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly existingCustomer?: ReservationExistingCustomerForm;
  readonly seatCapacity: number;
  readonly initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly initialReservation?: NormalizedOfficeReservationOrder;
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
  existingCustomer,
  seatCapacity,
  initialAdvertisedPrices = [],
  initialReservation,
  initialValues,
  locale,
  replacementToken,
  submittedCode,
  today,
}: OfficeReservationFormProps) {
  const defaultValues = initialReservation
    ? getOfficeReservationDefaultValues(initialReservation)
    : initialValues;
  const form = useForm<OfficeReservationInput, unknown, OfficeReservationData>({
    resolver: effectSchemaResolver(officeReservationSchema),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const [startsOn, dayCount, seats] = useWatch({
    control: form.control,
    name: ["startsOn", "dayCount", "seats"],
  });
  const selection = useMemo(
    () => getSelection(startsOn, dayCount, seats),
    [dayCount, seats, startsOn]
  );
  const maximumEndsOn = getOfficeReservationMaximumEndsOn(
    Temporal.PlainDate.from(today)
  ).toString();
  const availabilityQuery = useMemo(
    (): OfficeWorkspaceAvailabilityQuery => ({
      kind: "office",
      from: today,
      to: maximumEndsOn,
    }),
    [maximumEndsOn, today]
  );
  const availabilityResult = useReservationAvailability(availabilityQuery, {
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
  const unavailable = Boolean(
    startsOn &&
      (maximumDayCount === 0 ||
        (Predicate.isNumber(dayCount) && dayCount > maximumDayCount))
  );
  const availabilityMessage = unavailable
    ? m.reservationOfficeUnavailable({}, { locale })
    : undefined;
  const availabilityErrorMessage =
    availabilityResult.isError && !availabilityResult.isFetching
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
      existingCustomer={existingCustomer}
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
      }}
      availability={{
        isFetching: availabilityResult.isFetching,
        unavailableMessage: availabilityMessage ?? availabilityErrorMessage,
      }}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getOfficeReservationOrder}
      locale={locale}
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
                  placeholder={m.reservationDatePlaceholder({}, { locale })}
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
                className="flex flex-wrap gap-3 space-y-0"
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
                    ? workspaceMoneyWithValue(
                        quotedSeatAmount.value * seatCount,
                        quotedSeatAmount
                      )
                    : undefined;

                  return (
                    <ReservationTypeOption
                      key={seatCount}
                      className="flex-[1_1_13rem] pb-4 lg:row-start-auto lg:row-span-1 lg:grid-rows-none"
                      price={
                        seatPrice ? (
                          <span className="before:content-['+']">
                            {formatWorkspaceMoney(seatPrice, locale)}
                          </span>
                        ) : (
                          <ReservationSkeletonBlock className="h-4 w-24 bg-aquamarine-green/15" />
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

function OfficeDayCountInput({
  maximum,
  onBlur,
  onChange,
  value,
  ...props
}: Omit<ComponentProps<typeof Input>, "onChange" | "value"> & {
  readonly maximum: number;
  readonly onChange: (dayCount: number) => void;
  readonly value: number;
}) {
  // Keeps the visitor's raw text while editing so the field can be cleared and
  // retyped; the committed day count is clamped and the text resyncs on blur.
  const [draft, setDraft] = useState<string>();
  const clampDayCount = (dayCount: number) =>
    Math.min(Math.max(1, Math.trunc(dayCount)), maximum);

  return (
    <Input
      {...props}
      inputMode="numeric"
      max={maximum}
      min={1}
      onBlur={(event) => {
        setDraft(undefined);
        onBlur?.(event);
      }}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        const nextDayCount = Number(nextDraft);
        if (nextDraft.trim() !== "" && Number.isFinite(nextDayCount)) {
          onChange(clampDayCount(nextDayCount));
        }
      }}
      type="number"
      value={draft ?? value}
      required
    />
  );
}

export function OfficeReservationFormFallback({ locale }: { locale: Locale }) {
  return (
    <ReservationFormFallback
      label={m.reservationOfficeFormTitle({}, { locale })}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <ReservationSkeletonField />
        <ReservationSkeletonField />
      </div>
      <ReservationSkeletonBlock className="h-18 w-full rounded-[1.4rem]" />
      <div className="space-y-2">
        <ReservationSkeletonBlock className="h-4 w-64" />
        <ReservationSkeletonBlock className="h-26 w-full rounded-[1.4rem]" />
      </div>
      <ReservationCustomerFieldsFallback />
      <ReservationSubmitFallback />
    </ReservationFormFallback>
  );
}
