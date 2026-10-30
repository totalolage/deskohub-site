"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import {
  type AdvertisedPrice,
  getAdvertisedProductItem,
  isMeetingRoomAdvertisedPrice,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { workspaceMeetingRoomCatalog } from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceMeetingRoomDurationTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import {
  getMeetingRoomEarlySetupAvailability,
  isMeetingRoomEarlySetupRuledOut,
  MeetingRoomEarlySetupField,
} from "@/features/meeting-room/components/meeting-room-early-setup-field";
import { MeetingRoomStartTimeOptions } from "@/features/meeting-room/components/meeting-room-start-time-options";
import { useMeetingRoomStartTimes } from "@/features/meeting-room/components/use-meeting-room-start-times";
import { ReservationAdvertisedPrice } from "@/features/reservation/components/reservation-advertised-price";
import { ReservationCheckoutForm } from "@/features/reservation/components/reservation-checkout-form";
import { ReservationFormDateTimePicker } from "@/features/reservation/components/reservation-date-time-picker";
import {
  ReservationCustomerFieldsFallback,
  ReservationFormFallback,
  ReservationSkeletonBlock,
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
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import { meetingRoomSelectionLink } from "@/features/reservation/meeting-room-selection-link";
import type { ReservationCheckoutCustomerForm } from "@/features/reservation/reservation-existing-customer";
import {
  getMeetingRoomSelectionAvailabilityQuery,
  getMeetingRoomStartTimesQuery,
  isMeetingRoomAvailable,
  type PreloadedWorkspaceAvailability,
} from "@/features/reservation/workspace-availability";
import {
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/shared/components/ui/form";
import { cn } from "@/shared/utils";
import { getMeetingRoomReservationSelectionSummary } from "./meeting-room-reservation-selection-summary";

type MeetingRoomReservationFormProps = {
  readonly checkoutSessionId?: CheckoutSessionId;
  readonly checkoutCustomer: ReservationCheckoutCustomerForm;
  readonly initialAdvertisedPrices?: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly initialAvailability?: ReadonlyArray<PreloadedWorkspaceAvailability>;
  readonly initialReservation?: NormalizedMeetingRoomReservationOrder;
  readonly initialValues?: MeetingRoomReservationInput;
  readonly locale: Locale;
  readonly replacementToken?: string;
  readonly submittedCode?: CanonicalPromotionCode;
};

const durationOptionsLayout = "sm:grid-cols-3 sm:space-y-0 sm:gap-x-3";

type MeetingRoomReservationFormFallbackProps = {
  readonly locale: Locale;
};

export function MeetingRoomReservationForm({
  checkoutSessionId,
  checkoutCustomer,
  initialAdvertisedPrices = [],
  initialAvailability,
  initialReservation,
  initialValues,
  locale,
  replacementToken,
  submittedCode,
}: MeetingRoomReservationFormProps) {
  const defaultValues =
    initialValues ??
    (initialReservation
      ? getMeetingRoomReservationDefaultValues(initialReservation)
      : { ...meetingRoomReservationDefaultValues });
  const form = useForm<
    MeetingRoomReservationInput,
    unknown,
    MeetingRoomReservationData
  >({
    resolver: effectSchemaResolver(meetingRoomReservationSchema),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const selection = useWatchedSelection(meetingRoomSelectionLink, form.control);
  const {
    startDateTime: selectedStartDateTime,
    duration: selectedDurationKey,
    earlySetup,
  } = selection;
  useReservationSelectionUrl(meetingRoomSelectionLink, selection);
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
    () =>
      getMeetingRoomSelectionAvailabilityQuery({
        duration: selectedDurationKey,
        startDateTime: selectedStartDateTime,
      }),
    [selectedDurationKey, selectedStartDateTime]
  );
  const availabilityQueryResult = useReservationAvailability(
    availabilityQuery,
    { debounceMs: 250, initialAvailability, replacementToken }
  );
  const { availability } = availabilityQueryResult;
  const isSelectedReservationUnavailable = Boolean(
    selectedInterval && availability && !isMeetingRoomAvailable(availability)
  );
  const availabilityMessage = isSelectedReservationUnavailable
    ? m.reservationMeetingRoomUnavailable({}, { locale })
    : undefined;
  const availabilityErrorMessage =
    availabilityQuery &&
    availabilityQueryResult.isError &&
    !availabilityQueryResult.isPending
      ? m.reservationAvailabilityError({}, { locale })
      : undefined;
  // A whole day lists no starts, but its midnight start's entry still says
  // whether its setup time is free.
  const startTimesQuery = getMeetingRoomStartTimesQuery({
    duration: selectedDurationKey,
    startDateTime: selectedStartDateTime,
  });
  const startTimes = useMeetingRoomStartTimes({
    query: startTimesQuery,
    replacementToken,
  });
  const earlySetupAvailability = getMeetingRoomEarlySetupAvailability({
    startTimes,
    startsAt: selectedInterval
      ? Temporal.Instant.from(selectedInterval.startsAt)
      : undefined,
  });
  const isEarlySetupRuledOut = isMeetingRoomEarlySetupRuledOut(
    earlySetupAvailability
  );

  // Changing to a start whose setup time is taken drops the setup choice.
  // Loading or failed starts keep it; submission checks it again.
  useEffect(() => {
    if (earlySetup && isEarlySetupRuledOut) {
      form.setValue("earlySetup", false, { shouldValidate: true });
    }
  }, [earlySetup, form, isEarlySetupRuledOut]);
  const advertisedPriceRequests = useMemo(
    () =>
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale,
        startDateTime: selectedStartDateTime,
        submittedCode,
      }),
    [locale, selectedStartDateTime, submittedCode]
  );
  const advertisedPriceQueryResults = useAdvertisedPrices(
    advertisedPriceRequests,
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
        getMeetingRoomReservationDurationKey(
          request.reservation.details.duration
        ),
        queryResult.data
      );
    }
  }

  const selectedAdvertisedPriceIndex = advertisedPriceRequests.findIndex(
    ({ reservation }) =>
      getMeetingRoomReservationDurationKey(reservation.details.duration) ===
      selectedDurationKey
  );
  const advertisedPriceQueryResult =
    advertisedPriceQueryResults[selectedAdvertisedPriceIndex];
  const advertisedPrice =
    advertisedPricesByDuration.get(selectedDurationKey) ?? null;

  return (
    <ReservationCheckoutForm
      checkoutCustomer={checkoutCustomer}
      advertisedPrice={{
        token: advertisedPrice?.advertisedPriceToken,
        isFetching: advertisedPriceQueryResult?.isFetching ?? false,
        isError: advertisedPriceQueryResult?.isError ?? false,
        retry: () => void advertisedPriceQueryResult?.refetch(),
        sale: advertisedPrice
          ? {
              discounts: advertisedPrice.quote.payment.discounts,
              productLabel: getWorkspaceMeetingRoomDurationTitle(
                selectedDuration,
                locale
              ),
            }
          : undefined,
        total: advertisedPrice
          ? getReservationAdvertisedTotal(advertisedPrice.quote.payment)
          : undefined,
      }}
      availability={{
        isPending: availabilityQueryResult.isPending,
        unavailableMessage: availabilityMessage ?? availabilityErrorMessage,
      }}
      checkoutSessionId={checkoutSessionId}
      form={form}
      getReservation={getMeetingRoomReservationOrder}
      locale={locale}
      selectionSummary={getMeetingRoomReservationSelectionSummary(
        {
          durationKey: selectedDurationKey,
          startDateTime: selectedStartDateTime,
        },
        locale
      )}
      selection={{
        kind: meetingRoomSelectionLink.kind,
        fromSearchParams: (searchParams) =>
          meetingRoomSelectionLink.readSelection(searchParams),
      }}
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
            <ReservationFormDateTimePicker
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
              timeLabel={m.reservationMeetingRoomTimeLabel({}, { locale })}
              showTime={!isWholeDaySelected}
              timeStepMinutes={60}
              value={field.value}
              variant={fieldState.error ? "error" : "default"}
            />
            <FormMessage />
            {startTimesQuery && !isWholeDaySelected && (
              <MeetingRoomStartTimeOptions
                locale={locale}
                onSelect={field.onChange}
                result={startTimes}
                selectedStartDateTime={field.value}
              />
            )}
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
                aria-required="true"
                className={durationOptionsLayout}
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
                  const durationAdvertisedPrice =
                    advertisedPricesByDuration.get(durationKey);
                  const advertisedProductItem =
                    durationAdvertisedPrice &&
                    getAdvertisedProductItem(durationAdvertisedPrice, {
                      kind: "meeting-room",
                      duration: product.duration,
                    });
                  const originalAmount =
                    advertisedProductItem &&
                    "originalAmount" in advertisedProductItem &&
                    advertisedProductItem.originalAmount
                      ? advertisedProductItem.originalAmount
                      : undefined;

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
                      price={
                        advertisedProductItem ? (
                          <ReservationAdvertisedPrice
                            amount={advertisedProductItem.amount}
                            locale={locale}
                            originalAmount={originalAmount}
                          />
                        ) : (
                          <ReservationSkeletonBlock className="h-5 w-24 bg-aquamarine-green/15" />
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

      <MeetingRoomEarlySetupField
        availability={earlySetupAvailability}
        control={form.control}
        locale={locale}
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
      <div className="flex flex-col gap-y-2">
        <ReservationSkeletonBlock className="h-4 w-32" />
        <div className={cn(reservationTypeInputLayout, durationOptionsLayout)}>
          {workspaceMeetingRoomCatalog.map(({ duration }) => (
            <div
              key={getMeetingRoomReservationDurationKey(duration)}
              className={cn(
                reservationTypeOptionLayout,
                "bg-white pb-4 outline outline-1 -outline-offset-1 outline-navy-blue/10"
              )}
            >
              <div className="mt-4 mb-3 flex items-start justify-between gap-2">
                <ReservationSkeletonBlock className="h-6 w-28" />
                <ReservationSkeletonBlock className="mt-1 h-4 w-4 shrink-0" />
              </div>
              <div className="mb-3 flex">
                <ReservationSkeletonBlock className="h-5 w-24 bg-aquamarine-green/15" />
              </div>
            </div>
          ))}
        </div>
      </div>
      <ReservationCustomerFieldsFallback />
      <ReservationSubmitFallback />
    </ReservationFormFallback>
  );
}
