import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import type { CustomerInvoiceListState } from "@/features/account/contracts";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { AccountVisualRoute } from "./account-route";
import { accountVisualFixture as defaultFixture } from "./default-adapter";
import type { AccountVisualAdapterProps } from "./types";

const failedFixture = {
  ...defaultFixture,
  invoices: Promise.resolve<CustomerInvoiceListState>({ kind: "failed" }),
} satisfies CustomerAccountPageState;

export const accountVisualFixture = failedFixture;

export const accountVisualAdapterMetadata = {
  owner: "account-visual invoice-failed adapter",
  fixture: "synthetic linked account with failed invoice loading",
} as const;

export function FailedAccountAdapter({ locale }: AccountVisualAdapterProps) {
  return (
    <AccountLayoutShell accountsEnabled locale={locale} signedIn>
      <AccountVisualRoute locale={locale} state={failedFixture} />
    </AccountLayoutShell>
  );
}

export default FailedAccountAdapter;
