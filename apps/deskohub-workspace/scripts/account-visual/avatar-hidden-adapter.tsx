import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { AccountVisualRoute } from "./account-route";
import { accountVisualFixture as availableFixture } from "./default-adapter";
import type { AccountVisualAdapterProps } from "./types";

const hiddenAvatarFixture = {
  ...availableFixture,
  avatar: { kind: "hidden" },
} as const satisfies CustomerAccountPageState;

export const accountVisualFixture = hiddenAvatarFixture;

export const accountVisualAdapterMetadata = {
  owner: "account-visual avatar-off adapter",
  fixture: "linked synthetic customer account with avatar hidden",
} as const;

export function HiddenAvatarAccountAdapter({
  locale,
}: AccountVisualAdapterProps) {
  return (
    <AccountLayoutShell accountsEnabled locale={locale} signedIn>
      <AccountVisualRoute locale={locale} state={hiddenAvatarFixture} />
    </AccountLayoutShell>
  );
}

export default HiddenAvatarAccountAdapter;
