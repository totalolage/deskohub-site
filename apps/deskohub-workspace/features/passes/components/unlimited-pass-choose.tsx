import { Coffee } from "lucide-react";
import { useId } from "react";
import { cs, de, enUS, hi, sk, uk, vi } from "react-day-picker/locale";
import { workspaceProductMonitorOptions } from "@/features/checkout/product-catalog";
import {
  getWorkspaceProductMessage,
  getWorkspaceProductMonitorTitle,
  workspaceProductMonitorDescriptionMessages,
} from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import { ReservationFormCard } from "@/features/reservation/components/reservation-form-card";
import {
  fromCalendarDate,
  toCalendarDate,
} from "@/shared/components/date-time/canonical-value";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Switch } from "@/shared/components/ui/switch";
import { formatMoney } from "@/shared/money/money";
import { cn } from "@/shared/utils";
import { formatCount } from "@/shared/utils/number";
import { type PlainDate, plainDateStringSchema } from "@/shared/utils/temporal";
import {
  getUnlimitedPassPrice,
  unlimitedPassCoffeePrice,
  unlimitedPassDays,
} from "../pass-offer";
import type { UnlimitedPassSelection } from "../unlimited-pass";
import {
  availableUnlimitedPassStarts,
  type UnlimitedPassOptions,
  type UnlimitedPassStartDates,
  unlimitedPassOptionsForTier,
} from "../unlimited-pass-checkout";
import { PassCheckoutContinue } from "./pass-checkout-continue";
import { PassTierInput } from "./pass-tier-input";

export type UnlimitedPassAvailability =
  | { readonly status: "loading" }
  | { readonly status: "unavailable"; readonly message?: string }
  | { readonly status: "ready"; readonly starts: UnlimitedPassStartDates };

const calendarLocales = {
  "cs-CZ": cs,
  "de-DE": de,
  "en-US": enUS,
  "hi-IN": hi,
  "sk-SK": sk,
  "uk-UA": uk,
  "vi-VN": vi,
} satisfies Record<Locale, typeof enUS>;

