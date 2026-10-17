import type { Schema } from "effect";
import { makeSealedState } from "@/shared/backend/sealed-state";

// The sign-in link lives 10 minutes; the margin covers a customer who opens
// it late or reloads the page they return to.
const authReturnStateTtlMilliseconds = 30 * 60 * 1000;

/**
 * Sealed state that rides on a sign-in's return path, such as checkout
 * contact details typed before the email was verified. `seal` gives a
 * short-lived token for a query parameter of the return path, and `open`
 * reads it back on the page the sign-in lands on. Each `purpose` opens only
 * its own tokens.
 */
export const makeAuthReturnState = <A, I>(
  purpose: string,
  schema: Schema.Codec<A, I>
) =>
  makeSealedState({
    purpose: `auth-return:${purpose}`,
    schema,
    ttlMilliseconds: authReturnStateTtlMilliseconds,
  });
