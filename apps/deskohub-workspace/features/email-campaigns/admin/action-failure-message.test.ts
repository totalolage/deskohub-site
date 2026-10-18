import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { actionRuntimeFailureMessages } from "@/shared/utils/action-runtime-failure";
import { getEmailCampaignAdminActionFailureMessage } from "./action-failure-message";

describe("getEmailCampaignAdminActionFailureMessage", () => {
  test("shows a timeout in the operator's language", () => {
    expect(
      getEmailCampaignAdminActionFailureMessage(
        actionRuntimeFailureMessages.timeout,
        {
          fallback: m.emailCampaignsDraftDeleteFailed({}, { locale: "cs-CZ" }),
          locale: "cs-CZ",
        }
      )
    ).toBe("Server neodpověděl včas. Zkuste to znovu.");
  });

  test("shows an unexpected failure in the operator's language", () => {
    expect(
      getEmailCampaignAdminActionFailureMessage(
        actionRuntimeFailureMessages.unexpected,
        {
          fallback: m.emailCampaignsDraftDeleteFailed({}, { locale: "cs-CZ" }),
          locale: "cs-CZ",
        }
      )
    ).toBe("Na serveru se něco pokazilo. Zkuste to znovu.");
    expect(
      getEmailCampaignAdminActionFailureMessage(
        actionRuntimeFailureMessages.unexpected,
        {
          fallback: m.emailCampaignsDraftDeleteFailed({}, { locale: "en-US" }),
          locale: "en-US",
        }
      )
    ).toBe("Something went wrong on the server. Try again.");
  });

  test("keeps the action's localized message", () => {
    const message = m.emailCampaignsAudienceSaveFailedRetry(
      {},
      { locale: "cs-CZ" }
    );
    expect(
      getEmailCampaignAdminActionFailureMessage(message, {
        fallback: m.emailCampaignsDraftDeleteFailed({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(message);
  });

  test("uses the fallback without a server message", () => {
    expect(
      getEmailCampaignAdminActionFailureMessage(undefined, {
        fallback: m.emailCampaignsDraftDeleteFailed({}, { locale: "cs-CZ" }),
        locale: "cs-CZ",
      })
    ).toBe(m.emailCampaignsDraftDeleteFailed({}, { locale: "cs-CZ" }));
  });
});
