import { AuthModal } from "@/features/account/components/auth-modal";
import { SignInVerifyCard } from "@/features/account/components/sign-in-verify-card";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export const instant = false;

export default function CustomerSignInVerifyModalPage() {
  return runWithRequestLocale((locale) => (
    <AuthModal
      locale={locale}
      title={m.accountSignInAcceptedTitle({}, { locale })}
      description={m.accountVerifyMetadataDescription({}, { locale })}
    >
      <SignInVerifyCard locale={locale} presentation="modal" />
    </AuthModal>
  ));
}
