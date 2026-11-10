import { Suspense } from "react";
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import type { Locale } from "@/features/i18n";
import { InstallBar, type InstallBarPlacement } from "./install-bar";

/**
 * The install bar on a page that signed-out visitors may also open, such as
 * the reservation status page: it shows only to a signed-in customer and
 * streams in without holding up the page.
 */
export function SignedInInstallBar(props: SignedInInstallBarProps) {
  return (
    <Suspense fallback={null}>
      <SignedInInstallBarContent {...props} />
    </Suspense>
  );
}

type SignedInInstallBarProps = {
  readonly locale: Locale;
  readonly placement: InstallBarPlacement;
};

async function SignedInInstallBarContent(props: SignedInInstallBarProps) {
  const signedIn = await isCustomerSignedIn();
  return signedIn && <InstallBar {...props} />;
}
