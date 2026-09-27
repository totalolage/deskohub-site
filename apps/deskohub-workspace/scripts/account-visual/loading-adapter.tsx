import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import type { CustomerInvoiceListState } from "@/features/account/contracts";
import type { CustomerAccountPageState } from "@/features/account/page-data.server";
import { AccountVisualRoute } from "./account-route";
import { accountVisualFixture as defaultFixture } from "./default-adapter";
import type { AccountVisualAdapterProps } from "./types";

const pendingInvoices = new Promise<CustomerInvoiceListState>(() => {});

const loadingFixture = {
  ...defaultFixture,
  invoices: pendingInvoices,
} satisfies CustomerAccountPageState;

export const accountVisualFixture = loadingFixture;

export const accountVisualAdapterMetadata = {
  owner: "account-visual invoice-loading adapter",
  fixture:
    "synthetic linked account with deferred invoices to exercise the loading fallback",
} as const;

export function LoadingAccountAdapter({ locale }: AccountVisualAdapterProps) {
  return (
    <AccountLayoutShell accountsEnabled locale={locale} signedIn>
      <AccountVisualRoute locale={locale} state={loadingFixture} />
    </AccountLayoutShell>
  );
}

export default LoadingAccountAdapter;
