import { AccountContentLoading } from "@/features/account/components/account-loading";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export default function AccountRouteLoading() {
  return runWithRequestLocale((locale) => (
    <AccountContentLoading locale={locale} />
  ));
}