export function UnlimitedPassChoose({
  locale,
  today,
  lastStartDate,
  options,
  calendarMonth,
  numberOfMonths,
  startDate,
  fixedStartDate,
  availability,
  onOptionsChange,
  onMonthChange,
  onStartDateChange,
  onRetry,
  onContinue,
}: {
  readonly locale: Locale;
  readonly today: PlainDate;
  readonly lastStartDate: PlainDate;
  readonly options: UnlimitedPassOptions;
  readonly calendarMonth: PlainDate;
  readonly numberOfMonths: 1 | 2;
  readonly startDate?: PlainDate;
  readonly fixedStartDate?: PlainDate;
  readonly availability: UnlimitedPassAvailability;
  readonly onOptionsChange: (
    options: UnlimitedPassOptions,
    date?: PlainDate
  ) => void;
  readonly onMonthChange: (month: PlainDate) => void;
  readonly onStartDateChange: (date: PlainDate | undefined) => void;
  readonly onRetry: () => void;
  readonly onContinue: (selection: UnlimitedPassSelection) => void;
}) {
  const days = formatCount(unlimitedPassDays, locale);
  const calendarId = useId();
  const coffeeId = useId();
  const firstDay = Temporal.PlainDate.from(today);
  const lastDay = Temporal.PlainDate.from(lastStartDate);
  const starts =
    availability.status === "ready" ? availability.starts : undefined;
  const enabled = new Set(
    starts
      ? availableUnlimitedPassStarts(starts, options).filter(
          (date) => fixedStartDate === undefined || date === fixedStartDate
        )
      : []
  );
  const selected =
    startDate !== undefined && enabled.has(startDate) ? startDate : undefined;
  const calendarSelection = fixedStartDate ?? selected;
  const changeOptions = (next: UnlimitedPassOptions) => {
    const date =
      startDate !== undefined &&
      starts !== undefined &&
      !availableUnlimitedPassStarts(starts, next).includes(startDate)
        ? undefined
        : startDate;
    onOptionsChange(next, date);
  };

  return (
    <ReservationFormCard>
      <form
        className="space-y-7"
        onSubmit={(event) => {
          event.preventDefault();
          if (selected) onContinue({ ...options, startDate: selected });
        }}
      >
        <PassTierInput
          className="lg:grid-cols-3"
          locale={locale}
          tier={options.tier}
          onChange={(tier) => changeOptions(unlimitedPassOptionsForTier(tier))}
          priceForTier={(tier) => (
            <>
              {formatMoney(
                getUnlimitedPassPrice({ kind: "unlimited", tier }),
                locale
              )}
              <span className="ml-1 text-sm font-normal">
                {m.unlimitedPassCheckoutPricePeriod({ days }, { locale })}
              </span>
            </>
          )}
        />
        <div
          className={cn(
            "grid items-start gap-4",
            options.tier !== "reserved-desk" &&
              "lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]"
          )}
        >
          <section className="min-w-0 space-y-1" aria-labelledby={calendarId}>
            <h2
              id={calendarId}
              className="font-semibold text-sm uppercase tracking-widest text-navy-blue/75"
            >
              {m.unlimitedPassCheckoutStartDate({}, { locale })}
            </h2>
            <Calendar
              aria-labelledby={calendarId}
              className="relative w-full rounded-3xl border border-navy-blue/10 bg-white p-3 sm:p-4"
              classNames={{
                root: "max-w-full text-navy-blue",
                months: "flex justify-center gap-3",
                month: "min-w-0 flex-1 space-y-4",
                month_grid:
                  "mx-auto w-full max-w-72 table-fixed border-collapse",
                weekdays: "",
                weekday:
                  "text-[0.72rem] font-semibold uppercase text-navy-blue/65",
                week: "",
                day: "h-9 p-0 text-center text-sm",
                day_button:
                  "inline-flex h-9 w-full max-w-10 items-center justify-center rounded-lg text-navy-blue focus-visible:outline-2 focus-visible:outline-burned-orange disabled:opacity-45",
              }}
              locale={calendarLocales[locale]}
              mode="single"
              numberOfMonths={numberOfMonths}
              showOutsideDays={false}
              today={toCalendarDate(firstDay)}
              weekStartsOn={1}
              startMonth={toCalendarDate(firstDay)}
              endMonth={toCalendarDate(lastDay)}
              month={toCalendarDate(Temporal.PlainDate.from(calendarMonth))}
              disableNavigation={fixedStartDate !== undefined}
              onMonthChange={(date) =>
                onMonthChange(
                  plainDateStringSchema.make(fromCalendarDate(date).toString())
                )
              }
              selected={
                calendarSelection
                  ? toCalendarDate(Temporal.PlainDate.from(calendarSelection))
                  : undefined
              }
              disabled={(date) =>
                !enabled.has(
                  plainDateStringSchema.make(fromCalendarDate(date).toString())
                )
              }
              modifiers={{
                available: (date) =>
                  enabled.has(
                    plainDateStringSchema.make(
                      fromCalendarDate(date).toString()
                    )
                  ),
              }}
              modifiersClassNames={{
                available:
                  "[&:not([data-selected])>button]:bg-aquamarine-green/25 [&:not([data-selected])>button]:hover:bg-aquamarine-green/50",
              }}
              onSelect={(date) => {
                if (fixedStartDate) return;
                onStartDateChange(
                  date
                    ? plainDateStringSchema.make(
                        fromCalendarDate(date).toString()
                      )
                    : undefined
                );
              }}
            />
            <p role="status" className="text-sm text-navy-blue/75">
              {availability.status === "loading" &&
                m.reservationAvailabilityLoading({}, { locale })}
              {availability.status === "ready" &&
                enabled.size === 0 &&
                m.unlimitedPassCheckoutNoStarts({}, { locale })}
            </p>
            <p
              role="alert"
              className="text-sm font-semibold text-burned-orange"
            >
              {availability.status === "unavailable" &&
                (availability.message ??
                  m.reservationAvailabilityError({}, { locale }))}
            </p>
            {availability.status === "unavailable" && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onRetry}
              >
                {m.reservationAccountUnavailableRetry({}, { locale })}
              </Button>
            )}
          </section>
          {options.tier === "open-space" && (
            <section className="space-y-2" aria-labelledby={coffeeId}>
              <h2
                id={coffeeId}
                className="font-semibold text-sm uppercase tracking-widest text-navy-blue/75"
              >
                {m.unlimitedPassCheckoutCoffee({ days }, { locale })}
              </h2>
              <label
                htmlFor={`${coffeeId}-switch`}
                className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-navy-blue/15 bg-white px-4"
              >
                <Coffee
                  aria-hidden="true"
                  className="size-5 text-burned-orange"
                />
                <Switch
                  id={`${coffeeId}-switch`}
                  aria-labelledby={coffeeId}
                  aria-describedby={`${coffeeId}-note`}
                  checked={options.coffee}
                  onCheckedChange={(coffee) =>
                    changeOptions({ ...options, coffee })
                  }
                />
                <span className="ml-auto font-semibold text-sm">
                  +{formatMoney(unlimitedPassCoffeePrice, locale)}
                </span>
              </label>
              <p
                id={`${coffeeId}-note`}
                className="text-sm leading-6 text-navy-blue/75"
              >
                {m.unlimitedPassCheckoutCoffeeNote({}, { locale })}
              </p>
            </section>
          )}
          {options.tier === "reserved-desk-workstation" && (
            <div className="rounded-3xl border border-aquamarine-green/40 bg-aquamarine-green/10 p-4 lg:mt-6">
              <fieldset className="grid grid-cols-2 gap-3">
                <legend className="mb-3 text-sm font-semibold text-navy-blue/75">
                  {m.unlimitedPassCheckoutMonitors({ days }, { locale })}
                </legend>
                {workspaceProductMonitorOptions.map((monitorOption) => {
                  const unavailableOnSelectedDate =
                    selected !== undefined &&
                    starts !== undefined &&
                    !starts[options.tier][monitorOption].includes(selected);
                  return (
                    <label
                      key={monitorOption}
                      className={cn(
                        "cursor-pointer rounded-2xl border border-navy-blue/10 bg-white/75 p-3 focus-within:outline-2 focus-within:outline-navy-blue",
                        unavailableOnSelectedDate && "bg-white/50",
                        options.monitorOption === monitorOption &&
                          "border-aquamarine-green bg-white ring-4 ring-aquamarine-green/15"
                      )}
                    >
                      <input
                        className="sr-only"
                        type="radio"
                        name="monitorOption"
                        value={monitorOption}
                        checked={options.monitorOption === monitorOption}
                        onChange={() =>
                          changeOptions({ ...options, monitorOption })
                        }
                      />
                      <span className="block font-semibold">
                        {getWorkspaceProductMonitorTitle(monitorOption, locale)}
                      </span>
                      <span className="mt-1 block text-sm text-navy-blue/70">
                        {unavailableOnSelectedDate
                          ? m.unlimitedPassCheckoutMonitorsUnavailable(
                              { days },
                              { locale }
                            )
                          : getWorkspaceProductMessage(
                              workspaceProductMonitorDescriptionMessages[
                                monitorOption
                              ],
                              locale
                            )}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </div>
          )}
        </div>
        <PassCheckoutContinue
          disabled={selected === undefined}
          locale={locale}
        />
      </form>
    </ReservationFormCard>
  );
}
