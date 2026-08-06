"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
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
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import { getOfficeAdvertisedPriceRequest } from "@/features/reservation/office-advertised-price";
import {
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
import { Input } from "@/shared/components/ui/input";
import { plainDateStringSchema } from "@/shared/utils/temporal";

type OfficeReservationFormProps = {
  readonly checkoutSessionId?: string;
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
  const advertisedPriceRequest = useMemo(
    () =>
      selection
        ? getOfficeAdvertisedPriceRequest({ ...selection, locale })
        : undefined,
    [locale, selection]
  );
  const [advertisedPriceResult] = useAdvertisedPrices(
    advertisedPriceRequest ? [advertisedPriceRequest] : [],
    initialAdvertisedPrices
  );
  const advertisedPrice =
    advertisedPriceResult?.data &&
    isOfficeAdvertisedPrice(advertisedPriceResult.data)
      ? advertisedPriceResult.data
      : undefined;
  const productItem = advertisedPrice?.summary.sections
    .find(({ key }) => key === "order")
    ?.items.find((item) => "product" in item && item.product.kind === "office");
  const discounts =
    productItem && "discounts" in productItem
      ? productItem.discounts
      : undefined;
  const originalAmount =
    productItem && "originalAmount" in productItem
      ? productItem.originalAmount
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
        render={({ field, fieldState }) => (
          <FormItem>
            <ReservationFormLabel required>
              {m.reservationOfficeAdditionalGuestsLabel({}, { locale })}
            </ReservationFormLabel>
            <FormControl>
              <Input
                inputMode="numeric"
                min={0}
                name={field.name}
                onBlur={field.onBlur}
                onChange={(event) => field.onChange(event.target.valueAsNumber)}
                ref={field.ref}
                step={1}
                type="number"
                value={field.value}
                variant={fieldState.error ? "error" : "default"}
              />
            </FormControl>
            <FormDescription>
              {m.reservationOfficeAdditionalGuestsDescription({}, { locale })}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="rounded-[1.4rem] border border-aquamarine-green/25 bg-aquamarine-green/8 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="font-semibold text-navy-blue">
            {getWorkspaceOfficeProductTitle(locale)}
          </span>
          {productItem ? (
            <ReservationAdvertisedPrice
              amount={productItem.amount}
              className="text-lg font-bold"
              locale={locale}
              originalAmount={originalAmount}
              suffix={m.reservationOfficePriceSuffix({}, { locale })}
            />
          ) : (
            <ReservationSkeletonBlock className="h-5 w-28 bg-aquamarine-green/15" />
          )}
        </div>
        {discounts?.length && originalAmount ? (
          <div className="mt-3">
            <CheckoutSummaryDiscountDetails
              discounts={discounts}
              locale={locale}
              productLabel={getWorkspaceOfficeProductTitle(locale)}
            />
          </div>
        ) : null}
      </div>
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
      <ReservationSkeletonField />
      <ReservationSkeletonBlock className="h-18 w-full rounded-[1.4rem]" />
      <ReservationCustomerFieldsFallback />
      <ReservationSubmitFallback />
    </ReservationFormFallback>
  );
}
