import { describe, expect, test } from "bun:test";
import { m } from "./i18n";
import {
  getReservationAccessErrorMessage,
  getReservationCancellationErrorMessage,
} from "./reservation-error-messages";
import {
  getAdministrationLifecycleConditionLabel,
  getAdministrationReservationStatusLabel,
  getAdministrationReservationStatusNoteLabel,
} from "./reservation-presentation";
import { getAdministrationReservationProductTitle } from "./reservation-product";
import {
  getAdministrationReservationLifecycle,
  getAdministrationReservationStatus,
  getAdministrationReservationStatusNoteFields,
} from "./reservation-status";
import { getAdministrationReservationTimelineCopy } from "./reservation-timeline";

describe("reservation presentation", () => {
  test("shows the API's English status label on English routes", () => {
    const status = getAdministrationReservationStatus({
      failureCode: "payment_abandoned_after_provider_cutoff",
      fulfillmentState: "not_started",
      paymentState: "expired",
      reservationState: "cancelled",
    });

    expect(getAdministrationReservationStatusLabel(status.code, "en-US")).toBe(
      status.label
    );
    expect(getAdministrationReservationStatusLabel(status.code, "cs-CZ")).toBe(
      "Opuštěno"
    );
  });

  test("names the lifecycle condition in the route language", () => {
    const lifecycle = getAdministrationReservationLifecycle({
      fulfillmentState: "fulfilled",
      paymentState: "paid",
      reservationState: "confirmed",
    });

    expect(
      getAdministrationLifecycleConditionLabel(lifecycle.condition, "en-US")
    ).toBe(lifecycle.label);
    expect(
      getAdministrationLifecycleConditionLabel(lifecycle.condition, "cs-CZ")
    ).toBe("Přístup byl doručen");
  });

  test("keeps the English status note for the API and localizes its code", () => {
    const fields = getAdministrationReservationStatusNoteFields("needs_refund");

    expect(fields).toEqual({
      statusNote: "Needs refund",
      statusNoteCode: "needs_refund",
    });
    expect(
      getAdministrationReservationStatusNoteLabel("needs_refund", "en-US")
    ).toBe(fields.statusNote ?? "");
    expect(
      getAdministrationReservationStatusNoteLabel("needs_refund", "cs-CZ")
    ).toBe("Čeká na vrácení peněz");
    expect(getAdministrationReservationStatusNoteFields(null)).toEqual({
      statusNote: null,
      statusNoteCode: null,
    });
  });

  test("names products from the customer catalog", () => {
    expect(
      getAdministrationReservationProductTitle({ kind: "office" }, "cs-CZ")
    ).toBe("Soukromá kancelář");
    expect(
      getAdministrationReservationProductTitle(
        { kind: "meeting-room" },
        "en-US"
      )
    ).toBe("Meeting Room");
    expect(
      getAdministrationReservationProductTitle(
        { kind: "cowork", tier: "basic" },
        "cs-CZ"
      )
    ).toBe("Basic Day Pass");
  });

  test("localizes reservation history copy", () => {
    expect(
      getAdministrationReservationTimelineCopy(
        { source: "reservation", kind: "hold_cancelled" },
        "en-US"
      )
    ).toEqual({
      title: "Reservation cancelled",
      description: "The held reservation was cancelled.",
    });
    expect(
      getAdministrationReservationTimelineCopy(
        {
          source: "reservation",
          kind: "late_payment_recovery_refund_required",
        },
        "cs-CZ"
      )
    ).toEqual({
      title: "Pozdní platba – nutné vrátit peníze",
      description:
        "Rezervaci nebylo možné bezpečně obnovit. Vraťte platbu v Nexi.",
    });
  });

  test("explains cancellation and access failures in the operator's language", () => {
    expect(
      getReservationCancellationErrorMessage("delivery_in_progress", "cs-CZ")
    ).toBe(
      m.administrationReservationCancellationErrorDeliveryInProgress(
        {},
        { locale: "cs-CZ" }
      )
    );
    expect(getReservationCancellationErrorMessage("not_found", "en-US")).toBe(
      "This reservation was not found."
    );
    expect(getReservationAccessErrorMessage("retryable_failure", "cs-CZ")).toBe(
      "Obnova přístupu ke dveřím je dočasně nedostupná. Zkuste to znovu za chvíli."
    );
  });
});
