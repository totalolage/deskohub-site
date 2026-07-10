"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { useQuery } from "@tanstack/react-query";
import { track } from "@vercel/analytics/react";
import { Schema } from "effect";
import { AlertTriangle, ArrowRight, Clock } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useMemo, useRef, useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page";
import {
  getWorkspaceMeetingRoomPriceForDuration,
  isWorkspaceMeetingRoomDuration,
  type WorkspaceMeetingRoomDurationMinutes,
  workspaceMeetingRoomDurationOptions,
} from "@/features/checkout/product-catalog";
import { getWorkspaceProductMessage } from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { useCookieConsent } from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
import { getWorkspaceAvailability } from "@/features/reservation/actions/get-workspace-availability";
import { preparePayState } from "@/features/reservation/actions/prepare-pay-state";
import {
  getMeetingRoomAvailabilityToDate,
  getMeetingRoomReservationInterval,
} from "@/features/reservation/meeting-room-reservation-time";
import {
  type MeetingRoomReservationData,
  type MeetingRoomReservationInput,
  meetingRoomReservationEffectSchema,
} from "@/features/reservation/schemas/meeting-room-reservation";
import { workspaceAvailabilityKeys } from "@/features/reservation/schemas/workspace-availability";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import { DateTimePicker } from "@/shared/components/ui/date-time-picker";
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

type MeetingRoomReservationFormProps = {
  readonly locale: Locale;
};

type SubmissionMessage = {
  readonly status: "error";
  readonly text: string;
};

const meetingRoomDurationMessages: Record<
  WorkspaceMeetingRoomDurationMinutes,
  Parameters<typeof getWorkspaceProductMessage>[0]
> = {
  60: m.reservationMeetingRoomDurationOneHour,
  240: m.reservationMeetingRoomDurationFourHours,
  1440: m.reservationMeetingRoomDurationTwentyFourHours,
};

const getMeetingRoomDurationMessage = (
  durationMinutes: WorkspaceMeetingRoomDurationMinutes
) => {
  const message = meetingRoomDurationMessages[durationMinutes];
  if (!message) {
    throw new Error(`Unknown meeting room duration: ${durationMinutes}`);
  }

  return message;
};

const meetingRoomDefaultValues: MeetingRoomReservationInput = {
  startDateTime: "",
  durationMinutes: 60,
  name: "",
  email: "",
  phone: "",
  message: "",
  legalConsent: false,
};

const meetingRoomReservationSchema = Schema.toStandardSchemaV1(
  meetingRoomReservationEffectSchema
);

