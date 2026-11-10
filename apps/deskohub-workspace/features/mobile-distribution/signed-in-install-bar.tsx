import { Suspense } from "react";
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import type { Locale } from "@/features/i18n";
import { InstallBar } from "./install-bar";

/**
 * The install bar on a page that signed-out visitors may also open, such as
 * the reservation status page: it shows only to a signed-in customer and
 * streams in without holding up the page.
 */
export function SignedInInstallBar({ locale }: { readonly locale: Locale }) {
  return (
    <Suspense fallback={null}>
      <SignedInInstallBarContent locale={locale} />
    </Suspense>
  );
}

async function SignedInInstallBarContent({
  locale,
}: {
  readonly locale: Locale;
}) {
  const signedIn = await isCustomerSignedIn();
  return signedIn && <InstallBar locale={locale} />;
}
