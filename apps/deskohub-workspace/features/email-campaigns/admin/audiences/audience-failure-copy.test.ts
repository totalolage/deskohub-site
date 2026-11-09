import { describe, expect, test } from "bun:test";
import { describeCampaignOperationFailure } from "../campaign-operation-failure";
import { audienceSaveFailureCopy } from "./audience-failure-copy";

describe("audienceSaveFailureCopy", () => {
  test.each([
    [
      "audience-filter-context",
      "en-US",
      "The audience could not be saved. Trigger-relative periods and “this campaign” only work in automation conditions.",
    ],
    [
      "audience-filter-campaign-not-found",
      "en-US",
      "The audience could not be saved. A campaign it counts emails from no longer exists. Choose another campaign.",
    ],
    [
      "audience-filter-campaign-not-found",
      "cs-CZ",
      "Okruh příjemců se nepodařilo uložit. Kampaň, jejíž e-maily počítá, už neexistuje. Vyberte jinou kampaň.",
    ],
    [
      "campaign-read-only",
      "en-US",
      "The audience could not be saved. Check the form and try again.",
    ],
  ] as const)("words %s in %s", (code, locale, text) => {
    expect(
      describeCampaignOperationFailure(
        { code },
        audienceSaveFailureCopy,
        locale
      )
    ).toBe(text);
  });
});
