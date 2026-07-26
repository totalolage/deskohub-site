"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { skipToken, useQuery } from "@tanstack/react-query";
import { track } from "@vercel/analytics/react";
import { Schema } from "effect";
import { AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useMemo, useRef, useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPriceRequest,
  isMeetingRoomAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { createCheckoutIdentifier } from "@/features/checkout/checkout-identifiers";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { useCookieConsent } from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
import { preparePayState } from "@/features/reservation/actions/prepare-pay-state";
import { useAdvertisedPrice } from "@/features/reservation/components/use-advertised-price";
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
import { getReservationAnalyticsProperties } from "@/features/reservation/reservation-analytics";
import {
  type MeetingRoomWorkspaceAvailabilityQuery,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import { loadWorkspaceAvailability } from "@/features/reservation/workspace-availability-client";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { Skeleton as SkeletonBlock } from "@/shared/components/ui/skeleton";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { MeetingRoomDateTimePicker } from "./meeting-room-date-time-picker";

type MeetingRoomReservationFormProps = {
  readonly checkoutSessionId?: string;
  readonly initialReservation?: NormalizedMeetingRoomReservationOrder;
  readonly locale: Locale;
};

type MeetingRoomReservationFormFallbackProps = {
  readonly locale: Locale;
};

type SubmissionMessage = {
  readonly status: "error";
  readonly text: string;
};

const reservationFormSchema = Schema.toStandardSchemaV1(
  meetingRoomReservationSchema
);

const meetingRoomFormCardClassName =
  "relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm";

export function MeetingRoomReservationForm({
  checkoutSessionId: initialCheckoutSessionId,
  initialReservation,
  locale,
}: MeetingRoomReservationFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAccepted } = useCookieConsent();
  const hasTrackedSuccessfulSubmission = useRef(false);
  const [checkoutSessionId] = useState(
    () => initialCheckoutSessionId ?? createCheckoutIdentifier()
  );
  const [checkoutAttemptId, setCheckoutAttemptId] = useState(
    createCheckoutIdentifier
  );
  const lastSubmittedReservationRef = useRef<string | null>(null);
  const [submissionMessage, setSubmissionMessage] =
    useState<SubmissionMessage | null>(null);
  const analyticsProperties = useMemo(
    () => getReservationAnalyticsProperties(searchParams),
    [searchParams]
  );
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
    resolver: standardSchemaResolver(reservationFormSchema),
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
  const availabilityQueryResult = useQuery({
    queryKey: availabilityQuery
      ? workspaceAvailabilityKeys.availability(availabilityQuery)
      : ["workspace-availability", "meeting-room", "empty"],
    queryFn: availabilityQuery
      ? ({ signal }) =>
          loadWorkspaceAvailability({ query: availabilityQuery, signal })
      : skipToken,
    retry: (failureCount) => failureCount < 3,
    staleTime: 30_000,
  });
  const availability = availabilityQueryResult.isError
    ? null
    : (availabilityQueryResult.data ?? null);
  const isSelectedReservationUnavailable = Boolean(
    selectedInterval &&
      ((availability?.unavailableDates.length ?? 0) > 0 ||
        availability?.meetingRoomUnavailable)
  );
  const isAvailabilityLoading = availabilityQueryResult.isFetching;
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

  const {
    execute: sendReservation,
    isExecuting: isSendingReservation,
    result: preparePayStateResult,
  } = useWorkspaceAction(preparePayState, {
    actionName: "preparePayState",
    onSuccess: ({ data }) => {
      if (data?.status === "error") {
        setSubmissionMessage({ status: "error", text: data.message });
        return;
      }

      const redirectUrl = data?.redirectUrl;
      if (!redirectUrl) {
        setSubmissionMessage({
          status: "error",
          text: m.reservationErrorMessage({}, { locale }),
        });
        return;
      }

      if (!hasTrackedSuccessfulSubmission.current && isAccepted("analytics")) {
        hasTrackedSuccessfulSubmission.current = true;
        track("workspace_checkout_started", analyticsProperties);
      }

      router.push(redirectUrl);
    },
    onError: ({ error }) => {
      setSubmissionMessage({
        status: "error",
        text: error.serverError || m.reservationErrorMessage({}, { locale }),
      });
    },
    onTransportError: () => {
      setSubmissionMessage({
        status: "error",
        text: m.reservationErrorMessage({}, { locale }),
      });
    },
  });
  const hasPreparedPayRedirect =
    (preparePayStateResult.data?.status === "ready" ||
      preparePayStateResult.data?.status === "pricing_changed") &&
    Boolean(preparePayStateResult.data.redirectUrl);
  const isPreparingCheckout = isSendingReservation || hasPreparedPayRedirect;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    void form.handleSubmit((data) => {
      if (hasPreparedPayRedirect) return;

      setSubmissionMessage(null);
      if (isSelectedReservationUnavailable) {
        setSubmissionMessage({
          status: "error",
          text: m.reservationMeetingRoomUnavailable({}, { locale }),
        });
        return;
      }
      if (!advertisedPrice) {
        setSubmissionMessage({
          status: "error",
          text: m.reservationErrorMessage({}, { locale }),
        });
        return;
      }

      hasTrackedSuccessfulSubmission.current = false;
      window.scrollTo({ top: 0, behavior: "instant" });
      const reservation = getMeetingRoomReservationOrder(data);
      const reservationFingerprint = JSON.stringify(reservation);
      const effectiveCheckoutAttemptId =
        lastSubmittedReservationRef.current &&
        lastSubmittedReservationRef.current !== reservationFingerprint
          ? createCheckoutIdentifier()
          : checkoutAttemptId;
      if (effectiveCheckoutAttemptId !== checkoutAttemptId) {
        setCheckoutAttemptId(effectiveCheckoutAttemptId);
      }
      lastSubmittedReservationRef.current = reservationFingerprint;

      sendReservation({
        locale,
        checkoutSessionId,
        checkoutAttemptId: effectiveCheckoutAttemptId,
        advertisedPriceToken: advertisedPrice.advertisedPriceToken,
        legalConsent: data.legalConsent,
        reservation,
      });
    })(event);
  };

  if (isPreparingCheckout) {
    return <CheckoutPayPageSkeleton locale={locale} />;
  }

  return (
    <Card className={meetingRoomFormCardClassName}>
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-7">
            <FormField
              control={form.control}
              name="startDateTime"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel
                    className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
                    required
                  >
                    {m.reservationMeetingRoomStartLabel({}, { locale })}
                  </FormLabel>
                  <MeetingRoomDateTimePicker
                    className="grid-cols-1 sm:grid-cols-2"
                    dateLabel={m.reservationMeetingRoomDateLabel(
                      {},
                      { locale }
                    )}
                    locale={locale}
                    minimum={getEarliestSelectableMeetingRoomStartDateTime}
                    name={field.name}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    placeholder={m.reservationDatePlaceholder({}, { locale })}
                    preserveValueBeforeMinimum={preservesRestoredStart}
                    timeLabel={m.reservationMeetingRoomTimeLabel(
                      {},
                      { locale }
                    )}
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
                  <FormLabel
                    className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
                    required
                  >
                    {m.reservationMeetingRoomDurationLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {workspaceMeetingRoomDurationOptions.map((duration) => {
                        const isSelected = field.value === duration;
                        const durationTitle =
                          getWorkspaceMeetingRoomDurationTitle(
                            duration,
                            locale
                          );
                        const advertisedQuote = isSelected
                          ? advertisedPrice?.quote
                          : undefined;
                        const hasAdvertisedDiscount = Boolean(
                          advertisedQuote?.payment.discounts.length
                        );
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
                            <label
                              className="block cursor-pointer"
                              htmlFor={inputId}
                            >
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
                                {advertisedQuote && hasAdvertisedDiscount ? (
                                  <>
                                    <span className="sr-only">
                                      {m.checkoutSummaryOriginalPrice(
                                        {
                                          price: formatWorkspaceMoney(
                                            advertisedQuote.payment
                                              .undiscountedPrice,
                                            locale
                                          ),
                                        },
                                        { locale }
                                      )}
                                    </span>
                                    <del
                                      aria-hidden="true"
                                      className="text-navy-blue/45 decoration-navy-blue/40"
                                    >
                                      {formatWorkspaceMoney(
                                        advertisedQuote.payment
                                          .undiscountedPrice,
                                        locale
                                      )}
                                    </del>
                                    <span className="sr-only">
                                      {m.checkoutSummaryDiscountedPrice(
                                        {
                                          price: formatWorkspaceMoney(
                                            advertisedQuote.payment
                                              .expectedPrice,
                                            locale
                                          ),
                                        },
                                        { locale }
                                      )}
                                    </span>
                                    <span aria-hidden="true">
                                      {formatWorkspaceMoney(
                                        advertisedQuote.payment.expectedPrice,
                                        locale
                                      )}
                                    </span>
                                  </>
                                ) : (
                                  formatWorkspaceMoney(
                                    getWorkspaceMeetingRoomPriceForDuration(
                                      duration
                                    ),
                                    locale
                                  )
                                )}
                              </span>
                            </label>
                            {advertisedQuote && hasAdvertisedDiscount && (
                              <div className="absolute bottom-2 right-2">
                                <CheckoutSummaryDiscountDetails
                                  discounts={advertisedQuote.payment.discounts}
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

            <div className="grid gap-5 md:grid-cols-2">
              <TextField
                control={form.control}
                name="email"
                type="email"
                label={m.contactEmailLabel({}, { locale })}
                placeholder={m.contactEmailPlaceholder({}, { locale })}
                autoComplete="email"
              />
              <TextField
                control={form.control}
                name="phone"
                label={m.contactPhoneLabel({}, { locale })}
                placeholder={m.contactPhonePlaceholder({}, { locale })}
                autoComplete="tel"
              />
            </div>

            <TextField
              control={form.control}
              name="name"
              label={m.contactNameLabel({}, { locale })}
              placeholder={m.contactNamePlaceholder({}, { locale })}
              autoComplete="name"
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
                    {m.reservationMessageLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ""}
                      rows={5}
                      variant={fieldState.error ? "error" : "default"}
                      placeholder={m.reservationMeetingRoomMessagePlaceholder(
                        {},
                        { locale }
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="legalConsent"
              render={({ field }) => (
                <FormItem>
                  <label
                    htmlFor="meeting-room-privacy-consent"
                    className="flex cursor-pointer items-start gap-3 rounded-[1.35rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4"
                  >
                    <FormControl>
                      <Checkbox
                        id="meeting-room-privacy-consent"
                        className="mt-1"
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(Boolean(checked))
                        }
                        onBlur={field.onBlur}
                        ref={field.ref}
                      />
                    </FormControl>
                    <span className="text-sm leading-6 text-navy-blue/66">
                      {m.reservationPrivacyNoteBefore({}, { locale })}{" "}
                      <Link
                        href={`/${locale}/privacy-policy`}
                        prefetch={false}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
                      >
                        {m.reservationPrivacyNoteLinkLabel({}, { locale })}
                      </Link>{" "}
                      {m.reservationPrivacyNoteAfter({}, { locale })}
                    </span>
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3 pt-1">
              <Button
                type="submit"
                className="h-13 w-full rounded-full text-sm uppercase tracking-[0.18em]"
                disabled={
                  form.formState.isSubmitting ||
                  isSendingReservation ||
                  hasPreparedPayRedirect ||
                  isSelectedReservationUnavailable ||
                  isAvailabilityLoading ||
                  advertisedPriceQueryResult.isFetching ||
                  !advertisedPrice
                }
              >
                <ArrowRight className="h-4 w-4" />
                {m.checkoutContinueButton({}, { locale })}
              </Button>

              {submissionMessage && (
                <p
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-burned-orange-ink"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
                  <span>{submissionMessage.text}</span>
                </p>
              )}
              {isSelectedReservationUnavailable && !submissionMessage && (
                <p
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-burned-orange-ink"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
                  <span>
                    {m.reservationMeetingRoomUnavailable({}, { locale })}
                  </span>
                </p>
              )}
              {isAvailabilityLoading && !submissionMessage && (
                <p
                  aria-live="polite"
                  className="text-sm leading-6 text-navy-blue/62"
                >
                  {m.reservationAvailabilityLoading({}, { locale })}
                </p>
              )}
              {advertisedPriceQueryResult.isFetching &&
                !advertisedPrice &&
                !submissionMessage && (
                  <p
                    aria-live="polite"
                    className="text-sm leading-6 text-navy-blue/62"
                  >
                    {m.reservationAdvertisedPriceLoading({}, { locale })}
                  </p>
                )}
              {advertisedPriceQueryResult.isError && !submissionMessage && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-burned-orange-ink"
                >
                  <span className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
                    <span>
                      {m.reservationAdvertisedPriceError({}, { locale })}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-9 rounded-full px-4"
                    disabled={advertisedPriceQueryResult.isFetching}
                    onClick={() => void advertisedPriceQueryResult.refetch()}
                  >
                    {m.reservationAdvertisedPriceRetry({}, { locale })}
                  </Button>
                </div>
              )}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export function MeetingRoomReservationFormFallback({
  locale,
}: MeetingRoomReservationFormFallbackProps) {
  return (
    <Card
      aria-busy="true"
      aria-label={m.reservationMeetingRoomFormTitle({}, { locale })}
      className={meetingRoomFormCardClassName}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardContent className="pt-6">
        <div aria-hidden="true" className="space-y-7">
          <div className="space-y-2">
            <SkeletonBlock className="h-4 w-40" />
            <div className="grid gap-3 sm:grid-cols-2">
              <SkeletonBlock className="h-13 w-full rounded-[1.1rem]" />
              <SkeletonBlock className="h-13 w-full rounded-[1.1rem]" />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SkeletonBlock className="h-24 rounded-[1.1rem]" />
            <SkeletonBlock className="h-24 rounded-[1.1rem]" />
            <SkeletonBlock className="h-24 rounded-[1.1rem]" />
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <SkeletonField />
            <SkeletonField />
          </div>
          <SkeletonField />
          <SkeletonBlock className="h-34 w-full rounded-[1.1rem]" />
          <SkeletonBlock className="h-13 w-full rounded-full bg-burned-orange/18" />
        </div>
      </CardContent>
    </Card>
  );
}

type TextFieldProps = {
  readonly control: Control<
    MeetingRoomReservationInput,
    unknown,
    MeetingRoomReservationData
  >;
  readonly name: "name" | "email" | "phone";
  readonly label: string;
  readonly placeholder: string;
  readonly type?: string;
  readonly autoComplete?: string;
};

function TextField({
  autoComplete,
  control,
  label,
  name,
  placeholder,
  type = "text",
}: TextFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel
            className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
            required
          >
            {label}
          </FormLabel>
          <FormControl>
            <Input
              {...field}
              value={field.value || ""}
              type={type}
              autoComplete={autoComplete}
              variant={fieldState.error ? "error" : "default"}
              placeholder={placeholder}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function SkeletonField() {
  return (
    <div className="space-y-2">
      <SkeletonBlock className="h-4 w-28" />
      <SkeletonBlock className="h-13 w-full rounded-[1.1rem]" />
    </div>
  );
}
