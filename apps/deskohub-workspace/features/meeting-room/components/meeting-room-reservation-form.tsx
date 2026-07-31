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
import { workspaceMeetingRoomCatalog } from "@/features/checkout/product-catalog";
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
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  isMeetingRoomWholeDayReservationDuration,
  type MeetingRoomReservationDurationKey,
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getEarliestMeetingRoomStartDateTime,
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
  readonly replacementToken?: string;
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
  replacementToken,
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
  const [selectedStartDateTime, selectedDurationKey] = useWatch({
    control: form.control,
    name: ["startDateTime", "duration"],
  });
  const selectedDuration =
    getMeetingRoomReservationDuration(selectedDurationKey);
  const isWholeDaySelected =
    isMeetingRoomWholeDayReservationDuration(selectedDuration);
  const selectedInterval = useMemo(
    () =>
      getMeetingRoomReservationInterval(
        selectedStartDateTime,
        selectedDuration
      ),
    [selectedDuration, selectedStartDateTime]
  );
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
  const availabilityQueryResult = useReservationAvailability(
    availabilityQuery,
    { debounceMs: 250, replacementToken }
  );
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
        startDateTime: selectedStartDateTime,
      }),
    [locale, selectedStartDateTime]
  );
  const advertisedPriceQueryResults = useAdvertisedPrices(
    advertisedPriceRequests.map(({ request }) => request),
    initialAdvertisedPrices
  );
  const advertisedPricesByDuration = new Map<
    MeetingRoomReservationDurationKey,
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
      advertisedPricesByDuration.set(
        getMeetingRoomReservationDurationKey(request.duration),
        queryResult.data
      );
    }
  }

  const selectedAdvertisedPriceIndex = advertisedPriceRequests.findIndex(
    ({ duration }) =>
      getMeetingRoomReservationDurationKey(duration) === selectedDurationKey
  );
  const advertisedPriceQueryResult =
    advertisedPriceQueryResults[selectedAdvertisedPriceIndex];
  const advertisedPrice =
    advertisedPricesByDuration.get(selectedDurationKey) ?? null;

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
              minimum={() =>
                getEarliestMeetingRoomStartDateTime(selectedDuration)
              }
              name={field.name}
              onBlur={field.onBlur}
              onChange={field.onChange}
              placeholder={m.reservationDatePlaceholder({}, { locale })}
              timeLabel={m.reservationMeetingRoomTimeLabel({}, { locale })}
              showTime={!isWholeDaySelected}
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
        name="duration"
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
                {workspaceMeetingRoomCatalog.map((product) => {
                  const durationKey = getMeetingRoomReservationDurationKey(
                    product.duration
                  );
                  const durationTitle = getWorkspaceMeetingRoomDurationTitle(
                    product.duration,
                    locale
                  );
                  const advertisedProductItem = advertisedPricesByDuration
                    .get(durationKey)
                    ?.summary.sections.find(({ key }) => key === "order")
                    ?.items.find(
                      (item) =>
                        "product" in item &&
                        item.product.kind === "meeting-room" &&
                        getMeetingRoomReservationDurationKey(
                          item.product.duration
                        ) === durationKey
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
                      key={durationKey}
                      className={`pb-4 ${
                        {
                          "hour:1": "sm:col-start-1 lg:col-start-1",
                          "hour:4": "sm:col-start-2 lg:col-start-2",
                          "day:1": "sm:col-start-3 lg:col-start-3",
                        }[durationKey]
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
                        product.duration,
                        locale
                      )}
                      value={durationKey}
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
