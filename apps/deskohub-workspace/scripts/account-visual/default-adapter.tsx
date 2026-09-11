import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { AccountVisualRoute } from "./account-route";
import {
  type AccountVisualAdapterProps,
  defaultAccountVisualAdapterMetadata,
} from "./types";

const linkedFixture = {
  kind: "linked",
  email: "ada@example.test",
  profile: {
    firstName: "Ada",
    lastName: "Example",
    phone: null,
    billing: null,
  },
  history: {
    kind: "available",
    groups: { current: [], past: [], unavailable: [] },
  },
} as const satisfies CustomerAccountPageState;

export const accountVisualFixture = linkedFixture;
export const accountVisualAdapterMetadata = defaultAccountVisualAdapterMetadata;

export function DefaultAccountAdapter({ locale }: AccountVisualAdapterProps) {
  return (
    <AccountLayoutShell locale={locale} signedIn>
      <AccountVisualRoute locale={locale} state={linkedFixture} />
    </AccountLayoutShell>
  );
}

export default DefaultAccountAdapter;
