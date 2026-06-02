"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { track } from "@vercel/analytics/react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarIcon,
  Coffee,
  Monitor,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Control, useForm } from "react-hook-form";
import {
  formatWorkspaceMoney,
  formatWorkspaceProductCurrencyAmount,
  getWorkspaceProductCoffeeLinePriceForTier,
  isWorkspaceProductMonitorOption,
  isWorkspaceProductTier,
  type WorkspaceProductCatalogItem,
  type WorkspaceProductMonitorOption,
  type WorkspaceProductTier,
  workspaceProductCatalog,
  workspaceProductMonitorOptions,
} from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMessage,
  workspaceProductMonitorMessageKeys,
  workspaceProductTierBulletMessageKeys,
  workspaceProductTierMessageKeys,
} from "@/features/checkout/product-catalog.i18n";
import { useCookieConsent } from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
import { preparePayState } from "@/features/reservation/actions/prepare-pay-state";
import {
  getAllowedMonitorOptionsForTier,
  getReservationSchema,
  type ReservationData,
  type ReservationInput,
  tierIncludesCourtesyCoffee,
  tierRequiresMonitorOption,
} from "@/features/reservation/schemas/reservation";
import { getReservationDefaultValuesFromSearchParams } from "@/features/reservation/schemas/reservation-checkout-query";
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
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";

type ReservationFormProps = {
  locale: Locale;
  showIntro?: boolean;
};

type ReservationFormFallbackProps = ReservationFormProps & {
  showMonitorOption?: boolean;
};

type SubmissionMessage = {
  status: "error";
  text: string;
};

type WorkspaceAvailability = {
  readonly unavailableDates: readonly string[];
  readonly unavailableTiers: readonly WorkspaceProductTier[];
  readonly unavailableMonitorOptions: readonly WorkspaceProductMonitorOption[];
};

const getObjectProperty = (value: unknown, key: string): unknown => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return Object.getOwnPropertyDescriptor(value, key)?.value;
};

const getStringArrayProperty = (value: unknown, key: string): readonly string[] => {
  const property = getObjectProperty(value, key);

  if (!Array.isArray(property)) {
    return [];
  }

  return property.filter((item): item is string => typeof item === "string");
};

const parseWorkspaceAvailabilityResponse = (
  value: unknown
): WorkspaceAvailability => ({
  unavailableDates: getStringArrayProperty(value, "unavailableDates"),
  unavailableTiers: getStringArrayProperty(value, "unavailableTiers").filter(
    isWorkspaceProductTier
  ),
  unavailableMonitorOptions: getStringArrayProperty(
    value,
    "unavailableMonitorOptions"
  ).filter(isWorkspaceProductMonitorOption),
});

const utmKeys = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

type UtmKey = (typeof utmKeys)[number];

type SanitizedUtmParams = Partial<Record<UtmKey, string>>;

const tierOptions = workspaceProductCatalog.map((product) => ({
  product,
  value: product.tier,
  ...workspaceProductTierMessageKeys[product.tier],
})) satisfies ReadonlyArray<{
  product: WorkspaceProductCatalogItem;
  value: WorkspaceProductTier;
  titleKey: keyof typeof m;
  descriptionKey: keyof typeof m;
}>;

const tierBulletContent = workspaceProductTierBulletMessageKeys;

const monitorOptions = workspaceProductMonitorOptions.map((option) => ({
  value: option,
  ...workspaceProductMonitorMessageKeys[option],
})) satisfies ReadonlyArray<{
  value: WorkspaceProductMonitorOption;
  titleKey: keyof typeof m;
  descriptionKey: keyof typeof m;
}>;

const reservationFormCardClassName =
  "relative overflow-hidden rounded-4xl border-white/55 bg-white/94 text-navy-blue shadow-[0_44px_140px_-54px_rgba(0,2,79,0.62)] backdrop-blur-sm";

const reservationFormSkeletonClassName =
  "rounded-full bg-navy-blue/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]";

const fallbackTierCards = ["tier-1", "tier-2", "tier-3"] as const;

const formatDateForInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const addMonthsToInputDate = (date: string, months: number) =>
  Temporal.PlainDate.from(date).add({ months }).toString();

