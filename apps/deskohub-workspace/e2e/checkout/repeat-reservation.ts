import type { CheckoutData } from "../types";
import {
  getCoworkSwitchExpectations,
  getOfficeDayCount,
} from "./prefilled-reservation";

/**
 * What the reservation form opened by reserve-again shows, as
 * `findRepeatReservationProblem` reads it: the booked product's options, a
 * date other than the booked one, and an empty contact.
 */
export type RepeatReservation =
  | {
      readonly coffee: boolean;
      readonly coffeeSwitchLabel: string | null;
      readonly entryTier: string;
      readonly kind: "cowork";
      readonly monitorOption: string | null;
      readonly oldDate: string;
      readonly query: readonly (readonly [string, string])[];
      readonly workstationSwitchLabel: string | null;
    }
  | {
      readonly dayCount: number;
      readonly kind: "office";
      readonly oldDate: string;
      readonly query: readonly (readonly [string, string])[];
      readonly seats: number;
    }
  | {
      readonly kind: "meeting-room";
      readonly oldDate: string;
      readonly query: readonly (readonly [string, string])[];
    };

export const toRepeatReservation = (data: CheckoutData): RepeatReservation => {
  if (data.expectedReservationDetails.kind === "cowork") {
    const { coffee, entryTier, monitorOption } =
      data.expectedReservationDetails;
    return {
      coffee,
      ...getCoworkSwitchExpectations(entryTier, data.locale),
      entryTier,
      kind: "cowork",
      monitorOption: monitorOption ?? null,
      oldDate: data.date,
      query: [
        ["entryTier", entryTier],
        ["coffee", String(coffee)],
        ...(monitorOption ? [["monitorOption", monitorOption] as const] : []),
      ],
    };
  }
  if (data.expectedReservationDetails.kind === "office") {
    if (!data.office) {
      throw new Error("Office repeat assertions require range data");
    }
    return {
      dayCount: getOfficeDayCount(data.office),
      kind: "office",
      oldDate: data.office.startsOn,
      query: [
        ["dayCount", String(getOfficeDayCount(data.office))],
        ["seats", String(data.office.seats)],
      ],
      seats: data.office.seats,
    };
  }
  return { kind: "meeting-room", oldDate: data.date, query: [] };
};

/**
 * Runs in the browser: the first way the form opened by reserve-again
 * differs from `expected`, as `repeat reservation <field> did not match`, or
 * `null` when it shows safe defaults. It must not close over anything; pass
 * it to `assertPageCheck` with `toRepeatReservation(data)`.
 */
export const findRepeatReservationProblem = (
  expected: RepeatReservation
): string | null => {
  const value = (selector: string) => {
    const element = document.querySelector(selector);
    return element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
      ? element.value
      : null;
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
  // A signed-in account books as itself by default, so its contact inputs
  // may be absent; any rendered input must start empty.
  const contactValue = (name: string) => {
    const element = document.querySelector(`input[name="${name}"]`);
    return element instanceof HTMLInputElement ? element.value : "";
  };

  const mismatchedField = () => {
    const query = [...new URLSearchParams(location.search).entries()];
    if (JSON.stringify(query) !== JSON.stringify(expected.query))
      return "query allowlist";
    if (contactValue("email") !== "") return "email reset";
    if (contactValue("phone") !== "") return "phone reset";
    if (contactValue("name") !== "") return "name reset";

    switch (expected.kind) {
      case "cowork": {
        const date = value('input[name="date"]');
        if (date === null) return "date";
        if (date === expected.oldDate) return "fresh date";
        const tier = document.querySelector('input[name="entryTier"]:checked');
        if (
          !(tier instanceof HTMLInputElement) ||
          tier.value !== expected.entryTier
        )
          return "entry tier";
        if (
          expected.coffeeSwitchLabel &&
          !isSwitchChecked(expected.coffeeSwitchLabel, expected.coffee)
        )
          return "coffee switch";
        if (
          expected.workstationSwitchLabel &&
          !isSwitchChecked(
            expected.workstationSwitchLabel,
            expected.monitorOption !== null
          )
        )
          return "workstation switch";
        const monitor = document.querySelector(
          'input[name="monitorOption"]:checked'
        );
        if (
          expected.monitorOption === null
            ? monitor !== null
            : !(monitor instanceof HTMLInputElement) ||
              monitor.value !== expected.monitorOption
        )
          return "monitor option";
        break;
      }
      case "office": {
        const startsOn = value('input[name="startsOn"]');
        if (startsOn === null) return "start date";
        if (startsOn === expected.oldDate) return "fresh start date";
        if (value('input[name="dayCount"]') !== String(expected.dayCount))
          return "day count";
        const seats = document.querySelector('input[name="seats"]:checked');
        if (
          !(seats instanceof HTMLInputElement) ||
          seats.value !== String(expected.seats)
        )
          return "seats";
        break;
      }
      case "meeting-room": {
        const startDate = value('input[name="startDateTime"]');
        if (startDate === null) return "start date";
        if (startDate === expected.oldDate) return "fresh meeting-room date";
        break;
      }
    }

    // The consent renders only for someone booking as themselves.
    const marketingConsent = document.querySelector(
      "#reservation-marketing-consent"
    );
    if (
      marketingConsent !== null &&
      (!(marketingConsent instanceof HTMLButtonElement) ||
        marketingConsent.getAttribute("aria-checked") !== "false")
    )
      return "marketing consent reset";
    return null;
  };

  const field = mismatchedField();
  return field === null ? null : `repeat reservation ${field} did not match`;
};
