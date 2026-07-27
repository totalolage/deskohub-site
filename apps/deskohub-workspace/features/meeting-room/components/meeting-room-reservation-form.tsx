"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Schema } from "effect";
import { useMemo } from "react";
import { useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPriceRequest,
  isMeetingRoomAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
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
import { useAdvertisedPrice } from "@/features/reservation/components/use-advertised-price";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
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
import { cn } from "@/shared/utils";

type MeetingRoomReservationFormProps = {
  readonly checkoutSessionId?: string;
  readonly initialReservation?: NormalizedMeetingRoomReservationOrder;
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
  initialReservation,
  locale,
}: MeetingRoomReservationFormProps) {
  const defaultValues = useMemo(
    () =>
      initialReservation
        ? getMeetingRoomReservationDefaultValues(initialReservation)
        : { ...meetingRoomReservationDefaultValues },
    [initialReservation]
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
  const selectedInterval = useMemo(
    () =>
      getMeetingRoomReservationInterval(
        selectedStartDateTime,
        selectedDurationMinutes
      ),
    [selectedDurationMinutes, selectedStartDateTime]
  );
  const preservesRestoredStart =
    Boolean(initialReservation) &&
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
  const advertisedPriceRequest = useMemo(
    () =>
      selectedInterval
        ? ({
            locale,
            reservation: {
              kind: "meeting-room",
              details: {
                kind: "meeting-room",
                ...selectedInterval,
              },
            },
          } satisfies AdvertisedPriceRequest)
        : undefined,
    [locale, selectedInterval]
  );
  const advertisedPriceQueryResult = useAdvertisedPrice(advertisedPriceRequest);
  const advertisedPriceData =
    advertisedPriceRequest && !advertisedPriceQueryResult.isError
      ? advertisedPriceQueryResult.data
      : undefined;
  const advertisedPrice =
    advertisedPriceData && isMeetingRoomAdvertisedPrice(advertisedPriceData)
      ? advertisedPriceData
      : null;

  return (
    <ReservationCheckoutForm
      advertisedPrice={{
        token: advertisedPrice?.advertisedPriceToken,
        isFetching: advertisedPriceQueryResult.isFetching,
        isError: advertisedPriceQueryResult.isError,
        retry: () => void advertisedPriceQueryResult.refetch(),
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
              {m.reservationMeetingRoomStartLabel({}, { locale })}
            </ReservationFormLabel>
            <ReservationDateTimePicker
              className="grid-cols-1 sm:grid-cols-2"
              dateLabel={m.reservationMeetingRoomDateLabel({}, { locale })}
              locale={locale}
              minimum={getEarliestSelectableMeetingRoomStartDateTime}
              name={field.name}
              onBlur={field.onBlur}
              onChange={field.onChange}
              placeholder={m.reservationDatePlaceholder({}, { locale })}
              preserveValueBeforeMinimum={preservesRestoredStart}
              timeLabel={m.reservationMeetingRoomTimeLabel({}, { locale })}
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
              <div className="grid gap-3 sm:grid-cols-3">
                {workspaceMeetingRoomDurationOptions.map((duration) => {
                  const isSelected = field.value === duration;
                  const durationTitle = getWorkspaceMeetingRoomDurationTitle(
                    duration,
                    locale
                  );
                  const advertisedProductItem = isSelected
                    ? advertisedPrice?.summary.sections
                        .find(({ key }) => key === "order")
                        ?.items.find(
                          (item) =>
                            "product" in item &&
                            item.product.kind === "meeting-room" &&
                            item.product.durationMinutes === duration
                        )
                    : undefined;
                  const hasAdvertisedDiscount =
                    advertisedProductItem &&
                    "originalAmount" in advertisedProductItem &&
                    advertisedProductItem.originalAmount &&
                    advertisedProductItem.discounts;
                  const inputId = `meeting-room-duration-${duration}`;

                  return (
                    <div
                      key={duration}
                      className={cn(
                        "relative rounded-[1.1rem] border bg-white p-4 transition hover:-translate-y-0.5 hover:border-burned-orange/45",
                        isSelected
                          ? "border-burned-orange ring-4 ring-burned-orange/10"
                          : "border-navy-blue/10"
                      )}
                    >
                      <label className="block cursor-pointer" htmlFor={inputId}>
                        <input
                          id={inputId}
                          type="radio"
                          className="sr-only"
                          checked={isSelected}
                          value={duration}
                          onChange={() => field.onChange(duration)}
                          onBlur={field.onBlur}
                          ref={field.ref}
                        />
                        <span className="block font-semibold text-navy-blue">
                          {durationTitle}
                        </span>
                        <span className="mt-2 flex flex-wrap items-center gap-1 text-sm font-semibold text-burned-orange">
                          <ReservationAdvertisedPrice
                            amount={
                              advertisedProductItem?.amount ??
                              getWorkspaceMeetingRoomPriceForDuration(duration)
                            }
                            locale={locale}
                            originalAmount={
                              hasAdvertisedDiscount
                                ? advertisedProductItem.originalAmount
                                : undefined
                            }
                          />
                        </span>
                      </label>
                      {hasAdvertisedDiscount && (
                        <div className="absolute bottom-2 right-2">
                          <CheckoutSummaryDiscountDetails
                            discounts={advertisedProductItem.discounts}
                            locale={locale}
                            productLabel={durationTitle}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
        <ReservationSkeletonBlock className="h-24 rounded-[1.1rem]" />
        <ReservationSkeletonBlock className="h-24 rounded-[1.1rem]" />
        <ReservationSkeletonBlock className="h-24 rounded-[1.1rem]" />
      </div>
      <ReservationCustomerFieldsFallback />
      <ReservationSubmitFallback />
    </ReservationFormFallback>
  );
}
