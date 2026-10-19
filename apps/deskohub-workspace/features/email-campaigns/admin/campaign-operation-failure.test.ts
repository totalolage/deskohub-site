import { describe, expect, test } from "bun:test";
import {
  type CampaignOperationFailureCopy,
  describeCampaignOperationFailure,
} from "./campaign-operation-failure";

const copy: CampaignOperationFailureCopy = {
  fallback: (locale) => `fallback ${locale}`,
  codes: { "campaign-read-only": (locale) => `own ${locale}` },
};

describe("describeCampaignOperationFailure", () => {
  test("prefers the action's own wording of a code", () => {
    expect(
      describeCampaignOperationFailure(
        { code: "campaign-read-only" },
        copy,
        "en-US"
      )
    ).toBe("own en-US");
  });

  test.each([
    ["en-US", "That code expired. Send a new test email to get a fresh code."],
    [
      "cs-CZ",
      "Platnost tohoto kódu vypršela. Pro nový kód pošlete nový testovací e-mail.",
    ],
  ] as const)("uses the shared %s wording of a known code", (locale, text) => {
    expect(
      describeCampaignOperationFailure(
        { code: "confirmation-expired" },
        copy,
        locale
      )
    ).toBe(text);
  });

  test.each(["service-unavailable", "constructor", "toString"])(
    "falls back for %s, which has no copy",
    (code) => {
      expect(describeCampaignOperationFailure({ code }, copy, "cs-CZ")).toBe(
        "fallback cs-CZ"
      );
    }
  );
});
