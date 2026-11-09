import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { StyleSheet } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { LiveMessage } from "../../ui/controls";
import { SectionHeader } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import {
  bookingAvailabilityAtom,
  bookingQuoteAtom,
} from "../data/booking-queries";
import { BookingCatalogViewError } from "../data/booking-query-error";
import {
  defaultOfficeDraft,
  type OfficeBlocker,
  type OfficeDraft,
  type OfficeOffering,
  officeAvailabilityQuery,
} from "../selection/office-selection";
import { addDays, pragueToday } from "../selection/prague-date";
import { formatMoney } from "../ui/money";
import { MonthCalendar } from "../ui/month-calendar";
import { formatPragueDate } from "../ui/prague-date-format";
import { Stepper } from "../ui/stepper";
import { bookingClockAtom } from "./booking-clock";
import { BookingContinue } from "./booking-continue";
import { unneededReadAtom } from "./booking-family-atoms";
import {
  availabilityNoticeMessage,
  bookingQueryMessage,
} from "./booking-family-copy";
import { useBookingStarted, useRestartReason } from "./booking-family-hooks";
import {
  bookingReadOf,
  checkoutRequestOf,
  freshValue,
  loadedValue,
  quoteFailureRepeats,
} from "./booking-family-view";
import { BookingGate } from "./booking-gate";
import { BookingOfferingsView } from "./booking-offerings-view";
import { BookingReadFailure } from "./booking-read-view";
import { officeBookingModel, officeOfferingOf } from "./office-booking-model";
import { RestartNotice } from "./restart-notice";

/** The customer's office draft; none until they change the default. */
const officeDraftAtom = Atom.make(Option.none<OfficeDraft>());

const blockerMessage = (blocker: OfficeBlocker, locale: AppLocale) =>
  ({
    AvailabilityPending: () => undefined,
    DateUnavailable: () => m.booking_office_date_unavailable({}, { locale }),
    DayCountUnavailable: () =>
      m.booking_office_day_count_unavailable({}, { locale }),
    SeatsUnavailable: () => m.booking_office_seats_unavailable({}, { locale }),
  })[blocker._tag]();

/** Office: a first day, a number of days, and seats. */
export function OfficeBookingScreen() {
  useBookingStarted("office");
  const locale = useAppLocale();
  return (
    <ScrollScreen>
      <BookingGate>
        <BookingOfferingsView>
          {(catalog) =>
            Option.match(officeOfferingOf(catalog.offerings), {
              onNone: () => (
                <Notice
                  tone="warning"
                  message={bookingQueryMessage(
                    BookingCatalogViewError.OfferingUnavailable({
                      family: "office",
                    }),
                    locale
                  )}
                />
              ),
              onSome: (offering) => <OfficeSelection offering={offering} />,
            })
          }
        </BookingOfferingsView>
      </BookingGate>
    </ScrollScreen>
  );
}

