import { type Locale, m } from "@/features/i18n";
import {
  getMeetingRoomReservationDurationKey,
  isMeetingRoomWholeDayReservationDuration,
} from "@/features/reservation/meeting-room-reservation-duration";
import type { CheckoutData } from "../types";

// The real cowork form renders the coffee switch only for Open Space and the
// workstation (monitor) switch only for Reserved Desk. Both are FormControl
// switches whose accessible name comes from aria-labelledby pointing at their
// FormLabel (shared/components/ui/form.tsx), so assertions match by that
// localized label text.
export const getCoworkSwitchExpectations = (
  entryTier: string,
  locale: Locale
) => ({
  coffeeSwitchLabel:
    entryTier === "open-space"
      ? m.reservationCoffeeLabel({}, { locale })
      : null,
  workstationSwitchLabel:
    entryTier === "reserved-desk"
      ? m.reservationWorkstationLabel({}, { locale })
      : null,
});

export const getOfficeDayCount = (
  office: NonNullable<CheckoutData["office"]>
) =>
  Temporal.PlainDate.from(office.startsOn).until(
    Temporal.PlainDate.from(office.endsOn),
    { largestUnit: "day" }
  ).days + 1;

export type PrefilledReservationOptions = {
  /** Whether the contact fields were carried in too; defaults to true. */
  readonly includeContact?: boolean;
};

type PrefilledContact = {
  readonly email: string;
  readonly includeContact: boolean;
  readonly name: string;
  readonly phone: string;
};

/** What a restored reservation form shows, as `isPrefilledReservation` reads it. */
export type PrefilledReservation = PrefilledContact &
  (
    | {
        readonly coffee: boolean;
        readonly coffeeSwitchLabel: string | null;
        readonly date: string;
        readonly entryTier: string;
        readonly kind: "cowork";
        readonly monitorOption: string | null;
        readonly workstationSwitchLabel: string | null;
      }
    | {
        readonly date: string;
        readonly durationKey: string;
        readonly kind: "meeting-room";
        readonly time: string;
        readonly wholeDay: boolean;
      }
    | {
        readonly dayCount: number;
        readonly kind: "office";
        readonly seats: number;
        readonly startsOn: string;
      }
  );

export const toPrefilledReservation = (
  data: CheckoutData,
  { includeContact = true }: PrefilledReservationOptions = {}
): PrefilledReservation => {
  const contact = {
    email: data.email,
    includeContact,
    name: data.name,
    phone: data.phone,
  };
  const details = data.expectedReservationDetails;
  if (details.kind === "meeting-room") {
    if (!data.meetingRoom) {
      throw new Error("Meeting-room backfill assertions require interval data");
    }
    return {
      ...contact,
      date: data.date,
      durationKey: getMeetingRoomReservationDurationKey(
        data.meetingRoom.duration
      ),
      kind: "meeting-room",
      time: data.meetingRoom.startDateTime.slice(11),
      wholeDay: isMeetingRoomWholeDayReservationDuration(
        data.meetingRoom.duration
      ),
    };
  }
  if (details.kind === "office") {
    if (!data.office) {
      throw new Error("Office backfill assertions require range data");
    }
    return {
      ...contact,
      dayCount: getOfficeDayCount(data.office),
      kind: "office",
      seats: data.office.seats,
      startsOn: data.office.startsOn,
    };
  }
  return {
    ...contact,
    ...getCoworkSwitchExpectations(details.entryTier, data.locale),
    coffee: details.coffee,
    date: data.date,
    entryTier: details.entryTier,
    kind: "cowork",
    monitorOption: details.monitorOption ?? null,
  };
};

/**
 * Runs in the browser: whether the reservation form shows the restored
 * selection and, when carried in, the contact, with marketing consent reset.
 * It must not close over anything. Pass it to `waitForPageCondition` with
 * `toPrefilledReservation(data)`; argv callers run it through
 * `getPrefilledReservationConditionScript`.
 */