const parseInputDate = (date: string) => {
  if (!date) {
    return undefined;
  }

  return new Date(`${date}T12:00:00`);
};

const formatDisplayDate = (date: string, locale: Locale) => {
  const parsedDate = parseInputDate(date);

  if (!parsedDate) {
    return m.reservationDatePlaceholder({}, { locale });
  }

  return parsedDate.toLocaleDateString(locale, {
    dateStyle: "full",
    timeZone: "Europe/Prague",
  });
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

export function ReservationForm({
  locale,
  showIntro = true,
}: ReservationFormProps) {
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
  const defaultValues = useMemo(
    () => getReservationDefaultValuesFromSearchParams(searchParams),
    [searchParams]
  );
  const form = useForm<ReservationInput, unknown, ReservationData>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const selectedTier = form.watch("entryTier");
  const selectedDate = form.watch("date");
  const selectedMonitorOption = form.watch("monitorOption");
  const courtesyCoffeeIncluded = tierIncludesCourtesyCoffee(selectedTier);
  const coffeePrice = getWorkspaceProductCoffeeLinePriceForTier(selectedTier);
  const coffeePriceLabel = formatWorkspaceMoney(coffeePrice, locale);
  const shouldShowMonitors = tierRequiresMonitorOption(selectedTier);
  const allowedMonitorOptions = getAllowedMonitorOptionsForTier(selectedTier);
  const [availability, setAvailability] =
    useState<WorkspaceAvailability | null>(null);
  const [isAvailabilityLoading, setIsAvailabilityLoading] = useState(false);
  const unavailableDates = useMemo(
    () => new Set(availability?.unavailableDates ?? []),
    [availability]
  );
  const unavailableTiers = useMemo(
    () => new Set(availability?.unavailableTiers ?? []),
    [availability]
  );
  const unavailableMonitorOptions = useMemo(
    () => new Set(availability?.unavailableMonitorOptions ?? []),
    [availability]
  );
  const isSelectedTierUnavailable = unavailableTiers.has(selectedTier);
  const isSelectedMonitorUnavailable = Boolean(
    selectedMonitorOption && unavailableMonitorOptions.has(selectedMonitorOption)
  );
  const isSelectedDateUnavailable = Boolean(
    selectedDate && unavailableDates.has(selectedDate)
  );
  const isSelectedReservationUnavailable =
    isSelectedTierUnavailable ||
    isSelectedMonitorUnavailable ||
    isSelectedDateUnavailable;

  const { executeAsync: sendReservation } = useAction(preparePayState, {
    onSuccess: ({ data }) => {
      if (data?.status === "error") {
        setSubmissionMessage({
          status: "error",
          text: data.message,
        });
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
        track("workspace_checkout_started", sanitizedUtmParams);
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
    if (shouldShowMonitors) {
      return;
    }

    form.setValue("monitorOption", undefined, { shouldValidate: true });
  }, [form, shouldShowMonitors]);

  useEffect(() => {
    const controller = new AbortController();
    const today = formatDateForInput(new Date());
    const params = new URLSearchParams({
      from: today,
      to: addMonthsToInputDate(today, 6),
    });

    if (selectedDate) params.set("date", selectedDate);
    if (isWorkspaceProductTier(selectedTier)) {
      params.set("entryTier", selectedTier);
    }
    if (isWorkspaceProductMonitorOption(selectedMonitorOption)) {
      params.set("monitorOption", selectedMonitorOption);
    }

    setIsAvailabilityLoading(true);
    fetch(`/api/workspace/availability?${params.toString()}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Availability request failed");
        return parseWorkspaceAvailabilityResponse(await response.json());
      })
      .then((nextAvailability) => setAvailability(nextAvailability))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setAvailability(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsAvailabilityLoading(false);
      });

    return () => controller.abort();
  }, [selectedDate, selectedMonitorOption, selectedTier]);

  const handleSubmit = form.handleSubmit(async (data) => {
    setSubmissionMessage(null);
    if (isSelectedReservationUnavailable) {
      setSubmissionMessage({
        status: "error",
        text: m.reservationAvailabilityUnavailable({}, { locale }),
      });
      return;
    }
    hasTrackedSuccessfulSubmission.current = false;
    await sendReservation({
      locale,
      legalConsent: data.legalConsent,
      reservation: {
        ...data,
        coffee: tierIncludesCourtesyCoffee(data.entryTier) ? true : data.coffee,
        monitorOption: tierRequiresMonitorOption(data.entryTier)
          ? data.monitorOption
          : undefined,
      },
    });
  });

  return (
    <Card className={reservationFormCardClassName}>
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      {showIntro ? (
        <CardHeader className="space-y-3 pb-6">
          <CardTitle className="text-3xl sm:text-[2.35rem]">
            {m.reservationFormTitle({}, { locale })}
          </CardTitle>
          <CardDescription className="max-w-2xl text-base leading-7 text-navy-blue/72">
            {m.reservationFormDescription({}, { locale })}
          </CardDescription>
        </CardHeader>
      ) : null}

      <CardContent className={showIntro ? undefined : "pt-6"}>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-7">
            <FormField
              control={form.control}
              name="entryTier"
              render={({ field }) => (
                <FormItem>
                  <FormLabel
                    className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
                    required
                  >
                    {m.reservationTierLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <div className="grid gap-3 lg:grid-cols-3 lg:gap-x-3 lg:gap-y-3">
                      {tierOptions.map((option) => {
                        const isSelected = field.value === option.value;
                        const bulletContent = tierBulletContent[option.value];
                        const inputId = `reservation-entry-tier-${option.value}`;
                        const optionTitle = getWorkspaceProductMessage(
                          option.titleKey,
                          locale
                        );
                        const isUnavailable = unavailableTiers.has(
                          option.value
                        );

                        return (
                          <div
                            key={option.value}
                            data-reservation-tier-option={option.value}
                            className={cn(
                              "group relative flex cursor-pointer flex-col gap-3 rounded-[1.4rem] border p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_44px_-28px_rgba(0,2,79,0.7)] lg:row-span-4 lg:grid lg:grid-rows-subgrid",
                              isUnavailable &&
                                "cursor-not-allowed opacity-45 hover:translate-y-0 hover:shadow-none",
                              isSelected
                                ? "border-burned-orange bg-burned-orange/8 ring-4 ring-burned-orange/10"
                                : "border-navy-blue/10 bg-white hover:border-burned-orange/45"
                            )}
                          >
                            <label
                              htmlFor={inputId}
                              className={cn(
                                "relative z-10 flex cursor-pointer items-start justify-between gap-2",
                                isUnavailable && "cursor-not-allowed"
                              )}
                            >
                              <span className="text-lg leading-6">
                                {optionTitle}
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
                            </label>
                            <span className="text-sm font-semibold uppercase tracking-[0.12em] text-burned-orange">
                              {formatWorkspaceProductCurrencyAmount(
                                option.product,
                                locale
                              )}
                              {m.pricingTariffPricePeriodSuffix({}, { locale })}
                            </span>
                            <div className="text-sm leading-5 text-navy-blue/62">
                              <ul className="list-disc space-y-0.5 pl-4">
                                {bulletContent.main.map((key) => (
                                  <li key={key}>
                                    {getWorkspaceProductMessage(key, locale)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="space-y-1 text-sm leading-5 text-navy-blue/62">
                              <span className="block font-semibold leading-5 text-navy-blue/72">
                                {getWorkspaceProductMessage(
                                  bulletContent.perksLabelKey,
                                  locale
                                )}
                              </span>
                              <ul className="space-y-0.5">
                                {bulletContent.perks.map((perk) => (
                                  <li
                                    key={perk.key}
                                    className={cn(
                                      "flex gap-1.5 leading-5",
                                      perk.highlighted && "text-burned-orange"
                                    )}
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="w-3 shrink-0 text-center"
                                    >
                                      {perk.marker === "plus" ? "+" : "\u2022"}
                                    </span>
                                    <span>
                                      {getWorkspaceProductMessage(
                                        perk.key,
                                        locale
                                      )}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <label
                              htmlFor={inputId}
                              className={cn(
                                "absolute inset-0 cursor-pointer rounded-[1.4rem]",
                                isUnavailable && "cursor-not-allowed"
                              )}
                            >
                              <input
                                id={inputId}
                                name={field.name}
                                type="radio"
                                className="sr-only"
                                checked={isSelected}
                                value={option.value}
                                disabled={isUnavailable}
                                onChange={() => {
                                  if (!isUnavailable) field.onChange(option.value);
                                }}
                                onBlur={field.onBlur}
                                ref={field.ref}
                              />
                            </label>
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
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel
                      className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
                      required
                    >
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
                          disabled={[
                            { before: new Date() },
                            (date) =>
                              unavailableDates.has(formatDateForInput(date)),
                          ]}
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
                    <FormLabel className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72">
                      {m.reservationCoffeeLabel({}, { locale })}
                    </FormLabel>
                    <FormLabel
                      className={cn(
                        "flex h-13 items-center justify-between gap-3 rounded-[1.1rem] border border-navy-blue/10 bg-linear-to-br from-sunset-yellow/18 to-white px-4 py-3 text-navy-blue transition",
                        !courtesyCoffeeIncluded &&
                          "cursor-pointer hover:border-burned-orange/30",
                        courtesyCoffeeIncluded && "cursor-default"
                      )}
                    >
                      <span className="flex items-center gap-3">
                        <Coffee className="h-5 w-5 shrink-0 text-burned-orange" />
                        <FormControl>
                          <Switch
                            checked={
                              courtesyCoffeeIncluded ? true : field.value
                            }
                            disabled={courtesyCoffeeIncluded}
                            onBlur={field.onBlur}
                            onCheckedChange={(checked) =>
                              field.onChange(Boolean(checked))
                            }
                          />
                        </FormControl>
                      </span>
                      <span className="text-sm font-semibold text-navy-blue before:content-['+']">
                        {coffeePriceLabel}
                      </span>
                    </FormLabel>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

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

            {shouldShowMonitors && (
              <FormField
                control={form.control}
                name="monitorOption"
                render={({ field }) => (
                  <FormItem className="rounded-3xl border border-aquamarine-green/25 bg-aquamarine-green/8 p-4">
                    <FormLabel
                      className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
                      required
                    >
                      <Monitor className="h-4 w-4 text-aquamarine-green" />
                      {m.reservationMonitorLabel({}, { locale })}
                    </FormLabel>
                    <FormControl>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {monitorOptions
                          .filter((option) =>
                            allowedMonitorOptions.includes(option.value)
                          )
                          .map((option) => {
                            const isSelected = field.value === option.value;
                            const isUnavailable =
                              unavailableMonitorOptions.has(option.value);

                            return (
                              <label
                                key={option.value}
                                className={cn(
                                  "cursor-pointer rounded-[1.1rem] border p-3 transition hover:-translate-y-0.5",
                                  isUnavailable &&
                                    "cursor-not-allowed opacity-45 hover:translate-y-0",
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
                                  disabled={isUnavailable}
                                  onChange={() => {
                                    if (!isUnavailable) field.onChange(option.value);
                                  }}
                                />
                                <span className="block font-semibold text-navy-blue">
                                  {getWorkspaceProductMessage(
                                    option.titleKey,
                                    locale
                                  )}
                                </span>
                                <span className="mt-1 block text-sm leading-5 text-navy-blue/60">
                                  {getWorkspaceProductMessage(
                                    option.descriptionKey,
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
            )}

            <FormField
              control={form.control}
              name="legalConsent"
              render={({ field }) => (
                <FormItem>
                  <label
                    htmlFor="reservation-privacy-consent"
                    className="flex cursor-pointer items-start gap-3 rounded-[1.35rem] border border-navy-blue/10 bg-navy-blue/2.5 p-4"
                  >
                    <FormControl>
                      <Checkbox
                        id="reservation-privacy-consent"
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
                  form.formState.isSubmitSuccessful ||
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
                  className={cn(
                    "flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm leading-6",
                    "border-burned-orange/20 bg-burned-orange/8 text-navy-blue"
                  )}
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
                  <span>{submissionMessage.text}</span>
                </p>
              )}
              {isSelectedReservationUnavailable && !submissionMessage ? (
                <p
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
                  <span>
                    {m.reservationAvailabilityUnavailable({}, { locale })}
                  </span>
                </p>
              ) : null}
              {isAvailabilityLoading && !submissionMessage ? (
                <p
                  aria-live="polite"
                  className="text-sm leading-6 text-navy-blue/62"
                >
                  {m.reservationAvailabilityLoading({}, { locale })}
                </p>
              ) : null}
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export function ReservationFormFallback({
  locale,
  showIntro = true,
  showMonitorOption = false,
}: ReservationFormFallbackProps) {
  return (
    <Card
      aria-busy="true"
      aria-label={m.reservationFormTitle({}, { locale })}
      className={reservationFormCardClassName}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />

      {showIntro ? (
        <CardHeader className="space-y-3 pb-6">
          <SkeletonBlock className="h-10 w-4/5 max-w-xl sm:h-11" />
          <div className="max-w-2xl space-y-2">
            <SkeletonBlock className="h-4 w-full" />
            <SkeletonBlock className="h-4 w-5/6" />
          </div>
        </CardHeader>
      ) : null}

      <CardContent className={showIntro ? undefined : "pt-6"}>
        <div aria-hidden="true" className="space-y-7">
          <div className="space-y-2">
            <SkeletonBlock className="h-4 w-28" />
            <div className="grid gap-3 lg:grid-cols-3 lg:gap-x-3 lg:gap-y-3">
              {fallbackTierCards.map((tierCard) => (
                <div
                  className="rounded-[1.4rem] border border-navy-blue/10 bg-white p-4"
                  key={tierCard}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <SkeletonBlock className="h-6 w-32" />
                      <SkeletonBlock className="h-4 w-4 shrink-0 rounded-full" />
                    </div>
                    <SkeletonBlock className="h-4 w-24 bg-burned-orange/15" />
                    <div className="space-y-2 pt-1">
                      <SkeletonBlock className="h-3 w-full" />
                      <SkeletonBlock className="h-3 w-11/12" />
                      <SkeletonBlock className="h-3 w-4/5" />
                    </div>
                    <div className="space-y-2 pt-1">
                      <SkeletonBlock className="h-4 w-24" />
                      <SkeletonBlock className="h-3 w-full" />
                      <SkeletonBlock className="h-3 w-10/12" />
                      <SkeletonBlock className="h-3 w-9/12" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <SkeletonField />
            <SkeletonField />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <SkeletonField />
            <SkeletonField />
          </div>

          <SkeletonField />

          <div className="space-y-2">
            <SkeletonBlock className="h-4 w-36" />
            <SkeletonBlock className="h-[8.5rem] w-full rounded-[1.1rem]" />
          </div>

          {showMonitorOption ? <SkeletonMonitorOptionField /> : null}

          <div className="space-y-3 pt-1">
            <SkeletonBlock className="h-13 w-full rounded-full bg-burned-orange/18" />
            <div className="space-y-2">
              <SkeletonBlock className="h-4 w-full" />
              <SkeletonBlock className="h-4 w-4/5" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SkeletonMonitorOptionField() {
  return (
    <div className="rounded-3xl border border-aquamarine-green/25 bg-aquamarine-green/8 p-4">
      <div className="space-y-3">
        <SkeletonBlock className="h-4 w-40 bg-aquamarine-green/15" />
        <div className="grid gap-3 sm:grid-cols-3">
          {monitorOptions.map((option) => (
            <div
              className="rounded-[1.1rem] border border-navy-blue/10 bg-white/75 p-3"
              key={option.value}
            >
              <SkeletonBlock className="h-5 w-16" />
              <div className="mt-2 space-y-2">
                <SkeletonBlock className="h-3 w-full" />
                <SkeletonBlock className="h-3 w-3/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
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

function SkeletonBlock({ className }: { className: string }) {
  return <div className={cn(reservationFormSkeletonClassName, className)} />;
}

type TextFieldProps = {
  control: Control<ReservationInput, unknown, ReservationData>;
  name: "name" | "email" | "phone";
  label: string;
  placeholder: string;
  required?: boolean;
  type?: string;
  autoComplete?: string;
};

function TextField({
  control,
  name,
  label,
  placeholder,
  required = true,
  type = "text",
  autoComplete,
}: TextFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel
            className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
            required={required}
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
