"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPrice,
  isMeetingRoomAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import { workspaceMeetingRoomDurationOptions } from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceMeetingRoomDurationTitle,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { ReservationAdvertisedPrice } from "@/features/reservation/components/reservation-advertised-price";
import { ReservationCheckoutForm } from "@/features/reservation/components/reservation-checkout-form";
import { ReservationDateTimePicker } from "@/features/reservation/components/reservation-date-time-picker";
import {
  ReservationCustomerFieldsFallback,
  ReservationFormFallback,
  ReservationSkeletonBlock,
  ReservationSubmitFallback,
} from "@/features/reservation/components/reservation-form-fallback";
import { ReservationFormLabel } from "@/features/reservation/components/reservation-form-label";
import {
  ReservationTypeInput,
  ReservationTypeOption,
} from "@/features/reservation/components/reservation-type-input";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import {
  getMeetingRoomReservationDefaultValues,
  getMeetingRoomReservationOrder,
  type MeetingRoomReservationData,
  type MeetingRoomReservationInput,
  meetingRoomReservationDefaultValues,
  meetingRoomReservationSchema,
  type NormalizedMeetingRoomReservationOrder,
} from "@/features/reservation/meeting-room-reservation";
import {
  getEarliestSelectableMeetingRoomStartDateTime,
  getMeetingRoomAvailabilityToDate,
  getMeetingRoomReservationDate,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import type { MeetingRoomWorkspaceAvailabilityQuery } from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";

type MeetingRoomReservationFormProps = {
  readonly checkoutSessionId?: string;
  readonly initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly initialReservation?: NormalizedMeetingRoomReservationOrder;
  readonly initialValues?: MeetingRoomReservationInput;
  readonly locale: Locale;
};

type MeetingRoomReservationFormFallbackProps = {
  readonly locale: Locale;
};

const meetingRoomReservationFormSchema = Schema.toStandardSchemaV1(
  meetingRoomReservationSchema
);

export function MeetingRoomReservationForm({
  checkoutSessionId,
  initialAdvertisedPrices = [],
  initialReservation,
  initialValues,
  locale,
}: MeetingRoomReservationFormProps) {
  const restoredInitialValues = useMemo(
    () =>
      initialReservation
        ? getMeetingRoomReservationDefaultValues(initialReservation)
        : undefined,
    [initialReservation]
  );
  const defaultValues = useMemo(
    () =>
      initialValues ??
      restoredInitialValues ?? { ...meetingRoomReservationDefaultValues },
    [initialValues, restoredInitialValues]
  );
  const form = useForm<
    MeetingRoomReservationInput,
    unknown,
    MeetingRoomReservationData
  >({
    resolver: standardSchemaResolver(meetingRoomReservationFormSchema),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const [selectedStartDateTime, selectedDurationMinutes] = useWatch({
    control: form.control,
    name: ["startDateTime", "durationMinutes"],
  });
  const isWholeDaySelected = selectedDurationMinutes === 1440;
  const selectedInterval = useMemo(
    () =>
      getMeetingRoomReservationInterval(
        selectedStartDateTime,
        selectedDurationMinutes
      ),
    [selectedDurationMinutes, selectedStartDateTime]
  );
  const preservesRestoredStart =
    Boolean(restoredInitialValues) &&
    selectedStartDateTime === defaultValues.startDateTime &&
    selectedDurationMinutes === defaultValues.durationMinutes;
  const availabilityQuery = useMemo(
    (): MeetingRoomWorkspaceAvailabilityQuery | undefined =>
      selectedInterval
        ? {
            kind: "meeting-room",
            from: getMeetingRoomReservationDate(selectedInterval),
            to: getMeetingRoomAvailabilityToDate(selectedInterval),
            startsAt: selectedInterval.startsAt,
            endsAt: selectedInterval.endsAt,
          }
        : undefined,
    [selectedInterval]
  );
  const availabilityQueryResult = useReservationAvailability(availabilityQuery);
  const { availability } = availabilityQueryResult;
  const isSelectedReservationUnavailable = Boolean(
    selectedInterval &&
      ((availability?.unavailableDates.length ?? 0) > 0 ||
        availability?.meetingRoomUnavailable)
  );
  const advertisedPriceRequests = useMemo(
    () =>
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale,
        minimumStartDateTime: preservesRestoredStart
          ? undefined
          : getEarliestSelectableMeetingRoomStartDateTime(),
        startDateTime: selectedStartDateTime,
      }),
    [locale, preservesRestoredStart, selectedStartDateTime]
  );
  const advertisedPriceQueryResults = useAdvertisedPrices(
    advertisedPriceRequests.map(({ request }) => request),
    initialAdvertisedPrices
  );
  const advertisedPricesByDuration = new Map<
    (typeof workspaceMeetingRoomDurationOptions)[number],
    Extract<AdvertisedPrice, { readonly kind: "meeting-room" }>
  >();

  for (const [index, queryResult] of advertisedPriceQueryResults.entries()) {
    const request = advertisedPriceRequests[index];
    if (
      request &&
      !queryResult.isError &&
      queryResult.data &&
      isMeetingRoomAdvertisedPrice(queryResult.data)
    ) {
      advertisedPricesByDuration.set(request.duration, queryResult.data);
    }
  }

  const selectedAdvertisedPriceIndex = advertisedPriceRequests.findIndex(
    ({ duration }) => duration === selectedDurationMinutes
  );
  const advertisedPriceQueryResult =
    advertisedPriceQueryResults[selectedAdvertisedPriceIndex];
  const advertisedPrice =
    advertisedPricesByDuration.get(selectedDurationMinutes) ?? null;

  return (
    <ReservationCheckoutForm
      advertisedPrice={{
        token: advertisedPrice?.advertisedPriceToken,
        isFetching: advertisedPriceQueryResult?.isFetching ?? false,
        isError: advertisedPriceQueryResult?.isError ?? false,
        retry: () => void advertisedPriceQueryResult?.refetch(),
      }}
      availability={{
        isFetching: availabilityQueryResult.isFetching,
        unavailableMessage: isSelectedReservationUnavailable
          ? m.reservationMeetingRoomUnavailable({}, { locale })
          : undefined,
      }}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getMeetingRoomReservationOrder}
      locale={locale}
      messagePlaceholder={m.reservationMeetingRoomMessagePlaceholder(
        {},
        { locale }
      )}
    >
      <FormField
        control={form.control}
        name="startDateTime"
        render={({ field, fieldState }) => (
          <FormItem>
            <ReservationFormLabel required>
              {isWholeDaySelected
                ? m.reservationDateLabel({}, { locale })
                : m.reservationMeetingRoomStartLabel({}, { locale })}
            </ReservationFormLabel>
            <ReservationDateTimePicker
              className={
                isWholeDaySelected
                  ? "grid-cols-1"
                  : "grid-cols-1 sm:grid-cols-2"
              }
              dateLabel={m.reservationMeetingRoomDateLabel({}, { locale })}
              locale={locale}
              minimum={getEarliestSelectableMeetingRoomStartDateTime}
              name={field.name}
              onBlur={field.onBlur}
              onChange={field.onChange}
              placeholder={m.reservationDatePlaceholder({}, { locale })}
              preserveValueBeforeMinimum={preservesRestoredStart}
              timeLabel={m.reservationMeetingRoomTimeLabel({}, { locale })}
              timeMode={isWholeDaySelected ? "midnight" : "selectable"}
              timeStepMinutes={60}
              value={field.value}
              variant={fieldState.error ? "error" : "default"}
            />
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="durationMinutes"
        render={({ field }) => (
          <FormItem>
            <ReservationFormLabel required>
              {m.reservationMeetingRoomDurationLabel({}, { locale })}
            </ReservationFormLabel>
            <FormControl>
              <ReservationTypeInput
                className="sm:grid-cols-3 sm:space-y-0 sm:gap-x-3"
                idPrefix="meeting-room-duration"
                inputRef={field.ref}
                name={field.name}
                onBlur={field.onBlur}
                onChange={field.onChange}
                value={field.value}
              >
                {workspaceMeetingRoomDurationOptions.map((duration) => {
                  const durationTitle = getWorkspaceMeetingRoomDurationTitle(
                    duration,
                    locale
                  );
                  const advertisedProductItem = advertisedPricesByDuration
                    .get(duration)
                    ?.summary.sections.find(({ key }) => key === "order")
                    ?.items.find(
                      (item) =>
                        "product" in item &&
                        item.product.kind === "meeting-room" &&
                        item.product.durationMinutes === duration
                    );
                  const advertisedDiscounts =
                    advertisedProductItem &&
                    "discounts" in advertisedProductItem
                      ? advertisedProductItem.discounts
                      : undefined;
                  const originalAmount =
                    advertisedProductItem &&
                    "originalAmount" in advertisedProductItem &&
                    advertisedProductItem.originalAmount
                      ? advertisedProductItem.originalAmount
                      : undefined;
                  const hasAdvertisedDiscounts = Boolean(
                    originalAmount && advertisedDiscounts?.length
                  );

                  return (
                    <ReservationTypeOption
                      key={duration}
                      className={`pb-4 ${
                        {
                          60: "sm:col-start-1 lg:col-start-1",
                          240: "sm:col-start-2 lg:col-start-2",
                          1440: "sm:col-start-3 lg:col-start-3",
                        }[duration]
                      }`}
                      discount={
                        hasAdvertisedDiscounts && advertisedDiscounts
                          ? {
                              labels: advertisedDiscounts.map(
                                ({ discount }) => ({
                                  id: discount.id,
                                  label: discount.label,
                                })
                              ),
                              details: (
                                <CheckoutSummaryDiscountDetails
                                  discounts={advertisedDiscounts}
                                  locale={locale}
                                  productLabel={durationTitle}
                                />
                              ),
                            }
                          : undefined
                      }
                      price={
                        advertisedProductItem ? (
                          <ReservationAdvertisedPrice
                            amount={advertisedProductItem.amount}
                            locale={locale}
                            originalAmount={
                              hasAdvertisedDiscounts
                                ? originalAmount
                                : undefined
                            }
                          />
                        ) : (
                          <ReservationSkeletonBlock className="h-4 w-24 bg-aquamarine-green/15" />
                        )
                      }
                      priceReady={Boolean(advertisedProductItem)}
                      title={getWorkspaceMeetingRoomDurationLabel(
                        duration,
                        locale
                      )}
                      value={duration}
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

export function MeetingRoomReservationFormFallback({
  locale,
}: MeetingRoomReservationFormFallbackProps) {
  return (
    <ReservationFormFallback
      label={m.reservationMeetingRoomFormTitle({}, { locale })}
    >
      <div className="space-y-2">
        <ReservationSkeletonBlock className="h-4 w-40" />
        <div className="grid gap-3 sm:grid-cols-2">
          <ReservationSkeletonBlock className="h-13 w-full rounded-[1.1rem]" />
          <ReservationSkeletonBlock className="h-13 w-full rounded-[1.1rem]" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <ReservationSkeletonBlock className="h-31 rounded-[1.4rem]" />
        <ReservationSkeletonBlock className="h-31 rounded-[1.4rem]" />
        <ReservationSkeletonBlock className="h-31 rounded-[1.4rem]" />
      </div>
      <ReservationCustomerFieldsFallback />
      <ReservationSubmitFallback />
    </ReservationFormFallback>
  );
}
