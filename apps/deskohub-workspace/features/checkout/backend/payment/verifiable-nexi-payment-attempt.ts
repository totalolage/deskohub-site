import { Predicate } from "effect";
import {
  isNexiPaymentAttempt,
  type NexiPaymentAttempt,
  type PaymentAttempt,
} from "../repositories/payment-attempt.repository";

/**
 * A Nexi attempt whose hosted payment session stored the security token
 * Nexi's payment verification needs.
 */
export type VerifiableNexiPaymentAttempt = NexiPaymentAttempt & {
  readonly securityToken: string;
};

export const isVerifiableNexiPaymentAttempt = (
  attempt: PaymentAttempt | null | undefined
): attempt is VerifiableNexiPaymentAttempt =>
  Predicate.isNotNullish(attempt) &&
  isNexiPaymentAttempt(attempt) &&
  Boolean(attempt.securityToken);
