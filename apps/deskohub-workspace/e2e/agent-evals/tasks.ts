import type { Locale } from "@/features/i18n";
import { nexiSandboxTestCard } from "../checkout/nexi-sandbox-test-card";

/**
 * The agent task catalog. Each task is given to the agent in natural
 * language with only the preview's start URL: never selectors, internal
 * URLs, or the protection bypass.
 */
export const agentEvalTaskIds = [
  "facts",
  "open-space-to-pay",
  "meeting-room-to-pay",
  "office-to-pay",
  "open-space-payment",
] as const;

export type AgentEvalTaskId = (typeof agentEvalTaskIds)[number];

/** Meeting-room task: the earliest start the agent may pick, and the length. */
export const agentEvalMeetingRoomEarliestStart = "10:00";
export const agentEvalMeetingRoomHours = 4;
/** Office task: seats and consecutive days. */
export const agentEvalOfficeSeats = 2;
export const agentEvalOfficeDays = 3;

/**
 * The run's concrete inputs, chosen from the preview's availability before
 * the agent starts. Dates are Prague-local `YYYY-MM-DD` values.
 */
export type AgentEvalTaskParameters =
  | { readonly taskId: "facts" }
  | { readonly taskId: "open-space-to-pay"; readonly date: string }
  | {
      readonly taskId: "meeting-room-to-pay";
      readonly date: string;
      /** The first free 4-hour start at or after 10:00 when the run began. */
      readonly expectedStartTime: string;
    }
  | { readonly taskId: "office-to-pay"; readonly startDate: string }
  | { readonly taskId: "open-space-payment"; readonly date: string };

const formatTaskDate = (date: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

const formatCardNumber = (number: string) =>
  number.replace(/(\d{4})(?=\d)/g, "$1 ");

const formatCardExpiry = (expiry: string) =>
  `${expiry.slice(0, 2)}/${expiry.slice(2)}`;

const paymentCardText = (locale: Locale) => {
  const number = formatCardNumber(nexiSandboxTestCard.number);
  const expiry = formatCardExpiry(nexiSandboxTestCard.expiry);
  return locale === "cs-CZ"
    ? `číslo karty ${number}, platnost ${expiry}, CVC ${nexiSandboxTestCard.cvv}`
    : `card number ${number}, expiry ${expiry}, CVC ${nexiSandboxTestCard.cvv}`;
};

/** The prompt the harness hands to its agent. */
export const makeAgentEvalPrompt = (
  parameters: AgentEvalTaskParameters,
  locale: Locale,
  startUrl: string
): string => {
  const czech = locale === "cs-CZ";
  const open = czech
    ? `Otevři ${startUrl} (Deskohub Workspace).`
    : `Open ${startUrl} (Deskohub Workspace).`;
  const stopAtPay = czech
    ? "Pokračuj až na stránku, kde bych zaplatil, a tam skonči. Neplať."
    : "Continue until you reach the page where I would pay, then stop there. Don't pay.";
  switch (parameters.taskId) {
    case "facts":
      return czech
        ? `${open} Zjisti cenu vyhrazeného místa (Reserved Desk) na jeden den, otevírací dobu a adresu. Odpověz všemi třemi údaji.`
        : `${open} Find out the daily price of a Reserved Desk, the opening hours, and the address. Reply with all three.`;
    case "open-space-to-pay": {
      const date = formatTaskDate(parameters.date, locale);
      return czech
        ? `${open} Zarezervuj mi sdílené místo v Open Space na ${date}. ${stopAtPay}`
        : `${open} Book me an Open Space desk for ${date}. ${stopAtPay}`;
    }
    case "meeting-room-to-pay": {
      const date = formatTaskDate(parameters.date, locale);
      return czech
        ? `${open} Zarezervuj mi zasedačku na ${agentEvalMeetingRoomHours} hodiny na ${date}, od nejbližšího volného času od ${agentEvalMeetingRoomEarliestStart}. ${stopAtPay}`
        : `${open} Book me the meeting room for ${agentEvalMeetingRoomHours} hours on ${date}, starting at the first free time from ${agentEvalMeetingRoomEarliestStart} onwards. ${stopAtPay}`;
    }
    case "office-to-pay": {
      const date = formatTaskDate(parameters.startDate, locale);
      return czech
        ? `${open} Zarezervuj mi soukromou kancelář pro ${agentEvalOfficeSeats} lidi na ${agentEvalOfficeDays} dny od ${date}. ${stopAtPay}`
        : `${open} Book me a private office for ${agentEvalOfficeSeats} people for ${agentEvalOfficeDays} days starting ${date}. ${stopAtPay}`;
    }
    case "open-space-payment": {
      const date = formatTaskDate(parameters.date, locale);
      return czech
        ? `${open} Zarezervuj mi sdílené místo v Open Space na ${date} a zaplať ho testovací kartou: ${paymentCardText(locale)}. Pokud se objeví testovací ověření 3-D Secure, potvrď ho. Nakonec mi napiš, co ukazuje stránka se stavem rezervace.`
        : `${open} Book me an Open Space desk for ${date} and pay for it with this test card: ${paymentCardText(locale)}. If a 3-D Secure test page appears, confirm it. Then tell me what the reservation status page says.`;
    }
  }
};
