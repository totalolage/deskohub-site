import { Effect } from "effect";
import type { LinkedCustomerAccount } from "@/features/account/customer-account";
import { parseReferralCode } from "@/features/referrals/client";
import type {
  ReferralAcceptance,
  ReferralError,
} from "@/features/referrals/contracts";

export type AccountReferralAcceptanceResult =
  | { readonly status: "accepted" }
  | { readonly status: "already_accepted" }
  | {
      readonly status:
        | "unavailable"
        | "self_referral"
        | "already_attributed"
        | "ineligible";
    };

type AcceptReferral = (input: {
  readonly code: unknown;
  readonly customerAccountId: LinkedCustomerAccount["accountId"];
  readonly dotyposCustomerId: LinkedCustomerAccount["dotyposCustomerId"];
}) => Effect.Effect<ReferralAcceptance, ReferralError>;

const unavailable: AccountReferralAcceptanceResult = { status: "unavailable" };

const mapFailure = (error: ReferralError): AccountReferralAcceptanceResult => {
  switch (error.reason) {
    case "self_referral":
      return { status: "self_referral" };
    case "already_attributed":
      return { status: "already_attributed" };
    case "ineligible":
      return { status: "ineligible" };
    case "invalid_code":
    case "unavailable":
    case "account_unavailable":
      return unavailable;
  }
};

/**
 * Keeps referral acceptance explicit and binds it to the server-resolved
 * linked identity. The browser supplies only the public code.
 */
export const acceptReferralForAccount = (
  code: string,
  account: LinkedCustomerAccount,
  accept: AcceptReferral
): Effect.Effect<AccountReferralAcceptanceResult> => {
  const referralCode = parseReferralCode(code);
  if (referralCode === undefined) return Effect.succeed(unavailable);

  return accept({
    code: referralCode,
    customerAccountId: account.accountId,
    dotyposCustomerId: account.dotyposCustomerId,
  }).pipe(
    Effect.map((result) => ({ status: result.kind }) as const),
    Effect.catchTag("ReferralError", (error) =>
      Effect.succeed(mapFailure(error))
    )
  );
};
