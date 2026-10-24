import type { AutomationTriggerKind } from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** What starts an automation's runs, named for admins. */
export const automationTriggerLabel = (
  kind: AutomationTriggerKind,
  locale: Locale
) =>
  ({
    schedule: m.emailAutomationsTriggerSchedule,
    "reservation-booked": m.emailAutomationsTriggerReservationBooked,
    "reservation-cancelled": m.emailAutomationsTriggerReservationCancelled,
    "reservation-started": m.emailAutomationsTriggerReservationStarted,
    "reservation-finished": m.emailAutomationsTriggerReservationFinished,
    "account-created": m.emailAutomationsTriggerAccountCreated,
  })[kind]({}, { locale });
