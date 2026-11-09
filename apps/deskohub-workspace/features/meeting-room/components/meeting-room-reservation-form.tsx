"use client";

import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { useMemo } from "react";
import { useForm } from "react-hook-form";
import type { PreloadedAdvertisedPrice } from "@/features/checkout/advertised-price";
import type { CheckoutSessionId } from "@/features/checkout/checkout-identifiers";
import { workspaceMeetingRoomCatalog } from "@/features/checkout/product-catalog";
import {
  getWorkspaceMeetingRoomDurationLabel,
  getWorkspaceMeetingRoomDurationTitle,
} from "@/features/checkout/product-catalog.i18n";
import type { CanonicalPromotionCode } from "@/features/discounts";
import { type Locale, m } from "@/features/i18n";
import { MeetingRoomEarlySetupField } from "@/features/meeting-room/components/meeting-room-early-setup-field";
import { MeetingRoomStartTimeOptions } from "@/features/meeting-room/components/meeting-room-start-time-options";
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
import {
  ReservationTypeInput,
  ReservationTypeOption,
  reservationTypeInputLayout,
  reservationTypeOptionLayout,
} from "@/features/reservation/components/reservation-type-input";
import { useAdvertisedOptionPrices } from "@/features/reservation/components/use-advertised-option-prices";
import { useReservationAvailability } from "@/features/reservation/components/use-reservation-availability";
import {
  useReservationSelectionUrl,
  useWatchedSelection,
} from "@/features/reservation/components/use-reservation-selection-url";
import {
  findMeetingRoomDurationAdvertisedPriceRequest,
  getMeetingRoomDurationAdvertisedPriceRequests,
  meetingRoomDurationOptions,
} from "@/features/reservation/meeting-room-advertised-price";
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
} from "@/features/reservation/meeting-room-reservation-duration";
import {
  getEarliestMeetingRoomStartDateTime,
  getMeetingRoomReservationDate,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import { meetingRoomSelectionLink } from "@/features/reservation/meeting-room-selection-link";
import { getReservationCheckoutAvailability } from "@/features/reservation/reservation.i18n";
import type { ReservationCheckoutCustomerForm } from "@/features/reservation/reservation-existing-customer";
import {
  getMeetingRoomSelectionAvailabilityQuery,
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
import { useMeetingRoomEarlySetup } from "./use-meeting-room-early-setup";

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
  const unavailableInterval =
    selectedInterval && availability && !isMeetingRoomAvailable(availability)
      ? selectedInterval
      : undefined;
  const {
    availability: earlySetupAvailability,
    startTimes,
    startTimesQuery,
  } = useMeetingRoomEarlySetup({
    earlySetup,
    form,
    replacementToken,
    selectedInterval,
    selection: {
      duration: selectedDurationKey,
      startDateTime: selectedStartDateTime,
    },
  });
  const advertisedPriceRequests = useMemo(
    () =>
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale,
        startDateTime: selectedStartDateTime,
        submittedCode,
      }),
    [locale, selectedStartDateTime, submittedCode]
  );
  const advertisedPrices = useAdvertisedOptionPrices({
    family: meetingRoomDurationOptions,
    initialAdvertisedPrices,
    productLabel: getWorkspaceMeetingRoomDurationTitle(
      selectedDuration,
      locale
    ),
    requests: advertisedPriceRequests,
    selected: findMeetingRoomDurationAdvertisedPriceRequest(
      advertisedPriceRequests,
      selectedDurationKey
    ),
  });

  return (
    <ReservationCheckoutForm
      checkoutCustomer={checkoutCustomer}
      advertisedPrice={advertisedPrices.checkout}
      availability={getReservationCheckoutAvailability({
        isError: availabilityQueryResult.isError,
        isPending: availabilityQueryResult.isPending,
        locale,
        unavailable: unavailableInterval && {
          date: getMeetingRoomReservationDate(unavailableInterval),
          reservation: { kind: "meeting-room" },
        },
      })}
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
                  const durationRequest =
                    findMeetingRoomDurationAdvertisedPriceRequest(
                      advertisedPriceRequests,
                      durationKey
                    );
                  const durationPrice =
                    durationRequest && advertisedPrices.of(durationRequest);

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
                        durationPrice ? (
                          <ReservationAdvertisedPrice
                            amount={durationPrice.amount}
                            locale={locale}
                            originalAmount={durationPrice.originalAmount}
                          />
                        ) : (
                          <ReservationSkeletonBlock className="h-5 w-24 bg-aquamarine-green/15" />
                        )
                      }
                      priceReady={Boolean(durationPrice)}
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
