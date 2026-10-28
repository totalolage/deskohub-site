import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { formatCurrencyAmount } from "@deskohub/i18n/currency";
import { Cause, Match, Option } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { type Locale, m } from "@/features/i18n";
import { withMeetingRoomEarlySetup } from "@/features/reservation/meeting-room-early-setup-link";
import { Button } from "@/shared/components/ui/button";
import { ChoiceCard } from "@/shared/components/ui/choice-card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import type { AgentToolErrorResult } from "../agent-tool-error";
import type { AgentToolMoney } from "../agent-tool-money";
import type { CheckAvailabilityResult } from "../check-availability.schema";
import type { GetQuoteResult } from "../get-quote.schema";
import type { AgentOffering } from "../list-offerings.schema";
import type { StartReservationResult } from "../start-reservation.schema";
import {
  type BookingDraftSchema,
  type BookingSelection,
  type BookingStart,
  getBookingFamilies,
  getFamilyOfferings,
  getInitialDraft,
  makeBookingDraftSchema,
} from "./booking-draft";
import type { BookingRequestFailed, BookingToolFailed } from "./booking-host";

/** An availability check, with the quote when the selection looked free. */
type BookingCheck = {
  readonly availability: CheckAvailabilityResult;
  readonly quote?: GetQuoteResult;
  /** The selection as quoted, which a booking reuses. */
  readonly selection?: BookingSelection;
};

type BookingFailure = BookingToolFailed | BookingRequestFailed;

type BookingFormProps = {
  readonly start: BookingStart;
  readonly check: AsyncResult.AsyncResult<BookingCheck, BookingFailure>;
  readonly reservation: AsyncResult.AsyncResult<
    StartReservationResult,
    BookingFailure
  >;
  /** Whether the host failed to open the last link. */
  readonly linkFailed: boolean;
  /** Called on each change to the selection, which makes results stale. */
  readonly onSelectionChange: () => void;
  /** Called with the tool arguments when the selection is valid. */
  readonly onCheck: (selection: BookingSelection) => void;
  /** Called with the quoted selection and the customer's early-setup choice. */
  readonly onReserve: (
    selection: BookingSelection,
    earlySetup: boolean
  ) => void;
  readonly onOpenLink: (url: string) => void;
};

const formatMoney = ({ amount, currency }: AgentToolMoney, locale: Locale) =>
  formatCurrencyAmount({ amount, currency, locale });

// The view runs in the customer's browser, so the time is in their zone.
const formatExpiry = (instant: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(Date.parse(instant));

// A bookable date, `YYYY-MM-DD`, in the customer's language.
const formatDate = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(Date.parse(date));

/**
 * The view's own wording for a tool error. The customer can act on a few
 * codes; the rest can only be retried or booked on the site.
 */
const getToolErrorMessage = (
  error: AgentToolErrorResult["error"],
  locale: Locale
) =>
  Match.value(error).pipe(
    Match.discriminators("code")({
      date_out_of_range: ({ earliest, latest }) =>
        m.bookingWidgetErrorDateOutOfRange(
          {
            earliest: formatDate(earliest, locale),
            latest: formatDate(latest, locale),
          },
          { locale }
        ),
      rate_limited: () => m.bookingWidgetErrorRateLimited({}, { locale }),
      selection_unavailable: () =>
        m.bookingWidgetErrorSelectionUnavailable({}, { locale }),
      profile_incomplete: () =>
        m.bookingWidgetErrorProfileIncomplete({}, { locale }),
      account_unavailable: () =>
        m.bookingWidgetErrorAccountUnavailable({}, { locale }),
      reservation_conflict: () =>
        m.bookingWidgetErrorReservationConflict({}, { locale }),
      payment_in_progress: () =>
        m.bookingWidgetErrorPaymentInProgress({}, { locale }),
    }),
    Match.orElse(() => m.bookingWidgetErrorUnavailable({}, { locale }))
  );

const getFailureMessage = (
  cause: Cause.Cause<BookingFailure>,
  locale: Locale
) =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => m.bookingWidgetRequestFailed({}, { locale }),
    onSome: (failure) =>
      failure._tag === "BookingToolFailed"
        ? getToolErrorMessage(failure.error, locale)
        : m.bookingWidgetRequestFailed({}, { locale }),
  });

/**
 * The booking view: the customer picks a family, its options and a date,
 * checks availability and the price, and continues on the site, either
 * through the Pay page of a booking started here or the prefilled
 * reservation page. Results are announced through live regions that stay
 * mounted.
 */
