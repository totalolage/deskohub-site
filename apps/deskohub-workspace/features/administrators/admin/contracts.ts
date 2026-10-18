import { Schema } from "effect";
import isEmail from "validator/lib/isEmail.js";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { m } from "@/features/administration/i18n";
import { defaultLocale, type Locale } from "@/features/i18n";

const administratorEmailMaximumLength = 255;

/** The email of the account to grant the administrator role, in `locale`. */
export const makeGrantAdministratorSchema = (locale: Locale) =>
  Schema.Struct({
    email: Schema.Trim.check(
      Schema.isNonEmpty({
        message: m.administratorsEmailRequired({}, { locale }),
      }),
      Schema.isMaxLength(administratorEmailMaximumLength, {
        message: m.administratorsEmailTooLong(
          { max: administratorEmailMaximumLength },
          { locale }
        ),
      }),
      Schema.makeFilter((email) => isEmail(email), {
        message: m.administratorsEmailInvalid({}, { locale }),
      })
    ),
  });

// The form validates in the operator's locale first, so the action's
// validation messages only reach a caller that bypasses the form.
export const grantAdministratorStandardSchema = Schema.toStandardSchemaV1(
  makeGrantAdministratorSchema(defaultLocale),
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);

const revokeAdministratorSchema = Schema.Struct({
  accountId: customerAccountIdSchema,
});

export const revokeAdministratorStandardSchema = Schema.toStandardSchemaV1(
  revokeAdministratorSchema,
  { parseOptions: { errors: "all", onExcessProperty: "error" } }
);
