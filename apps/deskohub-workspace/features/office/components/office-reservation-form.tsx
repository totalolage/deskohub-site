"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPrice,
  isOfficeAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import { getWorkspaceOfficeProductTitle } from "@/features/checkout/product-catalog.i18n";
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
import { getOfficeAdditionalSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import {
  getOfficeAdditionalSeatOptions,
  getOfficeReservationDefaultValues,
  getOfficeReservationGuestCount,
  getOfficeReservationIntervalInput,
  getOfficeReservationOrder,
  type NormalizedOfficeReservationOrder,
  type OfficeReservationData,
  type OfficeReservationInput,
  officeReservationSchema,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import type { OfficeWorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { plainDateStringSchema } from "@/shared/utils/temporal";

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
const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);
const fallbackSeatCards = ["seat-1", "seat-2", "seat-3", "seat-4"];

const getSelection = (
  startsOn: string | undefined,
  endsOn: string | undefined,
  additionalGuests: number | undefined
) => {
  if (
    !startsOn ||
    !endsOn ||
    endsOn < startsOn ||
    typeof additionalGuests !== "number" ||
    !Number.isInteger(additionalGuests) ||
    additionalGuests < 0
  ) {
    return undefined;
  }

  try {
    const normalizedStartsOn = decodePlainDate(startsOn);
    const normalizedEndsOn = decodePlainDate(endsOn);
    return {
      kind: "office" as const,
      startsOn: normalizedStartsOn,
      endsOn: normalizedEndsOn,
      additionalGuests,
    };
  } catch {
    return undefined;
  }
};

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
  const [startsOn, endsOn, additionalGuests] = useWatch({
    control: form.control,
    name: ["startsOn", "endsOn", "additionalGuests"],
  });
  const selection = useMemo(
    () => getSelection(startsOn, endsOn, additionalGuests),
    [additionalGuests, endsOn, startsOn]
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
      guestCount: getOfficeReservationGuestCount(selection),
    };
  }, [selection]);
  const availabilityResult = useReservationAvailability(availabilityQuery, {
    debounceMs: 250,
    replacementToken,
  });
  const advertisedPriceRequests = useMemo(
    () =>
      selection
        ? getOfficeAdditionalSeatAdvertisedPriceRequests({
            seatCapacity,
            locale,
            startsOn: selection.startsOn,
            endsOn: selection.endsOn,
          })
        : [],
    [seatCapacity, locale, selection]
  );
  const advertisedPriceResults = useAdvertisedPrices(
    advertisedPriceRequests.map(({ request }) => request),
    initialAdvertisedPrices
  );
  const advertisedPricesByAdditionalGuests = new Map<
    number,
    Extract<AdvertisedPrice, { readonly kind: "office" }>
  >();

  for (const [index, result] of advertisedPriceResults.entries()) {
    const request = advertisedPriceRequests[index];
    if (request && result.data && isOfficeAdvertisedPrice(result.data)) {
      advertisedPricesByAdditionalGuests.set(
        request.additionalGuests,
        result.data
      );
    }
  }

  const selectedAdvertisedPriceIndex = advertisedPriceRequests.findIndex(
    (request) => request.additionalGuests === additionalGuests
  );
  const advertisedPriceResult =
    advertisedPriceResults[selectedAdvertisedPriceIndex];
  const advertisedPrice =
    typeof additionalGuests === "number"
      ? advertisedPricesByAdditionalGuests.get(additionalGuests)
      : undefined;
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

      <FormField
        control={form.control}
        name="additionalGuests"
        render={({ field }) => (
          <FormItem>
            <ReservationFormLabel required>
              {m.reservationOfficeAdditionalGuestsLabel({}, { locale })}
            </ReservationFormLabel>
            <FormControl>
              <ReservationTypeInput
                className="space-y-0 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-none"
                idPrefix="office-additional-seats"
                inputRef={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                onChange={(value) => field.onChange(Number(value))}
                value={String(field.value)}
              >
                {getOfficeAdditionalSeatOptions(seatCapacity).map(
                  (additional) => {
                    const optionTitle =
                      additional === 0
                        ? m.reservationOfficeNoAdditionalGuestsOption(
                            {},
                            { locale }
                          )
                        : m.reservationOfficeAdditionalGuestsOption(
                            { count: additional },
                            { locale }
                          );
                    const productItem = advertisedPricesByAdditionalGuests
                      .get(additional)
                      ?.summary.sections.find(({ key }) => key === "order")
                      ?.items.find(
                        (item) =>
                          "product" in item && item.product.kind === "office"
                      );
                    const discounts =
                      productItem && "discounts" in productItem
                        ? productItem.discounts
                        : undefined;
                    const originalAmount =
                      productItem && "originalAmount" in productItem
                        ? productItem.originalAmount
                        : undefined;
                    const hasDiscounts = Boolean(
                      discounts?.length && originalAmount
                    );

                    return (
                      <ReservationTypeOption
                        key={additional}
                        className="pb-4 lg:row-start-auto lg:row-span-1"
                        discount={
                          hasDiscounts && discounts
                            ? {
                                labels: discounts.map(({ discount }) => ({
                                  id: discount.id,
                                  label: discount.label,
                                })),
                                details: (
                                  <CheckoutSummaryDiscountDetails
                                    discounts={discounts}
                                    locale={locale}
                                    productLabel={getWorkspaceOfficeProductTitle(
                                      locale
                                    )}
                                  />
                                ),
                              }
                            : undefined
                        }
                        price={
                          productItem ? (
                            <ReservationAdvertisedPrice
                              amount={productItem.amount}
                              locale={locale}
                              originalAmount={
                                hasDiscounts ? originalAmount : undefined
                              }
                              suffix={m.reservationOfficePriceSuffix(
                                {},
                                { locale }
                              )}
                            />
                          ) : (
                            <ReservationSkeletonBlock className="h-4 w-24 bg-aquamarine-green/15" />
                          )
                        }
                        priceReady={Boolean(productItem)}
                        title={optionTitle}
                        value={String(additional)}
                      />
                    );
                  }
                )}
              </ReservationTypeInput>
            </FormControl>
            <FormDescription>
              {m.reservationOfficeAdditionalGuestsDescription({}, { locale })}
            </FormDescription>
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