export const isPrefilledReservation = (
  expected: PrefilledReservation
): boolean => {
  const value = (selector: string) => {
    const element = document.querySelector(selector);
    return element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
      ? element.value
      : null;
  };
  const checkedValue = (selector: string) => {
    const element = document.querySelector(selector);
    return element instanceof HTMLInputElement ? element.value : null;
  };
  const switchAccessibleName = (element: Element) => {
    const labelledby = element.getAttribute("aria-labelledby");
    if (typeof labelledby === "string" && labelledby.length > 0) {
      const labelText = labelledby
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (labelText.length > 0) return labelText;
    }
    return (element.textContent ?? "").replace(/\s+/g, " ").trim();
  };
  const isSwitchChecked = (label: string, checked: boolean) => {
    const control = [...document.querySelectorAll('[role="switch"]')].find(
      (candidate) =>
        candidate instanceof HTMLButtonElement &&
        switchAccessibleName(candidate).includes(label)
    );
    return (
      control instanceof HTMLButtonElement &&
      control.getAttribute("aria-checked") === String(checked)
    );
  };

  const selectionMatches = () => {
    switch (expected.kind) {
      case "cowork": {
        if (
          checkedValue('input[name="entryTier"]:checked') !==
            expected.entryTier ||
          value('input[name="date"]') !== expected.date
        )
          return false;
        if (
          expected.coffeeSwitchLabel &&
          !isSwitchChecked(expected.coffeeSwitchLabel, expected.coffee)
        )
          return false;
        if (
          expected.workstationSwitchLabel &&
          !isSwitchChecked(
            expected.workstationSwitchLabel,
            expected.monitorOption !== null
          )
        )
          return false;
        const monitorInputs = [
          ...document.querySelectorAll('input[type="radio"]'),
        ].filter(
          (input): input is HTMLInputElement =>
            input instanceof HTMLInputElement && input.name !== "entryTier"
        );
        return expected.monitorOption === null
          ? monitorInputs.length === 0
          : monitorInputs.find((input) => input.checked)?.value ===
              expected.monitorOption;
      }
      case "meeting-room": {
        if (value('input[name="startDateTime"]') !== expected.date)
          return false;
        // The start-time control is matched by type, not by its localized
        // aria label, so one check covers en-US and cs-CZ pages.
        const time = document.querySelector('input[type="time"]');
        if (
          expected.wholeDay
            ? time !== null
            : !(time instanceof HTMLInputElement) ||
              time.value !== expected.time
        )
          return false;
        return (
          checkedValue('input[id^="meeting-room-duration-"]:checked') ===
          expected.durationKey
        );
      }
      case "office":
        return (
          value('input[name="startsOn"]') === expected.startsOn &&
          value('input[name="dayCount"]') === String(expected.dayCount) &&
          checkedValue('input[name="seats"]:checked') === String(expected.seats)
        );
    }
  };

  const contactMatches = () => {
    if (!expected.includeContact) return true;
    if (
      value('input[name="email"]') !== expected.email ||
      value('input[name="phone"]') !== expected.phone ||
      value('input[name="name"]') !== expected.name
    )
      return false;
    // Booking for someone else repeats the email; a carried-in contact
    // arrives with it already repeated.
    const emailConfirmation = document.querySelector(
      'input[name="emailConfirmation"]'
    );
    if (
      emailConfirmation !== null &&
      (!(emailConfirmation instanceof HTMLInputElement) ||
        emailConfirmation.value !== expected.email)
    )
      return false;
    // The consent renders only for someone booking as themselves.
    const marketingConsent = document.querySelector(
      "#reservation-marketing-consent"
    );
    return (
      marketingConsent === null ||
      (marketingConsent instanceof HTMLButtonElement &&
        marketingConsent.getAttribute("aria-checked") === "false")
    );
  };

  return selectionMatches() && contactMatches();
};
