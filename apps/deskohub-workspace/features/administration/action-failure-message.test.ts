import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { actionRuntimeFailureMessages } from "@/shared/utils/action-runtime-failure";
import { getAdministrationActionFailureMessage } from "./action-failure-message";

describe("getAdministrationActionFailureMessage", () => {
  test("shows a timeout in the operator's language", () => {
    expect(
      getAdministrationActionFailureMessage(
        actionRuntimeFailureMessages.timeout,
        {
          fallback: m.administrationReservationLookupFailed(
            {},
            { locale: "cs-CZ" }
          ),
          locale: "cs-CZ",
        }
      )
    ).toBe("Server neodpověděl včas. Zkuste to znovu.");
  });

  test("shows an unexpected failure in the operator's language", () => {
    expect(
      getAdministrationActionFailureMessage(
        actionRuntimeFailureMessages.unexpected,
        {
          fallback: m.administrationReservationLookupFailed(
            {},
            { locale: "cs-CZ" }
          ),
          locale: "cs-CZ",
        }
      )
    ).toBe("Na serveru se něco pokazilo. Zkuste to znovu.");
    expect(
      getAdministrationActionFailureMessage(
        actionRuntimeFailureMessages.unexpected,
        {
          fallback: m.administrationReservationLookupFailed(
            {},
            { locale: "en-US" }
          ),
          locale: "en-US",
        }
      )
    ).toBe("Something went wrong on the server. Try again.");
  });

  test("keeps the action's localized message", () => {
    const message = m.administrationReservationCancellationErrorClaimFailed(
      {},
      { locale: "cs-CZ" }
    );
    expect(
      getAdministrationActionFailureMessage(message, {
        fallback: m.administrationReservationLookupFailed(
          {},
          { locale: "cs-CZ" }
        ),
        locale: "cs-CZ",
      })
    ).toBe(message);
  });

  test("uses the fallback without a server message", () => {
    expect(
      getAdministrationActionFailureMessage(undefined, {
        fallback: m.administrationReservationLookupFailed(
          {},
          { locale: "cs-CZ" }
        ),
        locale: "cs-CZ",
      })
    ).toBe(m.administrationReservationLookupFailed({}, { locale: "cs-CZ" }));
  });
});
