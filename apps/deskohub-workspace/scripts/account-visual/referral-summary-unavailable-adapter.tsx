import {
  accountVisualAdapterMetadata,
  ReferralScreenContent,
} from "./referral-screen-adapter";
import type { AccountVisualAdapterProps } from "./types";

export { accountVisualAdapterMetadata };

export function ReferralSummaryUnavailableAdapter(
  props: AccountVisualAdapterProps
) {
  return <ReferralScreenContent {...props} summary={undefined} />;
}

export default ReferralSummaryUnavailableAdapter;
