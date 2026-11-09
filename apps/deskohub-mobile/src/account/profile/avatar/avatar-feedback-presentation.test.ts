import { describe, expect, test } from "bun:test";
import { CustomerViewError } from "../../../customer-api/customer-view-error";
import { sharedViewErrorMessage } from "../../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../../i18n/app-locale";
import { m } from "../../../i18n/messages";
import { AvatarFeedback } from "./avatar-action";
import { avatarFeedbackNotice } from "./avatar-feedback-presentation";

const locales: ReadonlyArray<AppLocale> = ["cs-CZ", "en-US"];

describe("avatarFeedbackNotice for a failed action", () => {
  const shared: ReadonlyArray<readonly [string, CustomerViewError]> = [
    ["an ended session", CustomerViewError.SessionRequired()],
    ["a rate limit", CustomerViewError.RateLimited()],
    ["an unavailable service", CustomerViewError.Unavailable()],
    ["a timeout", CustomerViewError.TimedOut()],
    ["an unexpected failure", CustomerViewError.Unexpected()],
  ];

  test.each(shared)("explains %s as every screen does", (_title, error) => {
    for (const locale of locales) {
      expect(
        avatarFeedbackNotice(AvatarFeedback.Failed({ error }), locale)
      ).toEqual({
        tone: "error",
        message: sharedViewErrorMessage(error, locale),
      });
    }
  });

  test("an unconfirmed change is a warning, worded as every screen words it", () => {
    const error = CustomerViewError.Unconfirmed();
    for (const locale of locales) {
      expect(
        avatarFeedbackNotice(AvatarFeedback.Failed({ error }), locale)
      ).toEqual({
        tone: "warning",
        message: sharedViewErrorMessage(error, locale),
      });
    }
  });

  test("a failure no shared sentence covers falls back to the avatar's own", () => {
    const error = CustomerViewError.NotFound();
    for (const locale of locales) {
      expect(sharedViewErrorMessage(error, locale)).toBeUndefined();
      expect(
        avatarFeedbackNotice(AvatarFeedback.Failed({ error }), locale)
      ).toEqual({
        tone: "error",
        message: m.profile_avatar_failed({}, { locale }),
      });
    }
  });
});
