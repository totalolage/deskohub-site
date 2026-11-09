import type {
  CustomerMonitorOption,
  CustomerOffering,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { useEffect } from "react";
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
} from "../data/booking-queries";
import {
  type CoworkBlocker,
  type CoworkDraft,
  coworkAvailabilityQueries,
  defaultCoworkDraft,
  selectCoworkTier,
  selectCoworkWorkstation,
} from "../selection/cowork-selection";
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
import { coworkBookingModel } from "./cowork-booking-model";
import { RestartNotice } from "./restart-notice";

/** The customer's cowork draft; none until they change the default. */
const coworkDraftAtom = Atom.make(Option.none<CoworkDraft>());

const noWorkstation = "none";

const blockerMessage = (blocker: CoworkBlocker, locale: AppLocale) =>
  ({
    AvailabilityPending: () => undefined,
    DateOutOfRange: () => m.booking_error_date_out_of_range({}, { locale }),
    OpenSpaceClosedToday: () =>
      m.booking_cowork_open_space_closed_today({}, { locale }),
    OfferUnavailable: () => m.booking_cowork_offer_unavailable({}, { locale }),
    WorkstationUnavailable: () =>
      m.booking_cowork_workstation_unavailable({}, { locale }),
    WorkstationRequired: () =>
      m.booking_cowork_workstation_required({}, { locale }),
  })[blocker._tag]();

/** Cowork: an Open Space or Reserved Desk day, with its add-ons. */
export function CoworkBookingScreen() {
  useBookingStarted("cowork");
  return (
    <ScrollScreen>
      <BookingGate>
        <BookingOfferingsView>
          {(catalog) => <CoworkSelection offerings={catalog.offerings} />}
        </BookingOfferingsView>
      </BookingGate>
    </ScrollScreen>
  );
}

