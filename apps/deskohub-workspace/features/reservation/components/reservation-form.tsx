"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics/react";
import {
  AlertTriangle,
  CalendarIcon,
  Coffee,
  Monitor,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Control, useForm } from "react-hook-form";
import { useCookieConsent } from "@/features/cookie-consent";
import { m, type WorkspaceLocale } from "@/features/i18n";
import { submitReservation } from "@/features/reservation/actions/submit-reservation";
import {
  getReservationSchema,
  type ReservationData,
  type ReservationEntryTier,
  type ReservationInput,
  type ReservationMonitorOption,
  reservationDefaultValues,
  tierIncludesCourtesyCoffee,
} from "@/features/reservation/schemas/reservation";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";

type ReservationFormProps = {
  locale: WorkspaceLocale;
};

type SubmissionMessage = {
  status: "error";
  text: string;
};

const utmKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

type UtmKey = (typeof utmKeys)[number];

type SanitizedUtmParams = Partial<Record<UtmKey, string>>;

type ReservationActionResult = {
  data?: {
    redirectUrl?: string;
  };
  serverError?: unknown;
  validationErrors?: unknown;
};

const tierOptions = [
  {
    value: "basic-day-pass",
    priceKey: "reservationTierBasicPrice",
    titleKey: "reservationTierBasicTitle",
    descriptionKey: "reservationTierBasicDescription",
  },
  {
    value: "cowork-plus",
    priceKey: "reservationTierCoworkPrice",
    titleKey: "reservationTierCoworkTitle",
    descriptionKey: "reservationTierCoworkDescription",
  },
  {
    value: "profi-workstation",
    priceKey: "reservationTierProfiPrice",
    titleKey: "reservationTierProfiTitle",
    descriptionKey: "reservationTierProfiDescription",
  },
] as const satisfies ReadonlyArray<{
  value: ReservationEntryTier;
  priceKey: keyof typeof m;
  titleKey: keyof typeof m;
  descriptionKey: keyof typeof m;
}>;

const monitorOptions = [
  {
    value: "2x27",
    titleKey: "reservationMonitor2x27Title",
    descriptionKey: "reservationMonitor2x27Description",
  },
  {
    value: "2x32",
    titleKey: "reservationMonitor2x32Title",
    descriptionKey: "reservationMonitor2x32Description",
  },
  {
    value: "qhd-4k",
    titleKey: "reservationMonitorQhd4kTitle",
    descriptionKey: "reservationMonitorQhd4kDescription",
  },
] as const satisfies ReadonlyArray<{
  value: ReservationMonitorOption;
  titleKey: keyof typeof m;
  descriptionKey: keyof typeof m;
}>;

const formatDateForInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const parseInputDate = (date: string) => {
  if (!date) {
    return undefined;
  }

  return new Date(`${date}T12:00:00`);
};

const formatDisplayDate = (date: string, locale: WorkspaceLocale) => {
  const parsedDate = parseInputDate(date);

  if (!parsedDate) {
    return m.reservationDatePlaceholder({}, { locale });
  }

  return parsedDate.toLocaleDateString(locale, {
    dateStyle: "full",
    timeZone: "Europe/Prague",
  });
};

const getMessage = (key: keyof typeof m, locale: WorkspaceLocale) => {
  const message = m[key] as (
    inputs: object,
    options: { locale: WorkspaceLocale }
  ) => string;
  return message({}, { locale }) as string;
};

const getSanitizedUtmParams = (
  searchParams: URLSearchParams
): SanitizedUtmParams => {
  const sanitizedParams: SanitizedUtmParams = {};

  for (const key of utmKeys) {
    const value = searchParams.get(key)?.trim();

    if (!value) {
      continue;
    }

    sanitizedParams[key] = value.slice(0, 128);
  }

  return sanitizedParams;
};

const getErrorFreeReservationRedirectUrl = (
  result: ReservationActionResult
) => {
  if (
    typeof result.serverError !== "undefined" ||
    typeof result.validationErrors !== "undefined"
  ) {
    return undefined;
  }

  return result.data?.redirectUrl;
};

