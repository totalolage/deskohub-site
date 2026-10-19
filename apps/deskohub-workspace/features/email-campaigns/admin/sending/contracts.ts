import { Schema } from "effect";
import isEmail from "validator/lib/isEmail.js";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/**
 * One extra test-send address as typed into the dialog, with admin copy. The
 * action validates it again with the customer email rules.
 */
export const createTestRecipientFieldSchema = (locale: Locale) =>
  Schema.Struct({
    email: Schema.Trim.check(
      Schema.isNonEmpty({
        message: m.emailCampaignsTestSendRecipientRequired({}, { locale }),
      }),
      Schema.makeFilter((email) => isEmail(email), {
        message: m.emailCampaignsTestSendRecipientInvalid({}, { locale }),
      })
    ),
  });

export type TestRecipientFieldSchema = ReturnType<
  typeof createTestRecipientFieldSchema
>;

/**
 * The confirmation code as typed: 8 letters or digits in any case, with an
 * optional hyphen in the middle. The send service normalizes it.
 */
export const createConfirmationCodeFieldSchema = (locale: Locale) =>
  Schema.Struct({
    code: Schema.Trim.check(
      Schema.isPattern(/^[a-z0-9]{4}-?[a-z0-9]{4}$/i, {
        message: m.emailCampaignsSendConfirmCodeInvalid({}, { locale }),
      })
    ),
  });

export type ConfirmationCodeFieldSchema = ReturnType<
  typeof createConfirmationCodeFieldSchema
>;