const createReservationIntentId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `meeting-room-intent-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const meetingRoomFormCardClassName =
  "relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm";

export function MeetingRoomReservationForm({
  locale,
}: MeetingRoomReservationFormProps) {
  const router = useRouter();
  const { isAccepted } = useCookieConsent();
  const hasTrackedSuccessfulSubmission = useRef(false);
  const [reservationIntentId] = useState(createReservationIntentId);
  const [submissionMessage, setSubmissionMessage] =
    useState<SubmissionMessage | null>(null);
  const form = useForm<
    MeetingRoomReservationInput,
    unknown,
    MeetingRoomReservationData
  >({
    resolver: standardSchemaResolver(meetingRoomReservationSchema),
    defaultValues: meetingRoomDefaultValues,
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
        Number(selectedDurationMinutes)
      ),
    [selectedDurationMinutes, selectedStartDateTime]
  );
  const availabilityQuery = useMemo(
    () =>
      selectedInterval
        ? {
            _tag: "meeting-room" as const,
            date: selectedInterval.date,
            from: selectedInterval.date,
            to: getMeetingRoomAvailabilityToDate(selectedInterval),
            startsAt: selectedInterval.startsAt,
            endsAt: selectedInterval.endsAt,
          }
        : null,
    [selectedInterval]
  );
  const availabilityQueryResult = useQuery({
    queryKey: availabilityQuery
      ? workspaceAvailabilityKeys.availability(availabilityQuery)
      : ["workspace-availability", "meeting-room", "empty"],
    queryFn: () => getWorkspaceAvailability(availabilityQuery!),
    enabled: Boolean(availabilityQuery),
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
  const selectedDurationPrice = isWorkspaceMeetingRoomDuration(
    Number(selectedDurationMinutes)
  )
    ? getWorkspaceMeetingRoomPriceForDuration(
        Number(selectedDurationMinutes) as WorkspaceMeetingRoomDurationMinutes
      )
    : getWorkspaceMeetingRoomPriceForDuration(60);

  const {
    executeAsync: sendReservation,
    isExecuting: isSendingReservation,
    result: preparePayStateResult,
  } = useAction(preparePayState, {
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
        track("workspace_checkout_started", { product: "meeting-room" });
      }

      router.push(redirectUrl);
    },
    onError: ({ error }) => {
      setSubmissionMessage({
        status: "error",
        text: error.serverError || m.reservationErrorMessage({}, { locale }),
      });
    },
  });
  const hasPreparedPayRedirect =
    preparePayStateResult.data?.status === "ready" &&
    Boolean(preparePayStateResult.data.redirectUrl);
  const isPreparingCheckout = isSendingReservation || hasPreparedPayRedirect;
  const handleSubmit = form.handleSubmit(async (data) => {
    if (hasPreparedPayRedirect) return;

    const interval = getMeetingRoomReservationInterval(
      data.startDateTime,
      data.durationMinutes
    );
    if (!interval) return;

    setSubmissionMessage(null);
    if (isSelectedReservationUnavailable) {
      setSubmissionMessage({
        status: "error",
        text: m.reservationAvailabilityUnavailable(
          {
            date: data.startDateTime,
            tier: m.reservationTierMeetingRoomTitle({}, { locale }),
          },
          { locale }
        ),
      });
      return;
    }

    await sendReservation({
      locale,
      reservationIntentId,
      legalConsent: data.legalConsent,
      reservation: {
        entryTier: "meeting-room",
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
        name: data.name,
        email: data.email,
        phone: data.phone,
        message: data.message,
      },
    });
  });

  if (isPreparingCheckout) {
    return <CheckoutPayPageSkeleton locale={locale} />;
  }

  return (
    <Card className={meetingRoomFormCardClassName}>
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardContent className="pt-6">
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-7">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
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
                    <FormControl>
                      <DateTimePicker
                        locale={locale}
                        name={field.name}
                        onBlur={field.onBlur}
                        onChange={field.onChange}
                        placeholder={m.reservationDatePlaceholder(
                          {},
                          { locale }
                        )}
                        value={field.value}
                        variant={fieldState.error ? "error" : "default"}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="rounded-[1.35rem] border border-navy-blue/10 bg-linear-to-br from-sunset-yellow/16 to-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
                  <Clock className="h-4 w-4 text-burned-orange" />
                  {m.reservationMeetingRoomPricePreviewLabel({}, { locale })}
                </div>
                <p className="mt-3 text-3xl font-semibold text-navy-blue">
                  {formatWorkspaceMoney(selectedDurationPrice, locale)}
                </p>
              </div>
            </div>

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
                        const isSelected = Number(field.value) === duration;

                        return (
                          <label
                            key={duration}
                            className={cn(
                              "cursor-pointer rounded-[1.1rem] border bg-white p-4 transition hover:-translate-y-0.5 hover:border-burned-orange/45",
                              isSelected
                                ? "border-burned-orange ring-4 ring-burned-orange/10"
                                : "border-navy-blue/10"
                            )}
                          >
                            <input
                              type="radio"
                              className="sr-only"
                              checked={isSelected}
                              value={duration}
                              onChange={() => field.onChange(duration)}
                              onBlur={field.onBlur}
                              ref={field.ref}
                            />
                            <span className="block font-semibold text-navy-blue">
                              {getWorkspaceProductMessage(
                                getMeetingRoomDurationMessage(duration),
                                locale
                              )}
                            </span>
                            <span className="mt-2 block text-sm font-semibold text-burned-orange">
                              {formatWorkspaceMoney(
                                getWorkspaceMeetingRoomPriceForDuration(
                                  duration
                                ),
                                locale
                              )}
                            </span>
                          </label>
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
                  isAvailabilityLoading
                }
              >
                <ArrowRight className="h-4 w-4" />
                {m.checkoutContinueButton({}, { locale })}
              </Button>

              {!!submissionMessage && (
                <p
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
                  <span>{submissionMessage.text}</span>
                </p>
              )}
              {isSelectedReservationUnavailable && !submissionMessage && (
                <p
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue"
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
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export function MeetingRoomReservationFormFallback({
  locale,
}: MeetingRoomReservationFormProps) {
  return (
    <Card
      aria-busy="true"
      aria-label={m.reservationMeetingRoomFormTitle({}, { locale })}
      className={meetingRoomFormCardClassName}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardContent className="pt-6">
        <div aria-hidden="true" className="space-y-7">
          <div className="grid gap-5 md:grid-cols-2">
            <SkeletonField />
            <SkeletonField />
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
