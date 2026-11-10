import type { CustomerOffering } from "@deskohub/workspace-customer-api";
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { StyleSheet } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { ChoiceList } from "../../ui/choice-list";
import { LiveMessage } from "../../ui/controls";
import { SectionHeader } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import {
  bookingAvailabilityAtom,
  bookingQuoteAtom,
  meetingRoomStartTimesAtom,
} from "../data/booking-queries";
import {
  defaultMeetingRoomDraft,
  type MeetingRoomBlocker,
  type MeetingRoomDraft,
  selectMeetingRoomDate,
  selectMeetingRoomStartTime,
} from "../selection/meeting-room-selection";
import { pragueToday } from "../selection/prague-date";
import { Checkbox } from "../ui/checkbox";
import { formatMoney } from "../ui/money";
import { MonthCalendar } from "../ui/month-calendar";
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
  readValue,
} from "./booking-family-view";
import { BookingGate } from "./booking-gate";
import { BookingOfferingsView } from "./booking-offerings-view";
import { BookingReadFailure } from "./booking-read-view";
import {
  meetingRoomBookingModel,
  meetingRoomQueryOf,
} from "./meeting-room-booking-model";
import { RestartNotice } from "./restart-notice";

/** The customer's meeting-room draft; none until they change the default. */
const meetingRoomDraftAtom = Atom.make(Option.none<MeetingRoomDraft>());

/**
 * The draft the free starts and availability are read for: the customer's
 * once it has stayed unchanged for 250 ms, as on the site.
 */
const settledMeetingRoomDraftAtom = Atom.debounce(
  meetingRoomDraftAtom,
  "250 millis"
);

const blockerMessage = (blocker: MeetingRoomBlocker, locale: AppLocale) =>
  ({
    AvailabilityPending: () => undefined,
    DateOutOfRange: () => m.booking_error_date_out_of_range({}, { locale }),
    NoFreeStart: () => m.booking_meeting_room_no_free_start({}, { locale }),
    StartUnavailable: () =>
      m.booking_meeting_room_start_unavailable({}, { locale }),
  })[blocker._tag]();

/** Meeting room: a date, a duration and a free start, with early setup. */
export function MeetingRoomBookingScreen() {
  useBookingStarted("meeting-room");
  return (
    <ScrollScreen>
      <BookingGate>
        <BookingOfferingsView>
          {(catalog) => <MeetingRoomSelection offerings={catalog.offerings} />}
        </BookingOfferingsView>
      </BookingGate>
    </ScrollScreen>
  );
}

