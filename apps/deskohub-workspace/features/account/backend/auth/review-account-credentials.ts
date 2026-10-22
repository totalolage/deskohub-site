import { isTestEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import isEmail from "validator/lib/isEmail.js";

/**
 * Review passwords are long random strings an app directory keeps for later
 * reviews; the ceiling is Better Auth's own.
 */
export const reviewAccountPasswordLength = { min: 16, max: 128 } as const;

const reviewAccountCredentialSchema = Schema.Struct({
  // A reserved `.test` address can never receive mail, so nothing ever
  // reaches a reviewer's address and nobody can own it. Better Auth stores
  // login emails in lower case.
  email: Schema.String.check(
    Schema.makeFilter(
      (email) =>
        isEmail(email) &&
        isTestEmailAddress(email) &&
        email === email.trim().toLowerCase(),
      { message: "Review account emails are lowercase test addresses." }
    )
  ),
  password: Schema.String.check(
    Schema.isMinLength(reviewAccountPasswordLength.min),
    Schema.isMaxLength(reviewAccountPasswordLength.max)
  ),
});

/** One app-directory review login: a test address and its password. */
export type ReviewAccountCredential = typeof reviewAccountCredentialSchema.Type;

/**
 * `REVIEW_ACCOUNT_CREDENTIALS`: a JSON array of `{ "email", "password" }`
 * review logins with distinct emails, the only addresses that sign in with a
 * password.
 */
export const reviewAccountCredentialsSchema = Schema.optional(
  Schema.fromJsonString(
    Schema.Array(reviewAccountCredentialSchema).check(
      Schema.makeFilter(
        (credentials) =>
          new Set(credentials.map(({ email }) => email)).size ===
          credentials.length,
        { message: "Review account emails must be distinct." }
      )
    )
  )
);

/** The review login of an address, matched the way Better Auth matches it. */
export const findReviewAccountCredential = (
  credentials: readonly ReviewAccountCredential[],
  email: string
): ReviewAccountCredential | undefined => {
  const address = email.toLowerCase();
  return credentials.find((credential) => credential.email === address);
};