function OfficeSelection({ offering }: { readonly offering: OfficeOffering }) {
  const locale = useAppLocale();
  const now = useAtomValue(bookingClockAtom);
  const today = pragueToday(now);
  const [stored, setStored] = useAtom(officeDraftAtom);
  const draft = Option.getOrElse(stored, () => defaultOfficeDraft(today));
  const setDraft = (next: OfficeDraft) => setStored(Option.some(next));

  const availabilityAtom = bookingAvailabilityAtom({
    query: officeAvailabilityQuery(today),
  });
  const availabilityRead = bookingReadOf(useAtomValue(availabilityAtom));
  const refreshAvailability = useAtomRefresh(availabilityAtom);

  const model = officeBookingModel({
    draft,
    now,
    offering,
    availability: loadedValue(availabilityRead),
  });
  const { enablement } = model;

  const quoteAtom = Option.match(model.quotable, {
    onNone: () => unneededReadAtom,
    onSome: (selection) => bookingQuoteAtom(selection, locale),
  });
  const quoteResult = useAtomValue(quoteAtom);
  const refreshQuote = useAtomRefresh(quoteAtom);
  const quote = Option.map(model.quotable, () => bookingReadOf(quoteResult));

  const restart = useRestartReason(() => {
    refreshAvailability();
    refreshQuote();
  });
  const supportingReads = [availabilityRead];
  const quoteRepeats = quoteFailureRepeats(quote, supportingReads, (error) =>
    bookingQueryMessage(error, locale)
  );
  const retrySupportingReads = () => {
    refreshAvailability();
    if (quoteRepeats) refreshQuote();
  };

  const blockers = enablement.blockers.flatMap((blocker) => {
    const message = blockerMessage(blocker, locale);
    return message === undefined ? [] : [message];
  });
  const pending = enablement.blockers.some(
    ({ _tag }) => _tag === "AvailabilityPending"
  );
  const maximumSeats = Option.getOrElse(
    enablement.maximumSeats,
    () => model.draft.seats
  );
  const lastDate = addDays(model.draft.date, model.draft.dayCount - 1);

  return (
    <>
      <RestartNotice reason={restart} />
      <Text style={styles.caption}>
        {m.booking_office_price(
          {
            price: formatMoney(offering.price, locale),
            seatPrice: formatMoney(offering.seatPrice, locale),
          },
          { locale }
        )}
      </Text>
      <SectionHeader title={m.booking_office_start_heading({}, { locale })} />
      <MonthCalendar
        label={m.booking_office_start_heading({}, { locale })}
        locale={locale}
        dates={enablement.dates}
        selected={model.draft.date}
        onSelect={(date) => setDraft({ ...model.draft, date })}
        previousMonthLabel={m.booking_calendar_previous_month({}, { locale })}
        nextMonthLabel={m.booking_calendar_next_month({}, { locale })}
        unavailableLabel={m.booking_calendar_unavailable_day({}, { locale })}
      />

      <SectionHeader title={m.booking_office_days_heading({}, { locale })} />
      <Stepper
        label={m.booking_office_days_heading({}, { locale })}
        value={model.draft.dayCount}
        min={1}
        max={enablement.maximumDayCount}
        onChange={(dayCount) => setDraft({ ...model.draft, dayCount })}
        decrementLabel={m.booking_office_days_decrease({}, { locale })}
        incrementLabel={m.booking_office_days_increase({}, { locale })}
      />
      {enablement.maximumDayCount > 0 && (
        <Text style={styles.caption}>
          {m.booking_office_last_day(
            { date: formatPragueDate(lastDate, locale) },
            { locale }
          )}
        </Text>
      )}

      <SectionHeader title={m.booking_office_seats_heading({}, { locale })} />
      <Stepper
        label={m.booking_office_seats_heading({}, { locale })}
        value={model.draft.seats}
        min={1}
        max={maximumSeats}
        onChange={(seats) => setDraft({ ...model.draft, seats })}
        decrementLabel={m.booking_office_seats_decrease({}, { locale })}
        incrementLabel={m.booking_office_seats_increase({}, { locale })}
      />

      <Notice
        tone="info"
        message={enablement.notices
          .map((notice) => availabilityNoticeMessage(notice, locale))
          .join(" ")}
      />
      <Notice tone="warning" message={blockers[0]} />
      <BookingReadFailure
        reads={supportingReads}
        onRetry={retrySupportingReads}
      />
      <LiveMessage
        role="status"
        message={
          pending ? m.booking_availability_loading({}, { locale }) : undefined
        }
      />
      <BookingContinue
        quote={quote}
        checkout={checkoutRequestOf({
          locale,
          selection: Option.some(model.selection),
          blockers: enablement.blockers,
          quote: Option.flatMap(quote, freshValue),
        })}
        onRetryQuote={refreshQuote}
        quoteFailureShown={!quoteRepeats}
      />
    </>
  );
}

const styles = StyleSheet.create({
  caption: { ...theme.type.caption, color: theme.colors.textMuted },
});