function MeetingRoomSelection({
  offerings,
}: {
  readonly offerings: ReadonlyArray<CustomerOffering>;
}) {
  const locale = useAppLocale();
  const now = useAtomValue(bookingClockAtom);
  const today = pragueToday(now);
  const initial = () => defaultMeetingRoomDraft(today, offerings);
  const [stored, setStored] = useAtom(meetingRoomDraftAtom);
  const draft = Option.getOrElse(stored, initial);
  const settled = Option.getOrElse(
    useAtomValue(settledMeetingRoomDraftAtom),
    initial
  );
  const setDraft = (next: MeetingRoomDraft) => setStored(Option.some(next));

  const startTimesAtom = meetingRoomStartTimesAtom({
    date: settled.date,
    duration: settled.duration,
  });
  const startTimesRead = bookingReadOf(useAtomValue(startTimesAtom));
  const refreshStartTimes = useAtomRefresh(startTimesAtom);
  const startTimes = readValue(startTimesRead);

  const query = meetingRoomQueryOf(settled, startTimes, now);
  const availabilityAtom = Option.match(query, {
    onNone: () => unneededReadAtom,
    onSome: (wanted) => bookingAvailabilityAtom({ query: wanted }),
  });
  const availabilityRead = bookingReadOf(useAtomValue(availabilityAtom));
  const refreshAvailability = useAtomRefresh(availabilityAtom);

  const model = meetingRoomBookingModel({
    draft,
    settled,
    now,
    startTimes,
    availability: Option.flatMap(query, (answered) =>
      Option.map(loadedValue(availabilityRead), (value) => ({
        query: answered,
        value,
      }))
    ),
  });
  const { enablement } = model;

  const quoteAtom = Option.match(model.quotable, {
    onNone: () => unneededReadAtom,
    onSome: (selection) => bookingQuoteAtom(selection, locale),
  });
  const quoteResult = useAtomValue(quoteAtom);
  const refreshQuote = useAtomRefresh(quoteAtom);
  const quote = Option.map(model.quotable, () => bookingReadOf(quoteResult));

  const rereadAvailability = () => {
    refreshStartTimes();
    refreshAvailability();
  };
  const restart = useRestartReason(() => {
    rereadAvailability();
    refreshQuote();
  });
  const supportingReads = [startTimesRead, availabilityRead];
  const quoteRepeats = quoteFailureRepeats(quote, supportingReads, (error) =>
    bookingQueryMessage(error, locale)
  );
  const retrySupportingReads = () => {
    rereadAvailability();
    if (quoteRepeats) refreshQuote();
  };

  const durations = offerings.filter(
    (
      offering
    ): offering is Extract<CustomerOffering, { family: "meeting-room" }> =>
      offering.family === "meeting-room"
  );
  const blockers = enablement.blockers.flatMap((blocker) => {
    const message = blockerMessage(blocker, locale);
    return message === undefined ? [] : [message];
  });
  const pending = enablement.blockers.some(
    ({ _tag }) => _tag === "AvailabilityPending"
  );
  const wholeDay = model.draft.duration === "day:1";

  return (
    <>
      <RestartNotice reason={restart} />
      <SectionHeader title={m.booking_date_heading({}, { locale })} />
      <MonthCalendar
        label={m.booking_date_heading({}, { locale })}
        locale={locale}
        dates={enablement.dates}
        selected={model.draft.date}
        onSelect={(date) => setDraft(selectMeetingRoomDate(model.draft, date))}
        previousMonthLabel={m.booking_calendar_previous_month({}, { locale })}
        nextMonthLabel={m.booking_calendar_next_month({}, { locale })}
        unavailableLabel={m.booking_calendar_unavailable_day({}, { locale })}
      />

      <SectionHeader
        title={m.booking_meeting_room_duration_heading({}, { locale })}
      />
      <ChoiceList
        label={m.booking_meeting_room_duration_heading({}, { locale })}
        choices={durations.map((offering) => ({
          value: offering.duration,
          label: offering.durationLabel,
          description: formatMoney(offering.advertisedPrice.price, locale),
        }))}
        selected={model.draft.duration}
        onSelect={(duration) => setDraft({ ...model.draft, duration })}
      />

      {!wholeDay && (
        <>
          <SectionHeader
            title={m.booking_meeting_room_start_heading({}, { locale })}
          />
          <ChoiceList
            label={m.booking_meeting_room_start_heading({}, { locale })}
            choices={enablement.startTimes.map(({ startTime }) => ({
              value: startTime,
              label: startTime,
            }))}
            selected={Option.getOrUndefined(model.draft.startTime)}
            onSelect={(startTime) =>
              setDraft(selectMeetingRoomStartTime(model.draft, startTime))
            }
          />
        </>
      )}

      <SectionHeader title={m.booking_addons_heading({}, { locale })} />
      <Checkbox
        label={m.booking_meeting_room_early_setup({}, { locale })}
        checked={model.draft.earlySetup}
        disabled={!enablement.earlySetupAvailable}
        onChange={(earlySetup) => setDraft({ ...model.draft, earlySetup })}
      >
        <Text style={styles.caption}>
          {enablement.earlySetupAvailable
            ? m.booking_meeting_room_early_setup_description({}, { locale })
            : m.booking_meeting_room_early_setup_unavailable({}, { locale })}
        </Text>
      </Checkbox>

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
          selection: model.selection,
          blockers: enablement.blockers,
          quote: Option.flatMap(quote, freshValue),
          earlySetup: model.draft.earlySetup,
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