export function BookingForm({
  start,
  check,
  reservation,
  linkFailed,
  onSelectionChange,
  onCheck,
  onReserve,
  onOpenLink,
}: BookingFormProps) {
  const { locale } = start;
  const form = useForm<
    BookingDraftSchema["Encoded"],
    unknown,
    BookingDraftSchema["Type"]
  >({
    defaultValues: getInitialDraft(start),
    resolver: effectSchemaResolver(makeBookingDraftSchema(start)),
  });
  const [family, duration] = useWatch({
    control: form.control,
    name: ["family", "duration"],
  });
  // Another family or duration asks for other fields, so earlier field
  // errors no longer apply.
  const changeOption = () => {
    form.clearErrors();
    onSelectionChange();
  };
  const familyOfferings = getFamilyOfferings(start.offerings, family);
  const checked = AsyncResult.isSuccess(check) ? check.value : undefined;
  const reserved = AsyncResult.isSuccess(reservation)
    ? reservation.value
    : undefined;
  const [earlySetupChosen, setEarlySetupChosen] = useState(false);
  const earlySetupAvailable =
    checked?.availability.meeting_room?.early_setup_available === true;
  // As on the site, a completed check whose setup time is taken drops the
  // choice; running, failed or cleared checks keep it.
  if (
    earlySetupChosen &&
    checked !== undefined &&
    !AsyncResult.isWaiting(check) &&
    !earlySetupAvailable
  ) {
    setEarlySetupChosen(false);
  }
  const earlySetup = earlySetupAvailable && earlySetupChosen;
  const link = (url: string, label: string) => (
    <SiteLink
      label={label}
      onOpenLink={onOpenLink}
      opensLinks={start.opensLinks}
      url={url}
    />
  );

  return (
    <main className="space-y-5 p-4 text-navy-blue">
      <h1 className="text-xl">{m.bookingWidgetTitle({}, { locale })}</h1>
      {/* Not a form element: hosts sandbox the view without `allow-forms`,
          so the browser blocks a submission before its submit event. */}
      <Form {...form}>
        <div className="space-y-5">
          <div className="space-y-2">
            {/* The group's legend names it for assistive technology. */}
            <p aria-hidden="true" className="text-sm font-medium">
              {m.bookingWidgetFamilyLabel({}, { locale })}
            </p>
            <FormField
              control={form.control}
              name="family"
              render={({ field }) => (
                <SegmentedControl
                  label={m.bookingWidgetFamilyLabel({}, { locale })}
                  name={field.name}
                  onValueChange={(value) => {
                    field.onChange(value);
                    changeOption();
                  }}
                  options={getBookingFamilies(start.offerings).map((value) => ({
                    value,
                    label: {
                      cowork: m.bookingWidgetFamilyCowork,
                      "meeting-room": m.bookingWidgetFamilyMeetingRoom,
                      office: m.bookingWidgetFamilyOffice,
                    }[value]({}, { locale }),
                  }))}
                  value={field.value}
                />
              )}
            />
          </div>

          {family === "cowork" && (
            <FormField
              control={form.control}
              name="tier"
              render={({ field }) => (
                <OfferingChoices
                  label={m.bookingWidgetTierLabel({}, { locale })}
                  locale={locale}
                  name={field.name}
                  offerings={familyOfferings}
                  onSelect={({ tier }) => {
                    if (!tier) return;
                    field.onChange(tier);
                    onSelectionChange();
                  }}
                  selected={(offering) => offering.tier === field.value}
                />
              )}
            />
          )}
          {family === "meeting-room" && (
            <FormField
              control={form.control}
              name="duration"
              render={({ field }) => (
                <OfferingChoices
                  label={m.reservationMeetingRoomDurationLabel({}, { locale })}
                  locale={locale}
                  name={field.name}
                  offerings={familyOfferings}
                  onSelect={(offering) => {
                    if (!offering.duration) return;
                    field.onChange(offering.duration);
                    changeOption();
                  }}
                  selected={(offering) => offering.duration === field.value}
                />
              )}
            />
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="date"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>
                    {family === "office"
                      ? m.bookingWidgetFirstDayLabel({}, { locale })
                      : m.bookingWidgetDateLabel({}, { locale })}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      min={start.today}
                      onChange={(event) => {
                        field.onChange(event);
                        onSelectionChange();
                      }}
                      className="bg-surface"
                      type="date"
                      variant={fieldState.invalid ? "error" : "default"}
                    />
                  </FormControl>
                  <FieldMessage />
                </FormItem>
              )}
            />
            {family === "meeting-room" && duration !== "day:1" && (
              <FormField
                control={form.control}
                name="startTime"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>
                      {m.bookingWidgetStartTimeLabel({}, { locale })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        onChange={(event) => {
                          field.onChange(event);
                          onSelectionChange();
                        }}
                        className="bg-surface"
                        step={3600}
                        type="time"
                        variant={fieldState.invalid ? "error" : "default"}
                      />
                    </FormControl>
                    <FieldMessage />
                  </FormItem>
                )}
              />
            )}
            {family === "office" &&
              (
                [
                  ["dayCount", m.reservationOfficeDayCountLabel],
                  ["seats", m.reservationOfficeSeatCountLabel],
                ] as const
              ).map(([name, label]) => (
                <FormField
                  control={form.control}
                  key={name}
                  name={name}
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel>{label({}, { locale })}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          className="bg-surface"
                          inputMode="numeric"
                          min={1}
                          onChange={(event) => {
                            field.onChange(event);
                            onSelectionChange();
                          }}
                          type="number"
                          variant={fieldState.invalid ? "error" : "default"}
                        />
                      </FormControl>
                      <FieldMessage />
                    </FormItem>
                  )}
                />
              ))}
          </div>

          <Button
            onClick={form.handleSubmit(
              (selection) => onCheck(selection),
              () => onSelectionChange()
            )}
            pending={AsyncResult.isWaiting(check)}
            type="button"
          >
            {m.bookingWidgetCheck({}, { locale })}
          </Button>
        </div>
      </Form>

      <div aria-live="polite" className="space-y-2 text-sm" role="status">
        {AsyncResult.isWaiting(check) && (
          <p>{m.bookingWidgetChecking({}, { locale })}</p>
        )}
        {checked && !AsyncResult.isWaiting(check) && (
          <CheckSummary
            check={checked}
            locale={locale}
            offerings={start.offerings}
          />
        )}
        {AsyncResult.isWaiting(reservation) && (
          <p>{m.bookingWidgetReserving({}, { locale })}</p>
        )}
        {reserved && !AsyncResult.isWaiting(reservation) && (
          <>
            <p className="font-semibold">
              {m.bookingWidgetHeld(
                {
                  expiresAt: formatExpiry(reserved.pay_url_expires_at, locale),
                },
                { locale }
              )}
            </p>
            {reserved.price_changed && (
              <p>
                {m.bookingWidgetPriceChanged(
                  { price: formatMoney(reserved.total, locale) },
                  { locale }
                )}
              </p>
            )}
          </>
        )}
      </div>

      <div className="space-y-2 text-sm text-burned-orange-ink" role="alert">
        {AsyncResult.isFailure(check) && (
          <p>{getFailureMessage(check.cause, locale)}</p>
        )}
        {AsyncResult.isFailure(reservation) && (
          <>
            <p>{getFailureMessage(reservation.cause, locale)}</p>
            <p>{m.bookingWidgetReserveFallback({}, { locale })}</p>
          </>
        )}
        {linkFailed && <p>{m.bookingWidgetLinkFailed({}, { locale })}</p>}
      </div>

      {checked?.quote && checked.selection && (
        <div className="space-y-4">
          {start.mode === "reserve" &&
            checked.selection.family === "meeting-room" && (
              <EarlySetupChoice
                available={earlySetupAvailable}
                checked={earlySetup}
                // A running check replaces this one, and the held booking
                // keeps the choice it was made with.
                disabled={
                  AsyncResult.isWaiting(check) ||
                  reserved !== undefined ||
                  AsyncResult.isWaiting(reservation)
                }
                locale={locale}
                onCheckedChange={setEarlySetupChosen}
              />
            )}
          {reserved
            ? link(
                reserved.pay_url,
                m.bookingWidgetOpenPaymentPage({}, { locale })
              )
            : start.mode === "reserve" && (
                <Button
                  onClick={() =>
                    checked.selection &&
                    onReserve(checked.selection, earlySetup)
                  }
                  // A running check replaces the selection and its choices.
                  disabled={AsyncResult.isWaiting(check)}
                  pending={AsyncResult.isWaiting(reservation)}
                  type="button"
                >
                  {m.bookingWidgetReserve({}, { locale })}
                </Button>
              )}
          {(start.mode === "reservation_page" ||
            AsyncResult.isFailure(reservation)) && (
            <div className="space-y-2">
              {/* After a failed booking, the alert already offers the page. */}
              {start.mode === "reservation_page" && (
                <p className="text-sm">
                  {m.bookingWidgetReservationPageHint({}, { locale })}
                </p>
              )}
              {link(
                // The quote's link predates the setup choice, so carry it.
                earlySetup
                  ? withMeetingRoomEarlySetup(checked.quote.reservation_url)
                  : checked.quote.reservation_url,
                m.bookingWidgetOpenReservationPage({}, { locale })
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function CheckSummary({
  check: { availability, quote, selection },
  locale,
  offerings,
}: {
  readonly check: BookingCheck;
  readonly locale: Locale;
  readonly offerings: ReadonlyArray<AgentOffering>;
}) {
  // The quote includes the workstation the view picked when only
  // workstation desks were left.
  const monitors =
    selection?.family === "cowork" && selection.monitor_option
      ? offerings
          .find(({ tier }) => tier === selection.tier)
          ?.add_ons.find(({ id }) => id === "workstation")
          ?.options?.find(({ id }) => id === selection.monitor_option)?.name
      : undefined;

  return (
    <>
      <p className="font-semibold">
        {availability.available
          ? m.bookingWidgetAvailable({}, { locale })
          : m.bookingWidgetNotAvailable({}, { locale })}
      </p>
      {quote && (
        <>
          <p className="text-base font-semibold">
            {m.bookingWidgetTotal(
              { price: formatMoney(quote.total, locale) },
              { locale }
            )}
          </p>
          {monitors && (
            <p>
              {m.bookingWidgetWorkstationIncluded({ monitors }, { locale })}
            </p>
          )}
          {quote.discount.amount > 0 && (
            <p>
              {m.bookingWidgetDiscount(
                {
                  discount: formatMoney(quote.discount, locale),
                  price: formatMoney(quote.regular_price, locale),
                },
                { locale }
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}

/**
 * The free option to arrive 15 minutes before a meeting room's start, as on
 * the reservation page. It turns on only when the room is free for the setup
 * time too, and otherwise says why.
 */
function EarlySetupChoice({
  available,
  checked,
  disabled,
  locale,
  onCheckedChange,
}: {
  readonly available: boolean;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly locale: Locale;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  const reasonId = useId();

  return (
    <div className="space-y-1">
      <ChoiceCard align="center" tone="neutral">
        <input
          aria-describedby={available ? undefined : reasonId}
          checked={checked}
          disabled={disabled || !available}
          onChange={(event) => onCheckedChange(event.target.checked)}
          type="checkbox"
        />
        <span className="text-sm font-medium">
          {m.reservationMeetingRoomEarlySetupLabel({}, { locale })}
        </span>
      </ChoiceCard>
      {!available && (
        <p className="text-sm text-muted" id={reasonId}>
          {m.reservationMeetingRoomEarlySetupUnavailable({}, { locale })}
        </p>
      )}
    </div>
  );
}

function OfferingChoices({
  label,
  locale,
  name,
  offerings,
  onSelect,
  selected,
}: {
  readonly label: string;
  readonly locale: Locale;
  readonly name: string;
  readonly offerings: ReadonlyArray<AgentOffering>;
  readonly onSelect: (offering: AgentOffering) => void;
  readonly selected: (offering: AgentOffering) => boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {offerings.map((offering) => (
          <ChoiceCard
            align="center"
            // Meeting-room durations share a name.
            key={offering.tier ?? offering.duration ?? offering.name}
            // The neutral tone tints the text colour, so it follows the
            // host's theme; the plain tone is white.
            tone="neutral"
          >
            <input
              checked={selected(offering)}
              name={name}
              onChange={() => onSelect(offering)}
              type="radio"
              value={offering.tier ?? offering.duration}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">
                {offering.duration_label ?? offering.name}
              </span>
              <span className="text-sm text-muted">
                {{
                  day: m.bookingWidgetPricePerDay,
                  booking: m.bookingWidgetPricePerBooking,
                }[offering.price_unit](
                  { price: formatMoney(offering.advertised_price, locale) },
                  { locale }
                )}
              </span>
            </span>
          </ChoiceCard>
        ))}
      </div>
    </fieldset>
  );
}

/** A field's validation message, in the view's small alert style. */
function FieldMessage() {
  return <FormMessage className="text-xs text-burned-orange-ink" />;
}

/**
 * A site page link. A click asks the host to open it in the customer's
 * browser; the address stays visible, so the customer can copy it when
 * the host can't.
 */
function SiteLink({
  label,
  onOpenLink,
  opensLinks,
  url,
}: {
  readonly label: string;
  readonly onOpenLink: (url: string) => void;
  readonly opensLinks: boolean;
  readonly url: string;
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <Button asChild>
        <a
          href={url}
          onClick={(event) => {
            if (!opensLinks) return;
            event.preventDefault();
            onOpenLink(url);
          }}
          rel="noreferrer"
          target="_blank"
        >
          {label}
        </a>
      </Button>
      <span className="break-all text-xs text-muted">{url}</span>
    </div>
  );
}
