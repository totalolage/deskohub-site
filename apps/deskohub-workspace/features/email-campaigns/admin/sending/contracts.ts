import { Schema } from "effect";
import isEmail from "validator/lib/isEmail.js";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { campaignIdSchema } from "../../campaign-identifiers";

const standardSchemaOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

const campaignTestSendSchema = Schema.Struct({
  campaignId: campaignIdSchema,
  extraRecipients: Schema.Array(reservationCustomerEmailSchema),
});

export const campaignTestSendStandardSchema = Schema.toStandardSchemaV1(
  campaignTestSendSchema,
  standardSchemaOptions
);

const campaignSendSchema = Schema.Struct({
  campaignId: campaignIdSchema,
  confirmationCode: Schema.Trimmed.check(Schema.isNonEmpty()),
});

export const campaignSendStandardSchema = Schema.toStandardSchemaV1(
  campaignSendSchema,
  standardSchemaOptions
);

const campaignReferenceSchema = Schema.Struct({
  campaignId: campaignIdSchema,
});

export const campaignReferenceStandardSchema = Schema.toStandardSchemaV1(
  campaignReferenceSchema,
  standardSchemaOptions
);

const campaignRetrySchema = Schema.Struct({
  campaignId: campaignIdSchema,
  /** Also mail `unconfirmed` recipients, who may already have the email. */
  includeUnconfirmed: Schema.Boolean,
});

export const campaignRetryStandardSchema = Schema.toStandardSchemaV1(
  campaignRetrySchema,
  standardSchemaOptions
);

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
