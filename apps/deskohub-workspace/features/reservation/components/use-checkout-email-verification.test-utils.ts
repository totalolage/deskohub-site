import { mock } from "bun:test";

/**
 * Replaces the contact step's email verification for component tests. It
 * reaches the auth client, which needs a page origin a test DOM registered
 * before import doesn't have. Call it before importing the form under test.
 */
export const mockCheckoutEmailVerification = () => {
  const verify = mock(() => undefined);
  mock.module(
    "@/features/reservation/components/use-checkout-email-verification",
    () => ({
      useCheckoutEmailVerification: () => ({
        clearError: () => undefined,
        error: undefined,
        isVerifying: false,
        verify,
      }),
    })
  );
  return verify;
};
