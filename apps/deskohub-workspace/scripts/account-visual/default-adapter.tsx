import { AccountPage } from "@/features/account/components/account-page";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
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
  return <AccountPage locale={locale} state={linkedFixture} />;
}

export default DefaultAccountAdapter;