export function ReservationForm({ locale }: ReservationFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isAccepted } = useCookieConsent();
  const hasTrackedSuccessfulSubmission = useRef(false);
  const [submissionMessage, setSubmissionMessage] =
    useState<SubmissionMessage | null>(null);
  const sanitizedUtmParams = useMemo(
    () => getSanitizedUtmParams(searchParams),
    [searchParams]
  );
  const schema = useMemo(() => getReservationSchema(), []);
  const form = useForm<ReservationInput, unknown, ReservationData>({
    resolver: zodResolver(schema),
    defaultValues: reservationDefaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const selectedTier = form.watch("entryTier");
  const courtesyCoffeeIncluded = tierIncludesCourtesyCoffee(selectedTier);
  const shouldShowMonitors = selectedTier === "profi-workstation";

  const { execute, isExecuting } = useAction(submitReservation, {
    onSettled: ({ result }) => {
      const redirectUrl = getErrorFreeReservationRedirectUrl(result);

      if (!redirectUrl) {
        if (
          typeof result.serverError !== "undefined" ||
          typeof result.validationErrors !== "undefined"
        ) {
          return;
        }

        setSubmissionMessage({
          status: "error",
          text: m.reservationErrorMessage({}, { locale }),
        });
        return;
      }

      if (!hasTrackedSuccessfulSubmission.current && isAccepted("analytics")) {
        hasTrackedSuccessfulSubmission.current = true;
        track("workspace_reservation_submitted", sanitizedUtmParams);
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

  useEffect(() => {
    if (courtesyCoffeeIncluded) {
      form.setValue("coffee", true, { shouldValidate: true });
    }
  }, [courtesyCoffeeIncluded, form]);

  useEffect(() => {
    if (shouldShowMonitors) {
      return;
    }

    form.setValue("monitorOption", undefined, { shouldValidate: true });
  }, [form, shouldShowMonitors]);

  const handleSubmit = form.handleSubmit((data) => {
    setSubmissionMessage(null);
    hasTrackedSuccessfulSubmission.current = false;
    execute({
      ...data,
      coffee: tierIncludesCourtesyCoffee(data.entryTier) ? true : data.coffee,
      monitorOption:
        data.entryTier === "profi-workstation" ? data.monitorOption : undefined,
    });
  });

  return (
    <Card className="relative overflow-hidden rounded-[2rem] border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardHeader className="space-y-3 pb-6">
        <CardTitle className="text-3xl sm:text-[2.35rem]">
          {m.reservationFormTitle({}, { locale })}
        </CardTitle>
        <CardDescription className="max-w-2xl text-base leading-7 text-navy-blue/72">
          {m.reservationFormDescription({}, { locale })}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-7">
            <FormField
              control={form.control}
              name="entryTier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
                    {m.reservationTierLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <div className="grid gap-3 lg:grid-cols-3">
                      {tierOptions.map((option) => {
                        const isSelected = field.value === option.value;

                        return (
                          <label
                            key={option.value}
                            data-reservation-tier-option={option.value}
                            className={cn(
                              "group relative flex cursor-pointer flex-col gap-3 rounded-[1.4rem] border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-28px_rgba(0,2,79,0.7)]",
                              isSelected
                                ? "border-burned-orange bg-burned-orange/8 ring-4 ring-burned-orange/10"
                                : "border-navy-blue/10 bg-white hover:border-burned-orange/45"
                            )}
                          >
                            <input
                              type="radio"
                              className="sr-only"
                              checked={isSelected}
                              value={option.value}
                              onChange={() => field.onChange(option.value)}
                            />
                            <span className="flex items-start justify-between gap-2">
                              <span className="text-lg leading-6">
                                {getMessage(option.titleKey, locale)}
                              </span>
                              <span
                                data-reservation-tier-radio-visual={
                                  option.value
                                }
                                className={cn(
                                  "mt-1 h-4 w-4 shrink-0 rounded-full border transition",
                                  isSelected
                                    ? "border-burned-orange bg-burned-orange shadow-[inset_0_0_0_4px_white]"
                                    : "border-navy-blue/25"
                                )}
                              />
                            </span>
                            <span className="text-sm font-semibold uppercase tracking-[0.12em] text-burned-orange">
                              {getMessage(option.priceKey, locale)}
                            </span>
                            <span className="text-sm leading-6 text-navy-blue/62">
                              {getMessage(option.descriptionKey, locale)}
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

            <FormField
              control={form.control}
              name="date"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
                    {m.reservationDateLabel({}, { locale })}
                  </FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button
                          type="button"
                          variant="secondary"
                          className={cn(
                            "h-13 w-full justify-start rounded-[1.1rem] border-navy-blue/12 bg-white px-4 py-3 text-left text-base font-normal text-navy-blue hover:border-burned-orange/45",
                            !field.value && "text-navy-blue/44"
                          )}
                        >
                          <CalendarIcon className="h-5 w-5 text-burned-orange" />
                          {formatDisplayDate(field.value, locale)}
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-3">
                      <Calendar
                        mode="single"
                        selected={parseInputDate(field.value)}
                        onSelect={(date) => {
                          if (!date) {
                            return;
                          }

                          field.onChange(formatDateForInput(date));
                        }}
                        disabled={{ before: new Date() }}
                      />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="coffee"
              render={({ field }) => (
                <FormItem>
                  <div className="relative">
                    <FormControl>
                      <Checkbox
                        className="absolute left-4 top-4 z-10"
                        checked={courtesyCoffeeIncluded ? true : field.value}
                        disabled={courtesyCoffeeIncluded}
                        onBlur={field.onBlur}
                        onCheckedChange={(checked) =>
                          field.onChange(Boolean(checked))
                        }
                      />
                    </FormControl>
                    <FormLabel
                      className={cn(
                        "block cursor-pointer rounded-[1.3rem] border border-navy-blue/10 bg-gradient-to-br from-sunset-yellow/18 to-white py-4 pl-12 pr-4 text-navy-blue transition hover:border-burned-orange/30",
                        courtesyCoffeeIncluded && "cursor-default"
                      )}
                    >
                      <span className="block space-y-1 leading-none">
                        <span className="flex items-center gap-2 text-base font-semibold text-navy-blue">
                          <Coffee className="h-4 w-4 text-burned-orange" />
                          {m.reservationCoffeeLabel({}, { locale })}
                        </span>
                        <FormDescription className="leading-6">
                          {courtesyCoffeeIncluded
                            ? m.reservationCoffeeCourtesyNote({}, { locale })
                            : m.reservationCoffeeBasicNote({}, { locale })}
                        </FormDescription>
                      </span>
                    </FormLabel>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {shouldShowMonitors ? (
              <FormField
                control={form.control}
                name="monitorOption"
                render={({ field }) => (
                  <FormItem className="rounded-[1.5rem] border border-aquamarine-green/25 bg-aquamarine-green/8 p-4">
                    <FormLabel className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
                      <Monitor className="h-4 w-4 text-aquamarine-green" />
                      {m.reservationMonitorLabel({}, { locale })}
                    </FormLabel>
                    <FormControl>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {monitorOptions.map((option) => {
                          const isSelected = field.value === option.value;

                          return (
                            <label
                              key={option.value}
                              className={cn(
                                "cursor-pointer rounded-[1.1rem] border p-3 transition hover:-translate-y-0.5",
                                isSelected
                                  ? "border-aquamarine-green bg-white ring-4 ring-aquamarine-green/15"
                                  : "border-navy-blue/10 bg-white/75 hover:border-aquamarine-green/55"
                              )}
                            >
                              <input
                                type="radio"
                                className="sr-only"
                                checked={isSelected}
                                value={option.value}
                                onChange={() => field.onChange(option.value)}
                              />
                              <span className="block font-semibold text-navy-blue">
                                {getMessage(option.titleKey, locale)}
                              </span>
                              <span className="mt-1 block text-sm leading-5 text-navy-blue/60">
                                {getMessage(option.descriptionKey, locale)}
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
            ) : null}

            <div className="grid gap-5 md:grid-cols-2">
              <TextField
                control={form.control}
                name="name"
                label={m.contactNameLabel({}, { locale })}
                placeholder={m.contactNamePlaceholder({}, { locale })}
                autoComplete="name"
              />
              <TextField
                control={form.control}
                name="email"
                type="email"
                label={m.contactEmailLabel({}, { locale })}
                placeholder={m.contactEmailPlaceholder({}, { locale })}
                autoComplete="email"
              />
            </div>

            <TextField
              control={form.control}
              name="phone"
              label={m.contactPhoneLabel({}, { locale })}
              placeholder={m.contactPhonePlaceholder({}, { locale })}
              autoComplete="tel"
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
                      placeholder={m.reservationMessagePlaceholder(
                        {},
                        { locale }
                      )}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-3 pt-1">
              <Button
                type="submit"
                className="h-13 w-full rounded-full text-sm uppercase tracking-[0.18em]"
                disabled={isExecuting}
              >
                {isExecuting ? (
                  m.reservationSubmitPending({}, { locale })
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    {m.reservationSubmitButton({}, { locale })}
                  </>
                )}
              </Button>

              <p className="text-sm leading-6 text-navy-blue/62">
                {m.reservationPrivacyNoteBefore({}, { locale })}{" "}
                <Link
                  href={`/${locale}/privacy-policy`}
                  className="font-semibold text-burned-orange underline underline-offset-4 transition-colors hover:text-chilean-fire"
                >
                  {m.reservationPrivacyNoteLinkLabel({}, { locale })}
                </Link>{" "}
                {m.reservationPrivacyNoteAfter({}, { locale })}
              </p>

              {submissionMessage ? (
                <p
                  aria-live="polite"
                  className={cn(
                    "flex items-start gap-2 rounded-[1rem] border px-4 py-3 text-sm leading-6",
                    "border-burned-orange/20 bg-burned-orange/8 text-navy-blue"
                  )}
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
                  <span>{submissionMessage.text}</span>
                </p>
              ) : null}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

type TextFieldProps = {
  control: Control<ReservationInput, unknown, ReservationData>;
  name: "name" | "email" | "phone";
  label: string;
  placeholder: string;
  type?: string;
  autoComplete?: string;
};

function TextField({
  control,
  name,
  label,
  placeholder,
  type = "text",
  autoComplete,
}: TextFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
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
