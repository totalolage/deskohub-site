"use client";

import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { track } from "@vercel/analytics/react";
import { Schema } from "effect";
import {
  AlertTriangle,
  ArrowRight,
  CalendarIcon,
  Coffee,
  Monitor,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { type Control, useForm, useWatch } from "react-hook-form";
import {
  type AdvertisedPriceRequest,
  isCoworkAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { CheckoutPayPageSkeleton } from "@/features/checkout/components/checkout-pay-page";
import { CheckoutSummaryDiscountDetails } from "@/features/checkout/components/checkout-summary-discount-details";
import {
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
  getWorkspaceProductTierTitle,
  workspaceProductMonitorMessages,
  workspaceProductTierBulletMessages,
  workspaceProductTierMessages,
} from "@/features/checkout/product-catalog.i18n";
import { formatWorkspaceMoney } from "@/features/checkout/workspace-money";
import { useCookieConsent } from "@/features/cookie-consent";
import { type Locale, m } from "@/features/i18n";
import { preparePayState } from "@/features/reservation/actions/prepare-pay-state";
import { useAdvertisedPrice } from "@/features/reservation/components/use-advertised-price";
import {
  type CoworkReservationData,
  type CoworkReservationInput,
  coworkReservationSchema,
  getAllowedMonitorOptionsForCoworkTier,
  getCoworkReservationOrder,
  getCoworkTierIncludesCourtesyCoffee,
  getCoworkTierRequiresMonitorOption,
  type NormalizedCoworkReservationOrder,
} from "@/features/reservation/cowork-reservation";
import { normalizeCoworkReservationProduct } from "@/features/reservation/cowork-reservation-product";
import { getReservationAvailabilityUnavailableMessage } from "@/features/reservation/reservation.i18n";
import {
  getReservationDefaultValuesFromPayState,
  getReservationDefaultValuesFromSearchParams,
  getWorkspaceAvailabilityQueryFromReservationSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import {
  formatReservationDisplayDate,
  parseReservationInputDate,
} from "@/features/reservation/reservation-date";
import {
  parseWorkspaceAvailabilityResponse,
  type WorkspaceAvailability,
  type WorkspaceAvailabilityQuery,
  workspaceAvailabilityKeys,
} from "@/features/reservation/workspace-availability";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { Switch } from "@/shared/components/ui/switch";
import { Textarea } from "@/shared/components/ui/textarea";
import { cn } from "@/shared/utils";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";

type ReservationFormProps = {
  initialReservation?: NormalizedCoworkReservationOrder;
  locale: Locale;
  checkoutSessionId?: string;
};

type ReservationFormFallbackProps = Pick<ReservationFormProps, "locale"> & {
  showMonitorOption?: boolean;
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

type CoworkAvailabilityQuery = Extract<
  WorkspaceAvailabilityQuery,
  { readonly kind: "cowork" }
>;

const reservationFormSchema = Schema.toStandardSchemaV1(
  coworkReservationSchema
);

const tierOptions: ReadonlyArray<{
  product: WorkspaceProductCatalogItem;
  value: WorkspaceProductTier;
  title: Parameters<typeof getWorkspaceProductMessage>[0];
  description: Parameters<typeof getWorkspaceProductMessage>[0];
}> = workspaceProductCatalog.map((product) => ({
  product,
  value: product.tier,
  ...workspaceProductTierMessages[product.tier],
}));

const monitorOptions: ReadonlyArray<{
  value: WorkspaceProductMonitorOption;
  title: Parameters<typeof getWorkspaceProductMessage>[0];
  description: Parameters<typeof getWorkspaceProductMessage>[0];
}> = workspaceProductMonitorOptions.map((option) => ({
  value: option,
  ...workspaceProductMonitorMessages[option],
}));

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

const getWorkspaceAvailabilityQuery = ({
  date,
  from,
  monitorOption,
  tier,
  to,
}: {
  date?: string;
  from: string;
  monitorOption?: string;
  tier: WorkspaceProductTier;
  to: string;
}): CoworkAvailabilityQuery => {
  return {
    kind: "cowork",
    from,
    to,
    ...(date && { date }),
    ...(isWorkspaceProductTier(tier) && { entryTier: tier }),
    ...(isWorkspaceProductMonitorOption(monitorOption) && { monitorOption }),
  };
};

const getWorkspaceAvailabilityUrl = (query: CoworkAvailabilityQuery) => {
  const params = new URLSearchParams({
    from: query.from,
    to: query.to,
  });

  if (query.date) params.set("date", query.date);
  if (query.entryTier) params.set("entryTier", query.entryTier);
  if (query.monitorOption) params.set("monitorOption", query.monitorOption);

  return `/api/workspace/availability?${params.toString()}`;
};

const loadWorkspaceAvailability = async ({
  query,
  signal,
}: {
  query: CoworkAvailabilityQuery;
  signal: AbortSignal;
}): Promise<WorkspaceAvailability> => {
  const response = await fetch(getWorkspaceAvailabilityUrl(query), { signal });
  if (!response.ok) throw new Error("Availability request failed");

  return parseWorkspaceAvailabilityResponse(await response.json());
};

const formatDisplayDate = (date: string, locale: Locale) =>
  formatReservationDisplayDate(
    date,
    locale,
    m.reservationDatePlaceholder({}, { locale })
  );

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

const createCheckoutIdentifier = () =>
  globalThis.crypto?.randomUUID?.() ??
  `checkout-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function ReservationForm({
  initialReservation,
  locale,
  checkoutSessionId: initialCheckoutSessionId,
}: ReservationFormProps) {
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
  const sanitizedUtmParams = useMemo(
    () => getSanitizedUtmParams(searchParams),
    [searchParams]
  );
  const defaultValues = useMemo(
    () =>
      initialReservation
        ? getReservationDefaultValuesFromPayState(initialReservation)
        : getReservationDefaultValuesFromSearchParams(searchParams),
    [initialReservation, searchParams]
  );
  const initialAvailabilityQuery = useMemo(
    () =>
      getWorkspaceAvailabilityQueryFromReservationSearchParams(searchParams),
    [searchParams]
  );
  const form = useForm<CoworkReservationInput, unknown, CoworkReservationData>({
    resolver: standardSchemaResolver(reservationFormSchema),
    defaultValues,
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const [selectedTier, selectedDate, selectedCoffee, selectedMonitorOption] =
    useWatch({
      control: form.control,
      name: ["entryTier", "date", "coffee", "monitorOption"],
    });
  const courtesyCoffeeIncluded =
    getCoworkTierIncludesCourtesyCoffee(selectedTier);
  const coffeePrice = getWorkspaceProductCoffeeLinePriceForTier(selectedTier);
  const coffeePriceLabel = formatWorkspaceMoney(coffeePrice, locale);
  const shouldShowMonitors = getCoworkTierRequiresMonitorOption(selectedTier);
  const allowedMonitorOptions =
    getAllowedMonitorOptionsForCoworkTier(selectedTier);
  const availabilityQuery = useMemo(
    () =>
      getWorkspaceAvailabilityQuery({
        date: selectedDate,
        from: initialAvailabilityQuery.from,
        monitorOption: selectedMonitorOption,
        tier: selectedTier,
        to: initialAvailabilityQuery.to,
      }),
    [
      initialAvailabilityQuery.from,
      initialAvailabilityQuery.to,
      selectedDate,
      selectedMonitorOption,
      selectedTier,
    ]
  );
  const availabilityQueryResult = useQuery({
    queryKey: workspaceAvailabilityKeys.availability(availabilityQuery),
    queryFn: ({ signal }) =>
      loadWorkspaceAvailability({ query: availabilityQuery, signal }),
    placeholderData: keepPreviousData,
    retry: (failureCount) => failureCount < 3,
    staleTime: 30_000,
  });
  const advertisedPriceRequest = useMemo(() => {
    if (
      !selectedDate ||
      (getCoworkTierRequiresMonitorOption(selectedTier) &&
        !isWorkspaceProductMonitorOption(selectedMonitorOption))
    ) {
      return undefined;
    }

    return {
      locale,
      reservation: {
        kind: "cowork",
        details: {
          kind: "cowork",
          ...normalizeCoworkReservationProduct({
            entryTier: selectedTier,
            coffee: Boolean(selectedCoffee),
            monitorOption: selectedMonitorOption,
          }),
          date: selectedDate,
        },
      },
    } satisfies AdvertisedPriceRequest;
  }, [
    locale,
    selectedCoffee,
    selectedDate,
    selectedMonitorOption,
    selectedTier,
  ]);
  const advertisedPriceQueryResult = useAdvertisedPrice(advertisedPriceRequest);
  const advertisedPriceData =
    advertisedPriceRequest && !advertisedPriceQueryResult.isError
      ? advertisedPriceQueryResult.data
      : undefined;
  const advertisedPrice =
    advertisedPriceData && isCoworkAdvertisedPrice(advertisedPriceData)
      ? advertisedPriceData
      : null;
  const availability = availabilityQueryResult.isError
    ? null
    : (availabilityQueryResult.data ?? null);
  const isAvailabilityLoading = availabilityQueryResult.isFetching;
  const unavailableDates = useMemo(
    () => new Set(availability?.unavailableDates ?? []),
    [availability]
  );
  const unavailableCoworkTiers = useMemo(
    () => new Set(availability?.unavailableCoworkTiers ?? []),
    [availability]
  );
  const unavailableMonitorOptions = useMemo(
    () => new Set(availability?.unavailableMonitorOptions ?? []),
    [availability]
  );
  const selectedDateNotices = useMemo(
    () =>
      (availability?.notices ?? []).filter(
        (notice) => notice.date === selectedDate
      ),
    [availability, selectedDate]
  );
  const isSelectedTierUnavailable = unavailableCoworkTiers.has(selectedTier);
  const isSelectedMonitorUnavailable = Boolean(
    selectedMonitorOption &&
      unavailableMonitorOptions.has(selectedMonitorOption)
  );
  const isSelectedDateUnavailable = Boolean(
    selectedDate && unavailableDates.has(selectedDate)
  );
  const isSelectedReservationUnavailable =
    isSelectedTierUnavailable ||
    isSelectedMonitorUnavailable ||
    isSelectedDateUnavailable;
  const selectedReservationUnavailableMessage =
    getReservationAvailabilityUnavailableMessage({
      date: selectedDate,
      dateFallback: m.reservationDatePlaceholder({}, { locale }),
      locale,
      tier: selectedTier,
    });

  const {
    execute: sendReservation,
    isExecuting: isSendingReservation,
    result: preparePayStateResult,
  } = useWorkspaceAction(preparePayState, {
    actionName: "preparePayState",
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
    onTransportError: () => {
      setSubmissionMessage({
        status: "error",
        text: m.reservationErrorMessage({}, { locale }),
      });
    },
  });

  useEffect(() => {
    if (shouldShowMonitors) {
      return;
    }

    form.setValue("monitorOption", undefined, { shouldValidate: true });
  }, [form, shouldShowMonitors]);

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
          text: selectedReservationUnavailableMessage,
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
      const reservation = getCoworkReservationOrder(data);
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
    <Card className={reservationFormCardClassName}>
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />
      <CardContent className="pt-6">
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
                        const bulletContent =
                          workspaceProductTierBulletMessages[option.value];
                        const inputId = `reservation-entry-tier-${option.value}`;
                        const optionTitle = getWorkspaceProductMessage(
                          option.title,
                          locale
                        );
                        const isUnavailable = unavailableCoworkTiers.has(
                          option.value
                        );
                        const advertisedProductItem =
                          option.value === selectedTier
                            ? advertisedPrice?.quote.summary.sections
                                .find(({ key }) => key === "order")
                                ?.items.find(
                                  (item) =>
                                    "product" in item &&
                                    item.product.kind === "cowork" &&
                                    item.product.tier === option.value
                                )
                            : undefined;

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
                            <div className="relative z-20 flex flex-wrap items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-burned-orange">
                              <label
                                className={cn(
                                  "flex cursor-pointer flex-wrap items-center gap-2",
                                  isUnavailable && "cursor-not-allowed"
                                )}
                                data-reservation-tier-price={option.value}
                                data-reservation-tier-price-ready={Boolean(
                                  advertisedProductItem
                                )}
                                htmlFor={inputId}
                              >
                                {advertisedProductItem &&
                                "originalAmount" in advertisedProductItem &&
                                advertisedProductItem.originalAmount &&
                                advertisedProductItem.discounts ? (
                                  <>
                                    <span className="sr-only">
                                      {m.checkoutSummaryOriginalPrice(
                                        {
                                          price: formatWorkspaceMoney(
                                            advertisedProductItem.originalAmount,
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
                                        advertisedProductItem.originalAmount,
                                        locale
                                      )}
                                    </del>
                                    <span className="sr-only">
                                      {m.checkoutSummaryDiscountedPrice(
                                        {
                                          price: formatWorkspaceMoney(
                                            advertisedProductItem.amount,
                                            locale
                                          ),
                                        },
                                        { locale }
                                      )}
                                    </span>
                                    <span aria-hidden="true">
                                      {formatWorkspaceMoney(
                                        advertisedProductItem.amount,
                                        locale
                                      )}
                                    </span>
                                  </>
                                ) : (
                                  formatWorkspaceProductCurrencyAmount(
                                    option.product,
                                    locale
                                  )
                                )}
                                {m.pricingTariffPricePeriodSuffix(
                                  {},
                                  { locale }
                                )}
                              </label>
                              {advertisedProductItem &&
                                "originalAmount" in advertisedProductItem &&
                                advertisedProductItem.originalAmount &&
                                advertisedProductItem.discounts && (
                                  <CheckoutSummaryDiscountDetails
                                    discounts={advertisedProductItem.discounts}
                                    locale={locale}
                                    productLabel={getWorkspaceProductTierTitle(
                                      option.value,
                                      locale
                                    )}
                                  />
                                )}
                            </div>
                            <div className="text-sm leading-5 text-navy-blue/62">
                              <ul className="list-disc space-y-0.5 pl-4">
                                {bulletContent.main.map((message) => {
                                  const text = getWorkspaceProductMessage(
                                    message,
                                    locale
                                  );

                                  return <li key={text}>{text}</li>;
                                })}
                              </ul>
                            </div>
                            <div className="space-y-1 text-sm leading-5 text-navy-blue/62">
                              <span className="block font-semibold leading-5 text-navy-blue/72">
                                {getWorkspaceProductMessage(
                                  bulletContent.perksLabel,
                                  locale
                                )}
                              </span>
                              <ul className="space-y-0.5">
                                {bulletContent.perks.map((perk) => {
                                  const text = getWorkspaceProductMessage(
                                    perk.message,
                                    locale
                                  );

                                  return (
                                    <li
                                      key={`${perk.marker ?? "bullet"}-${text}`}
                                      className={cn(
                                        "flex gap-1.5 leading-5",
                                        perk.highlighted && "text-burned-orange"
                                      )}
                                    >
                                      <span
                                        aria-hidden="true"
                                        className="w-3 shrink-0 text-center"
                                      >
                                        {perk.marker === "plus"
                                          ? "+"
                                          : "\u2022"}
                                      </span>
                                      <span>{text}</span>
                                    </li>
                                  );
                                })}
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
                                  if (!isUnavailable)
                                    field.onChange(option.value);
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

            <div className="grid gap-5 [grid-template-areas:'date'_'notice'_'coffee'] md:grid-cols-2 md:[grid-template-areas:'date_coffee'_'notice_notice']">
              <div className="[grid-area:date]">
                <ReservationDateField
                  control={form.control}
                  locale={locale}
                  unavailableDates={unavailableDates}
                />
              </div>

              {selectedDateNotices.length > 0 && (
                <div className="space-y-3 [grid-area:notice]">
                  {selectedDateNotices.map((notice) => (
                    <p
                      key={`${notice.date}-${notice.startsAt}-${notice.endsAt}`}
                      aria-live="polite"
                      className="flex items-start gap-2 rounded-2xl border border-dashed border-sunset-yellow/45 bg-sunset-yellow/14 px-4 py-3 text-sm leading-6 text-navy-blue/50"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-chilean-fire" />
                      <span>
                        {m.reservationAvailabilityPartialNotice(
                          {
                            startsAt: notice.startsAt,
                            endsAt: notice.endsAt,
                          },
                          { locale }
                        )}
                      </span>
                    </p>
                  ))}
                </div>
              )}

              <div className="[grid-area:coffee]">
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
                            const isUnavailable = unavailableMonitorOptions.has(
                              option.value
                            );

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
                                    if (!isUnavailable)
                                      field.onChange(option.value);
                                  }}
                                />
                                <span className="block font-semibold text-navy-blue">
                                  {getWorkspaceProductMessage(
                                    option.title,
                                    locale
                                  )}
                                </span>
                                <span className="mt-1 block text-sm leading-5 text-navy-blue/60">
                                  {getWorkspaceProductMessage(
                                    option.description,
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
              {isSelectedReservationUnavailable && !submissionMessage && (
                <p
                  aria-live="polite"
                  className="flex items-start gap-2 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-burned-orange" />
                  <span>{selectedReservationUnavailableMessage}</span>
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
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-burned-orange/20 bg-burned-orange/8 px-4 py-3 text-sm leading-6 text-navy-blue"
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

function ReservationDateField({
  control,
  locale,
  unavailableDates,
}: {
  readonly control: Control<
    CoworkReservationInput,
    unknown,
    CoworkReservationData
  >;
  readonly locale: Locale;
  readonly unavailableDates: ReadonlySet<string>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <FormField
      control={control}
      name="date"
      render={({ field }) => (
        <FormItem>
          <FormLabel
            className="text-sm font-semibold uppercase tracking-[0.14em] text-navy-blue/72"
            required
          >
            {m.reservationDateLabel({}, { locale })}
          </FormLabel>
          <Popover open={open} onOpenChange={setOpen}>
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
                selected={parseReservationInputDate(field.value)}
                onSelect={(date) => {
                  if (!date) return;

                  field.onChange(formatDateForInput(date));
                  setOpen(false);
                }}
                disabled={[
                  { before: new Date() },
                  (date) => unavailableDates.has(formatDateForInput(date)),
                ]}
              />
            </PopoverContent>
          </Popover>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function ReservationFormFallback({
  locale,
  showMonitorOption = false,
}: ReservationFormFallbackProps) {
  return (
    <Card
      aria-busy="true"
      aria-label={m.reservationFormTitle({}, { locale })}
      className={reservationFormCardClassName}
    >
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-linear-to-r from-transparent via-sunset-yellow/80 to-transparent" />

      <CardContent className="pt-6">
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
            <SkeletonBlock className="h-34 w-full rounded-[1.1rem]" />
          </div>

          {showMonitorOption && <SkeletonMonitorOptionField />}

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
  control: Control<CoworkReservationInput, unknown, CoworkReservationData>;
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
