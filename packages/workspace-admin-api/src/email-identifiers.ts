import { Schema } from "effect";

export const EmailId = Schema.NonEmptyString.pipe(
  Schema.brand("EmailId")
).annotate({
  identifier: "EmailId",
  description:
    "Reusable email identity, independent of the campaigns using it.",
});
export type EmailId = typeof EmailId.Type;

export const EmailVersionId = Schema.NonEmptyString.pipe(
  Schema.brand("EmailVersionId")
).annotate({
  identifier: "EmailVersionId",
  description: "Immutable published version of a reusable email.",
});
export type EmailVersionId = typeof EmailVersionId.Type;

export const EmailPreparationId = Schema.NonEmptyString.pipe(
  Schema.brand("EmailPreparationId")
).annotate({
  identifier: "EmailPreparationId",
  description:
    "Stable logical recipient delivery preparation, retained across attempts.",
});
export type EmailPreparationId = typeof EmailPreparationId.Type;

export const EmailValueName = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/)
)
  .pipe(Schema.brand("EmailValueName"))
  .annotate({
    identifier: "EmailValueName",
    description:
      "Unique named recipient value within an email; array position determines generation order.",
  });
export type EmailValueName = typeof EmailValueName.Type;