function CoworkSelection({
  offerings,
}: {
  readonly offerings: ReadonlyArray<CustomerOffering>;
}) {
  const locale = useAppLocale();
  const now = useAtomValue(bookingClockAtom);
  const today = pragueToday(now);
  const [stored, setStored] = useAtom(coworkDraftAtom);
  const draft = Option.getOrElse(stored, () =>
    defaultCoworkDraft(today, offerings)
  );
  const setDraft = (next: CoworkDraft) => setStored(Option.some(next));

  const queries = coworkAvailabilityQueries(draft, today);
  const rangeAtom = bookingAvailabilityAtom({ query: queries.range });
  const selectionAtom = bookingAvailabilityAtom({ query: queries.selection });
  const requirementAtom = Option.match(queries.workstationRequirement, {
    onNone: () => unneededReadAtom,
    onSome: (query) => bookingAvailabilityAtom({ query }),
  });
  const range = bookingReadOf(useAtomValue(rangeAtom));
  const selected = bookingReadOf(useAtomValue(selectionAtom));
  const requirement = bookingReadOf(useAtomValue(requirementAtom));
  const refreshRange = useAtomRefresh(rangeAtom);
  const refreshSelected = useAtomRefresh(selectionAtom);
  const refreshRequirement = useAtomRefresh(requirementAtom);

  const model = coworkBookingModel({
    draft,
    now,
    offerings,
    availability: {
      range: readValue(range),
      selection: loadedValue(selected),
      workstationRequirement: Option.flatMap(
        queries.workstationRequirement,
        () => loadedValue(requirement)
      ),
    },
  });
  const { enablement } = model;

  // Keep the workstation the availability fitted, so the next reads are for it.
  useEffect(() => {
    if (model.draft !== draft) setStored(Option.some(model.draft));
  }, [model.draft, draft, setStored]);

  const quoteAtom = Option.match(model.quotable, {
    onNone: () => unneededReadAtom,
    onSome: (selection) => bookingQuoteAtom(selection, locale),
  });
  const quoteResult = useAtomValue(quoteAtom);
  const refreshQuote = useAtomRefresh(quoteAtom);
  const quote = Option.map(model.quotable, () => bookingReadOf(quoteResult));

  const rereadAvailability = () => {
    refreshRange();
    refreshSelected();
    refreshRequirement();
  };
  const restart = useRestartReason(() => {
    rereadAvailability();
    refreshQuote();
  });
  const supportingReads = [range, selected, requirement];
  const quoteRepeats = quoteFailureRepeats(quote, supportingReads, (error) =>
    bookingQueryMessage(error, locale)
  );
  const retrySupportingReads = () => {
    rereadAvailability();
    if (quoteRepeats) refreshQuote();
  };

  const tiers = offerings.filter(
    (offering): offering is Extract<CustomerOffering, { family: "cowork" }> =>
      offering.family === "cowork"
  );
  const chosen = tiers.find(({ tier }) => tier === model.draft.tier);
  const coffee = chosen?.addOns.find(({ id }) => id === "coffee");
  const workstation = chosen?.addOns.find(({ id }) => id === "workstation");
  const blockers = enablement.blockers.flatMap((blocker) => {
    const message = blockerMessage(blocker, locale);
    return message === undefined ? [] : [message];
  });
  const pending = enablement.blockers.some(
    ({ _tag }) => _tag === "AvailabilityPending"
  );

  return (
    <>
      <RestartNotice reason={restart} />
      <SectionHeader title={m.booking_cowork_tier_heading({}, { locale })} />
      <ChoiceList
        label={m.booking_cowork_tier_heading({}, { locale })}
        choices={tiers.map((offering) => ({
          value: offering.tier,
          label: offering.name,
          description: m.booking_price_per_day(
            {
              description: offering.description,
              price: formatMoney(offering.advertisedPrice.price, locale),
            },
            { locale }
          ),
          disabled: enablement.unavailableTiers.has(offering.tier),
        }))}
        selected={model.draft.tier}
        onSelect={(tier) => setDraft(selectCoworkTier(model.draft, tier))}
      />

      <SectionHeader title={m.booking_date_heading({}, { locale })} />
      <MonthCalendar
        label={m.booking_date_heading({}, { locale })}
        locale={locale}
        dates={enablement.dates}
        selected={model.draft.date}
        onSelect={(date) => setDraft({ ...model.draft, date })}
        previousMonthLabel={m.booking_calendar_previous_month({}, { locale })}
        nextMonthLabel={m.booking_calendar_next_month({}, { locale })}
        unavailableLabel={m.booking_calendar_unavailable_day({}, { locale })}
      />

      {coffee !== undefined && (
        <>
          <SectionHeader title={m.booking_addons_heading({}, { locale })} />
          {coffee.included ? (
            <Text style={styles.caption}>
              {m.booking_cowork_coffee_included(
                { name: coffee.name },
                { locale }
              )}
            </Text>
          ) : (
            <Checkbox
              label={m.booking_addon_with_price(
                { name: coffee.name, price: formatMoney(coffee.price, locale) },
                { locale }
              )}
              checked={model.draft.coffee}
              onChange={(checked) =>
                setDraft({ ...model.draft, coffee: checked })
              }
            />
          )}
        </>
      )}

      {workstation !== undefined && enablement.workstations.length > 0 && (
        <>
          <SectionHeader
            title={m.booking_cowork_workstation_heading({}, { locale })}
          />
          <ChoiceList<CustomerMonitorOption | typeof noWorkstation>
            label={m.booking_cowork_workstation_heading({}, { locale })}
            choices={[
              {
                value: noWorkstation,
                label: m.booking_cowork_workstation_none({}, { locale }),
                disabled: enablement.workstationRequired,
              },
              ...enablement.workstations.map(({ id, name }) => ({
                value: id,
                label: name,
                description: m.booking_addon_price_per_day(
                  { price: formatMoney(workstation.price, locale) },
                  { locale }
                ),
                disabled: enablement.unavailableWorkstations.has(id),
              })),
            ]}
            selected={Option.match(model.draft.workstation, {
              onNone: () => noWorkstation,
              onSome: ({ option }) => option,
            })}
            onSelect={(value) =>
              setDraft(
                selectCoworkWorkstation(
                  model.draft,
                  value === noWorkstation ? Option.none() : Option.some(value)
                )
              )
            }
          />
          <Notice
            tone="info"
            message={
              Option.exists(
                model.draft.workstation,
                ({ origin }) => origin === "requirement"
              )
                ? m.booking_cowork_workstation_added({}, { locale })
                : undefined
            }
          />
        </>
      )}

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
