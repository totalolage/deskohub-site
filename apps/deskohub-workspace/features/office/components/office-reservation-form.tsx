"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Option, Schema } from "effect";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPrice,
  isOfficeAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
import {
  formatWorkspaceMoney,
  workspaceMoneyWithValue,
} from "@/features/checkout/workspace-money";
import { type Locale, m } from "@/features/i18n";
import { ReservationAdvertisedPrice } from "@/features/reservation/components/reservation-advertised-price";
import { ReservationCheckoutForm } from "@/features/reservation/components/reservation-checkout-form";
import { ReservationDatePicker } from "@/features/reservation/components/reservation-date-picker";
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
  getOfficeReservationDefaultValues,
  getOfficeReservationIntervalInput,
  getOfficeReservationOrder,
  getOfficeSeatOptions,
  type NormalizedOfficeReservationOrder,
  type OfficeReservationData,
  type OfficeReservationInput,
  officeReservationDetailsSchema,
  officeReservationSchema,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { OfficeWorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";

type OfficeReservationFormProps = {
  readonly checkoutSessionId?: string;
  readonly seatCapacity: number;
  readonly initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly initialReservation?: NormalizedOfficeReservationOrder;
  readonly initialValues: OfficeReservationInput;
  readonly locale: Locale;
  readonly replacementToken?: string;
};

const officeReservationFormSchema = Schema.toStandardSchemaV1(
  officeReservationSchema
);
const decodeSelection = Schema.decodeUnknownOption(
  officeReservationDetailsSchema
);
const fallbackSeatCards = ["seat-1", "seat-2", "seat-3", "seat-4"];

const getSelection = (
  startsOn: string | undefined,
  endsOn: string | undefined,
  seats: number | undefined
) =>
  Option.getOrUndefined(
    decodeSelection({ kind: "office", startsOn, endsOn, seats })
  );

export function OfficeReservationForm({
  checkoutSessionId,
  seatCapacity,
  initialAdvertisedPrices = [],
  initialReservation,
  initialValues,
  locale,
  replacementToken,
}: OfficeReservationFormProps) {
  const defaultValues = useMemo(
    () =>
      initialReservation
        ? getOfficeReservationDefaultValues(initialReservation)
        : initialValues,
    [initialReservation, initialValues]
  );
  const form = useForm<OfficeReservationInput, unknown, OfficeReservationData>({
    resolver: standardSchemaResolver(officeReservationFormSchema),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const [startsOn, endsOn, seats] = useWatch({
    control: form.control,
    name: ["startsOn", "endsOn", "seats"],
  });
  const selection = useMemo(
    () => getSelection(startsOn, endsOn, seats),
    [endsOn, seats, startsOn]
  );
  const availabilityQuery = useMemo(():
    | OfficeWorkspaceAvailabilityQuery
    | undefined => {
    if (!selection) return undefined;
    const interval = getOfficeReservationIntervalInput(selection);
    return {
      kind: "office",
      from: selection.startsOn,
      to: selection.endsOn,
      startsAt: interval.startsAt,
      endsAt: interval.endsAt,
      seats: selection.seats,
    };
  }, [selection]);
  const availabilityResult = useReservationAvailability(availabilityQuery, {
    debounceMs: 250,
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
          })
        : [],
    [seatCapacity, locale, selection]
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
    if (request && result.data && isOfficeAdvertisedPrice(result.data)) {
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
  const advertisedPrice =
    typeof seats === "number" ? advertisedPricesBySeats.get(seats) : undefined;
  const advertisedOfficeQuoteItem = advertisedPrice?.quote.items[0];
  const unavailableDates = useMemo(
    () => new Set(availabilityResult.availability?.unavailableDates ?? []),
    [availabilityResult.availability]
  );
  const unavailable = Boolean(
    selection &&
      (availabilityResult.availability?.officeUnavailable ||
        availabilityResult.availability?.unavailableDates.length)
  );
  const minimumDate = getCurrentWorkspaceDate().toString();

  return (
    <ReservationCheckoutForm
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
        unavailableMessage: unavailable
          ? m.reservationOfficeUnavailable({}, { locale })
          : undefined,
      }}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getOfficeReservationOrder}
      locale={locale}
      messagePlaceholder={m.reservationOfficeMessagePlaceholder({}, { locale })}
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
                <p className="text-xs font-semibold text-navy-blue/55">
                  {m.reservationOfficeStartDateLabel({}, { locale })}
                </p>
                <ReservationDatePicker
                  ariaLabel={m.reservationOfficeStartDateLabel({}, { locale })}
                  isDateDisabled={(date) =>
                    unavailableDates.has(date.toString())
                  }
                  locale={locale}
                  minimum={minimumDate}
                  name={field.name}
                  onChange={(value) => {
                    field.onChange(value);
                    if (!endsOn || endsOn < value) {
                      form.setValue("endsOn", value, { shouldValidate: true });
                    }
                  }}
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
            name="endsOn"
            render={({ field, fieldState }) => (
              <FormItem>
                <p className="text-xs font-semibold text-navy-blue/55">
                  {m.reservationOfficeEndDateLabel({}, { locale })}
                </p>
                <ReservationDatePicker
                  ariaLabel={m.reservationOfficeEndDateLabel({}, { locale })}
                  isDateDisabled={(date) =>
                    unavailableDates.has(date.toString())
                  }
                  locale={locale}
                  minimum={startsOn || minimumDate}
                  name={field.name}
                  onChange={field.onChange}
                  placeholder={m.reservationDatePlaceholder({}, { locale })}
                  value={field.value}
                  variant={fieldState.error ? "error" : "default"}
                />
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
          <span className="font-semibold text-navy-blue">
            {getWorkspaceOfficeProductTitle(locale)}
          </span>
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
                className="space-y-0 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-none"
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
                      className="pb-4 lg:row-start-auto lg:row-span-1 lg:grid-rows-none"
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {fallbackSeatCards.map((card) => (
            <ReservationSkeletonBlock
              key={card}
              className="h-26 w-full rounded-[1.4rem]"
            />
          ))}
        </div>
      </div>
      <ReservationCustomerFieldsFallback />
      <ReservationSubmitFallback />
    </ReservationFormFallback>
  );
}
