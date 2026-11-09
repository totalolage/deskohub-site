"use client";

import { PasskeyPrompt } from "@/features/account/components/passkeys/passkey-prompt";
import { SignInSecurityScreen } from "@/features/account/components/passkeys/sign-in-security-screen";
import type { AccountPasskeys } from "@/features/account/components/passkeys/use-account-passkeys";
import type { Locale } from "@/features/i18n";

type SignInSecuritySectionProps = {
  readonly accountPasskeys: AccountPasskeys;
  readonly email: string;
  readonly locale: Locale;
  /** Whether another account section is active. */
  readonly hidden: boolean;
};

/**
 * Sign-in & security with the post-sign-in passkey prompt, for every signed-in
 * account page that manages sign-in methods.
 */
export function SignInSecuritySection({
  accountPasskeys,
  email,
  hidden,
  locale,
}: SignInSecuritySectionProps) {
  return (
    <>
      <PasskeyPrompt
        accountHasPasskeys={
          accountPasskeys.passkeys === null
            ? undefined
            : accountPasskeys.passkeys.length > 0
        }
        accountId={accountPasskeys.accountId}
        createPasskey={() => accountPasskeys.createPasskey("prompt")}
        locale={locale}
      />
      <div hidden={hidden}>
        <SignInSecurityScreen
          confirmWithPasskey={accountPasskeys.confirmWithPasskey}
          createPasskey={() => accountPasskeys.createPasskey("settings")}
          deletePasskey={accountPasskeys.deletePasskey}
          email={email}
          locale={locale}
          passkeys={accountPasskeys.passkeys}
          renamePasskey={accountPasskeys.renamePasskey}
        />
      </div>
    </>
  );
}
