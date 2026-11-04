import { describe, expect, test } from "bun:test";
import type { PaymentAttemptState } from "@/db/schema";
import { m } from "./i18n";
import {
  formatProviderCode,
  getAdministrationPaymentAttemptStateLabel,
  getAdministrationPaymentProviderLabel,
  getAdministrationPaymentStateLabel,
  getProviderOperationTimelineTone,
  getProviderValueLabel,
  isAbandonedPayment,
} from "./payment-presentation";

describe("payment presentation", () => {
  test("names known Nexi codes in the route locale", () => {
    expect(getProviderValueLabel("DENIED_BY_RISK", "cs-CZ")).toBe(
      "Odmítnuto kontrolou rizik"
    );
    expect(getProviderValueLabel("AUTHORIZATION", "cs-CZ")).toBe("Autorizace");
    expect(getProviderValueLabel("executed", "cs-CZ")).toBe("Provedeno");
    expect(getProviderValueLabel("BACKOFFICE", "en-US")).toBe("Back office");
  });

  test("keeps an unknown Nexi code in English words", () => {
    expect(getProviderValueLabel("INCREMENTAL_AUTHORIZATION", "cs-CZ")).toBe(
      "Incremental Authorization"
    );
  });

  test("keeps the API's English wording for every code", () => {
    expect(formatProviderCode("DENIED_BY_RISK")).toBe("Denied By Risk");
  });

  test("warns about failed results and reversing operation types", () => {
    for (const result of ["declined", "DENIED_BY_RISK", "Refunded"]) {
      expect(getProviderOperationTimelineTone("AUTHORIZATION", result)).toBe(
        "warning"
      );
    }
    for (const type of ["cancel", "REFUND", "Void"]) {
      expect(getProviderOperationTimelineTone(type, "EXECUTED")).toBe(
        "warning"
      );
      expect(getProviderOperationTimelineTone(type, undefined)).toBe("warning");
    }
    expect(getProviderOperationTimelineTone(undefined, "failed")).toBe(
      "warning"
    );
  });

  test("marks authorizations and captures that went through as positive", () => {
    expect(
      getProviderOperationTimelineTone("authorization", "authorized")
    ).toBe("positive");
    expect(getProviderOperationTimelineTone("AUTHORIZATION", "EXECUTED")).toBe(
      "positive"
    );
    expect(getProviderOperationTimelineTone("capture", "executed")).toBe(
      "positive"
    );
  });

  test("keeps every other operation neutral", () => {
    expect(getProviderOperationTimelineTone("CAPTURE", "AUTHORIZED")).toBe(
      "neutral"
    );
    expect(getProviderOperationTimelineTone("AUTHORIZATION", "PENDING")).toBe(
      "neutral"
    );
    expect(getProviderOperationTimelineTone("INCREMENTAL", "EXECUTED")).toBe(
      "neutral"
    );
    expect(getProviderOperationTimelineTone("AUTHORIZATION", undefined)).toBe(
      "neutral"
    );
    expect(getProviderOperationTimelineTone(undefined, "EXECUTED")).toBe(
      "neutral"
    );
    expect(getProviderOperationTimelineTone(undefined, undefined)).toBe(
      "neutral"
    );
    expect(getProviderOperationTimelineTone("", "")).toBe("neutral");
  });

  test("names every exact local attempt state in the route locale", () => {
    const expected = [
      ["created", m.administrationPaymentAttemptStateCreated],
      ["pending", m.administrationPaymentAttemptStatePending],
      ["paid", m.administrationPaymentAttemptStatePaid],
      ["failed", m.administrationPaymentAttemptStateFailed],
      ["cancelled", m.administrationPaymentAttemptStateCancelled],
      ["expired", m.administrationPaymentAttemptStateExpired],
    ] as const satisfies readonly (readonly [PaymentAttemptState, unknown])[];
    for (const [state, message] of expected) {
      expect(getAdministrationPaymentAttemptStateLabel(state, "cs-CZ")).toBe(
        message({}, { locale: "cs-CZ" })
      );
    }
  });

  test("summarizes payment progress, with every moneyless end unsuccessful", () => {
    const expected = [
      ["created", m.administrationPaymentStateStarted],
      ["pending", m.administrationPaymentStatePending],
      ["paid", m.administrationPaymentStatePaid],
      ["failed", m.administrationPaymentStateUnsuccessful],
      ["cancelled", m.administrationPaymentStateUnsuccessful],
      ["expired", m.administrationPaymentStateUnsuccessful],
    ] as const satisfies readonly (readonly [PaymentAttemptState, unknown])[];
    for (const [state, message] of expected) {
      expect(
        getAdministrationPaymentStateLabel(
          { failureCode: null, state },
          "en-US"
        )
      ).toBe(message({}, { locale: "en-US" }));
    }
  });

  test("calls a payment released after the local window abandoned", () => {
    const payment = {
      failureCode: "payment_abandoned_after_provider_cutoff",
      state: "cancelled",
    } as const;
    expect(isAbandonedPayment(payment)).toBe(true);
    expect(isAbandonedPayment({ failureCode: "provider_declined" })).toBe(
      false
    );
    expect(getAdministrationPaymentStateLabel(payment, "en-US")).toBe(
      m.administrationPaymentStateAbandoned({}, { locale: "en-US" })
    );
  });

  test("names included and online payment collection", () => {
    expect(getAdministrationPaymentProviderLabel("internal", "en-US")).toBe(
      m.administrationPaymentProviderIncluded({}, { locale: "en-US" })
    );
    expect(getAdministrationPaymentProviderLabel("nexi", "en-US")).toBe(
      m.administrationPaymentProviderOnline({}, { locale: "en-US" })
    );
  });
});
